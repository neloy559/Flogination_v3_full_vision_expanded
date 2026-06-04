/**
 * Flogination V5 — Self-Healing Selector Engine
 *
 * Automatically recovers from broken CSS selectors caused by Facebook DOM updates.
 * When a Playwright action fails because an element is not found, this engine:
 *
 *  1. Catches the element-not-found error.
 *  2. Extracts the parent HTML around the failed element's expected location.
 *  3. Sends the HTML to the AI Gateway (free OpenRouter model) for analysis.
 *  4. Receives a replacement CSS selector as JSON.
 *  5. Stores the new selector in the selector_cache table.
 *  6. Retries the original action exactly once with the healed selector.
 *
 * If the healed selector also fails, the action is marked as permanently failed
 * and an alert is surfaced in the activity logs.
 *
 * Cache freshness:
 *  - Cached selectors are considered fresh for 24 hours (SELECTOR_CACHE_TTL_MS).
 *  - Stale entries are treated as cache misses and re-healed on next failure.
 *
 * Cost optimisation:
 *  - Uses the free OpenRouter model (openrouter/auto) by default.
 *  - Falls back to the configured AI provider if OpenRouter is unavailable.
 */

import type { Page } from 'playwright-core';
import { db_ } from '../database';
import { aiGateway } from '../utils/ai-gateway';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Selector cache TTL — entries older than 24 hours are treated as stale. */
export const SELECTOR_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

/** Maximum characters of parent HTML to send to the AI for analysis. */
const MAX_HTML_CHARS = 2_000;

/** Playwright error messages that indicate an element was not found or detached. */
const ELEMENT_NOT_FOUND_PATTERNS = [
  'locator.click',
  'locator.fill',
  'locator.waitFor',
  'locator.evaluate',
  'strict mode violation',
  'element not found',
  'element is not attached',
  'no element matching',
  'waiting for locator',
  'timeout exceeded',
];

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** The result of a self-healing action attempt. */
export interface HealingResult<T> {
  success: boolean;
  value?: T;
  /** How the selector was resolved for this attempt. */
  source: 'cache_hit' | 'healed' | 'default' | 'permanent_failure';
  error?: string;
}

/**
 * A function that performs a Playwright action using a CSS selector.
 * The self-healing engine calls this with the best available selector.
 */
export type SelectorAction<T> = (selector: string) => Promise<T>;

// ─────────────────────────────────────────────
// CORE: withHealing
// ─────────────────────────────────────────────

/**
 * Wraps a Playwright action with automatic selector healing.
 *
 * Execution order:
 *  1. Check selector_cache for a fresh entry (< SELECTOR_CACHE_TTL_MS old).
 *  2. Try the action with the cached or default selector.
 *  3. On element-not-found / not-attached error:
 *     a. Extract parent HTML via page.$eval (up to MAX_HTML_CHARS chars).
 *     b. Call aiGateway.healSelector to get a replacement selector.
 *     c. Validate the JSON response contains a non-empty selector string.
 *     d. Upsert the new selector into the cache.
 *     e. Retry the action exactly once with the healed selector.
 *  4. On permanent failure: log selector_heal_failed and return failure result.
 *
 * @param page            - The Playwright page to extract HTML from on failure.
 * @param elementKey      - Logical name for the element, e.g. "fb_comment_button".
 * @param defaultSelector - The hardcoded CSS selector to use if no cache entry exists.
 * @param action          - The async function to execute with the selector.
 * @returns A HealingResult with the action's return value or failure details.
 *
 * @example
 * const result = await selfHealing.withHealing(
 *   page,
 *   'fb_post_button',
 *   '[data-testid="post-button"]',
 *   async (selector) => {
 *     await page.click(selector)
 *   }
 * )
 * if (!result.success) {
 *   console.error('Action permanently failed:', result.error)
 * }
 */
async function withHealing<T>(
  page: Page,
  elementKey: string,
  defaultSelector: string,
  action: SelectorAction<T>
): Promise<HealingResult<T>> {
  // Step 1: Check cache for a fresh selector (< 24 h old)
  const cached = db_.getFreshSelector(elementKey);
  const selectorToTry = cached?.cssSelector ?? defaultSelector;
  const source: HealingResult<T>['source'] = cached ? 'cache_hit' : 'default';

  // Step 2: Try the action with the best available selector
  try {
    const value = await action(selectorToTry);
    return { success: true, value, source };
  } catch (firstErr: unknown) {
    const firstMessage = firstErr instanceof Error ? firstErr.message : String(firstErr);

    // Only attempt healing for element-not-found / not-attached errors
    if (!isElementNotFoundError(firstMessage)) {
      return { success: false, source, error: firstMessage };
    }

    // Step 3a: Extract parent HTML for AI analysis (up to MAX_HTML_CHARS)
    const parentHtml = await extractParentHtml(page, selectorToTry);

    // Step 3b: Call AI Gateway to get a replacement selector
    const settings = db_.getSettings();
    const aiResponse = await aiGateway.healSelector(
      settings.ai,
      elementKey,
      selectorToTry,
      parentHtml
    );

    // Step 3c: Validate the JSON response — must contain a non-empty selector string
    const healedSelector = parseHealedSelector(aiResponse.content);

    if (!healedSelector) {
      // AI returned invalid or empty response — permanent failure
      logPermanentFailure(elementKey, selectorToTry, null, 'AI returned invalid response');
      return {
        success: false,
        source: 'permanent_failure',
        error: `selector_heal_failed for "${elementKey}": AI returned invalid response`,
      };
    }

    // Step 3d: Upsert the healed selector into the cache
    db_.upsertSelectorCache(elementKey, healedSelector);

    // Step 3e: Retry exactly once with the healed selector
    try {
      const value = await action(healedSelector);
      return { success: true, value, source: 'healed' };
    } catch (secondErr: unknown) {
      const secondMessage = secondErr instanceof Error ? secondErr.message : String(secondErr);

      // Both attempts failed — permanent failure for this run
      logPermanentFailure(elementKey, selectorToTry, healedSelector, secondMessage);
      return {
        success: false,
        source: 'permanent_failure',
        error: `selector_heal_failed for "${elementKey}": ${secondMessage}`,
      };
    }
  }
}

// ─────────────────────────────────────────────
// RESPONSE PARSING
// ─────────────────────────────────────────────

/**
 * Parses a CSS selector from an AI Gateway response content string.
 * Expects JSON format: { "selector": "..." }
 * Returns null if the response is missing, not valid JSON, or the selector is empty.
 *
 * @param content - The raw content string from aiGateway.healSelector response.
 * @returns The trimmed CSS selector string, or null on parse failure.
 */
function parseHealedSelector(content: string | undefined): string | null {
  if (!content) return null;

  try {
    // AI may wrap JSON in markdown fences — extract the JSON object
    const jsonMatch = content.match(/\{[^}]*"selector"[^}]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    if (typeof parsed['selector'] === 'string' && parsed['selector'].trim().length > 0) {
      return parsed['selector'].trim();
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// HTML EXTRACTION
// ─────────────────────────────────────────────

/**
 * Extracts the parent HTML context around a failed selector's expected location.
 * Uses page.$eval to get the parentElement.innerHTML of the target element.
 * Falls back to a relevant page section if the element is not found.
 *
 * @param page     - The Playwright page to extract HTML from.
 * @param selector - The failed CSS selector.
 * @returns A truncated HTML string (up to MAX_HTML_CHARS) for AI analysis.
 */
async function extractParentHtml(page: Page, selector: string): Promise<string> {
  try {
    // Primary: get parentElement.innerHTML of the target element
    const parentHtml = await page.$eval(
      selector,
      (el: Element) => el.parentElement?.innerHTML ?? ''
    );
    return parentHtml.slice(0, MAX_HTML_CHARS);
  } catch {
    // Element not found — fall back to a broader page section
    try {
      const fallbackHtml = await page.evaluate(() => {
        const main = document.querySelector('main, [role="main"], #content, body');
        return main ? main.innerHTML.slice(0, 3_000) : document.body.innerHTML.slice(0, 3_000);
      });
      return (fallbackHtml ?? '').slice(0, MAX_HTML_CHARS);
    } catch {
      return '';
    }
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Returns true if an error message indicates an element was not found or not attached.
 * Only these errors trigger the healing flow — other errors pass through unchanged.
 */
function isElementNotFoundError(message: string): boolean {
  const lower = message.toLowerCase();
  return ELEMENT_NOT_FOUND_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

/**
 * Logs a permanent selector failure to the activity log and console.
 * Called when both the original and healed selectors fail.
 *
 * The action name `selector_heal_failed` is used so the dashboard can surface
 * these events as alerts without conflating them with other error types.
 */
function logPermanentFailure(
  elementKey: string,
  originalSelector: string,
  healedSelector: string | null,
  reason: string
): void {
  db_.logActivity(
    null,
    'selector_heal_failed',
    JSON.stringify({
      elementKey,
      originalSelector,
      healedSelector,
      reason,
    })
  );

  console.error(
    `[self-healing] selector_heal_failed for element "${elementKey}". ` +
    `Original: "${originalSelector}", Healed: "${healedSelector ?? 'none'}". ` +
    `Reason: ${reason}`
  );
}

// ─────────────────────────────────────────────
// CONVENIENCE: lookupSelector
// ─────────────────────────────────────────────

/**
 * Returns the best available selector for an element key.
 * Checks the cache first (respecting SELECTOR_CACHE_TTL_MS), falls back to the default.
 * Use this when you want to pre-fetch the selector before an action.
 *
 * @param elementKey      - The logical element name.
 * @param defaultSelector - The hardcoded fallback selector.
 * @returns The best available CSS selector string.
 *
 * @example
 * const selector = selfHealing.lookupSelector('fb_like_button', '[aria-label="Like"]')
 * // → cached selector if fresh, otherwise '[aria-label="Like"]'
 */
function lookupSelector(elementKey: string, defaultSelector: string): string {
  const cached = db_.getFreshSelector(elementKey);
  return cached?.cssSelector ?? defaultSelector;
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The self-healing selector engine.
 * Wraps Playwright actions with automatic CSS selector recovery via AI Gateway.
 *
 * @example
 * import { selfHealing } from '../automation/self-healing'
 *
 * // Instead of: await page.click('[data-testid="post-button"]')
 * // Use:
 * const result = await selfHealing.withHealing(
 *   page,
 *   'fb_post_button',
 *   '[data-testid="post-button"]',
 *   async (selector) => page.click(selector)
 * )
 */
export const selfHealing = {
  /**
   * Wraps a Playwright action with automatic selector healing.
   * Checks cache, retries once with AI-generated selector on element-not-found errors.
   */
  withHealing,
  /**
   * Returns the best available selector for an element key.
   * Checks cache first (< 24 h), falls back to default.
   */
  lookupSelector,
};
