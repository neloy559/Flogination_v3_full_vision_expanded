/**
 * Flogination V5 — Webhook Service
 *
 * Fires event webhooks to an n8n instance when key automation events occur.
 * All calls are fire-and-forget with automatic retry on failure.
 *
 * Configuration:
 *  - n8nBaseUrl is read from app settings automatically.
 *  - An empty string or undefined base URL disables all webhook calls silently.
 *
 * Retry policy:
 *  - Up to 3 attempts with exponential backoff: 2s → 4s → 8s.
 *  - After all retries fail, logs a warning and continues — never throws.
 *
 * Supported events:
 *  - campaign-started    → fired when a campaign transitions to 'running'
 *  - campaign-finished   → fired when a campaign completes or fails
 *  - session-alert       → fired when a session health status changes
 *  - asset-parked        → fired when a page or BM is successfully transferred
 *  - test                → fired by the Settings page "Send Test Webhook" button
 */

import axios from 'axios';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Maximum number of delivery attempts per webhook event. */
const MAX_RETRIES = 3;

/**
 * Delay in milliseconds for each retry attempt (exponential backoff).
 * Index 0 = delay before attempt 2, index 1 = before attempt 3, etc.
 */
const BACKOFF_DELAYS_MS = [2_000, 4_000, 8_000] as const;

/** HTTP request timeout per attempt in milliseconds. */
const REQUEST_TIMEOUT_MS = 10_000;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/**
 * All supported webhook event names.
 * Each maps to a distinct n8n webhook path: /webhook/{event}
 */
export type WebhookEvent =
  | 'campaign-started'
  | 'campaign-finished'
  | 'session-alert'
  | 'asset-parked'
  | 'test';

// ─────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────

/**
 * Returns a Promise that resolves after the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Attempts to deliver a webhook payload with exponential backoff retry.
 * Logs a warning after each failed attempt and after all retries are exhausted.
 * Never throws — all errors are swallowed after logging.
 *
 * @param url   - The full webhook URL to POST to.
 * @param payload - The JSON payload to send.
 * @param event - Event name used in log messages.
 */
async function deliverWithRetry(
  url: string,
  payload: Record<string, unknown>,
  event: WebhookEvent
): Promise<void> {
  let lastError = '';

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await axios.post(url, payload, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: { 'Content-Type': 'application/json' },
      });

      // Delivery succeeded — exit immediately
      return;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err);

      if (attempt < MAX_RETRIES) {
        const delayMs = BACKOFF_DELAYS_MS[attempt - 1];
        console.warn(
          `[webhook-service] Attempt ${attempt}/${MAX_RETRIES} failed for event "${event}". ` +
            `Retrying in ${delayMs / 1_000}s. Error: ${lastError}`
        );
        await sleep(delayMs);
      }
    }
  }

  // All retries exhausted — log warning and continue without throwing
  console.warn(
    `[webhook-service] All ${MAX_RETRIES} attempts failed for event "${event}" → ${url}. ` +
      `Last error: ${lastError}`
  );
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Fires a webhook to the configured n8n instance.
 *
 * Reads `n8nBaseUrl` from app settings automatically. Silently skips if the
 * URL is an empty string or undefined — no request is made, no error is thrown,
 * and nothing is logged.
 *
 * On failure, retries up to 3 times with exponential backoff (2s / 4s / 8s).
 * After all retries are exhausted, logs a warning and returns — never throws.
 *
 * @param event   - The event name. Appended to the URL as /webhook/{event}.
 * @param payload - Arbitrary JSON payload describing the event. Should include
 *                  a `timestamp` field (Unix ms) per the event payload contract.
 *
 * @example
 * // Fire a campaign-started event
 * await webhookService.fire('campaign-started', {
 *   campaignId: 'abc-123',
 *   campaignName: 'BD Group Hunter',
 *   type: 'group_hunter',
 *   sessionCount: 10,
 *   timestamp: Date.now(),
 * })
 *
 * @example
 * // Silently skipped when n8nBaseUrl is not configured
 * await webhookService.fire('session-alert', { sessionId: 'xyz', timestamp: Date.now() })
 */
async function fire(
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  // Lazy import to avoid circular dependency at module load time
  const { db_ } = await import('../database');
  const settings = db_.getSettings();
  const baseUrl = (settings.n8nBaseUrl ?? '').trim();

  // Silent skip when n8n is not configured
  if (!baseUrl) {
    return;
  }

  const url = `${baseUrl}/webhook/${event}`;
  await deliverWithRetry(url, payload, event);
}

/**
 * The webhook service for firing n8n automation triggers.
 *
 * @example
 * import { webhookService } from '../utils/webhook-service'
 *
 * // When a campaign starts:
 * await webhookService.fire('campaign-started', {
 *   campaignId: campaign.id,
 *   campaignName: campaign.name,
 *   type: campaign.type,
 *   sessionCount: tasks.length,
 *   timestamp: Date.now(),
 * })
 *
 * // When a session health changes:
 * await webhookService.fire('session-alert', {
 *   sessionId: session.id,
 *   uid: session.uid,
 *   fbName: session.fbName,
 *   previousStatus: 'live',
 *   newStatus: 'checkpoint',
 *   timestamp: Date.now(),
 * })
 */
export const webhookService = { fire };
