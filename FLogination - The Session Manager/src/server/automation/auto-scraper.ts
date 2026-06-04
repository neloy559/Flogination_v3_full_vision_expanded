/**
 * Flogination V5 — Auto-Scraper
 *
 * Automatically harvests full Facebook profile data after a session is imported.
 * Runs in the background — operator does not need to do anything after import.
 *
 * Selector Strategy (priority order):
 *  1. selector_cache — human-recorded selectors from Browser Recorder (freshest, most reliable)
 *  2. Hardcoded defaults — fallback when no cached selector exists
 *  3. Text-based extraction — last resort for counts and status fields
 *
 * This means: browse Facebook once with Browser Recorder → selectors are cached →
 * auto-scraper uses those exact selectors on every subsequent run.
 *
 * Concurrency:
 *  - Processes sessions through a semaphore (default: 3 concurrent)
 *  - Remaining pending sessions are queued and processed in order
 *  - Retries once after 30s on failure before marking as 'failed'
 */

import pLimit from 'p-limit';
import type { Page } from 'playwright-core';
import { db_ } from '../database';
import { stealthBrowser } from './stealth-browser';
import { totpGenerator } from '../utils/totp-generator';
import type { BMRecord, PageRecord, GroupRecord, Session } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Delay before retrying a failed scrape attempt. */
const RETRY_DELAY_MS = 30_000;

/** Maximum number of scrape attempts per session (1 initial + 1 retry). */
const MAX_ATTEMPTS = 2;

/** Timeout for page navigation during scraping. */
const NAV_TIMEOUT_MS = 30_000;

/** How long to wait for dynamic content to load after navigation. */
const CONTENT_WAIT_MS = 3_000;

// ─────────────────────────────────────────────
// SELECTOR RESOLUTION
// Checks selector_cache first (human-recorded via Browser Recorder),
// falls back to hardcoded default if no fresh cache entry exists.
// ─────────────────────────────────────────────

/**
 * Resolves the best available CSS selector for a named element.
 * Priority: selector_cache (Browser Recorder recordings) → hardcoded default.
 *
 * @param elementKey - The logical name for the element (e.g. 'fb_profile_name').
 * @param defaultSelector - Fallback CSS selector if no cached entry exists.
 * @returns The freshest available selector string.
 *
 * @example
 * const sel = resolveSelector('fb_profile_name', 'h1[data-testid="profile-name"]')
 * const el = await page.$(sel)
 */
function resolveSelector(elementKey: string, defaultSelector: string): string {
  const cached = db_.getFreshSelector(elementKey);
  if (cached) {
    console.log(`[auto-scraper] Using cached selector for "${elementKey}": ${cached.cssSelector}`);
    return cached.cssSelector;
  }
  return defaultSelector;
}

/**
 * Tries multiple selectors in order, returning the first one that finds an element.
 * Checks selector_cache first for each key, then falls back to defaults.
 *
 * @param page - The Playwright page to query.
 * @param candidates - Array of [elementKey, defaultSelector] pairs to try.
 * @returns The first matching element handle, or null if none found.
 */
async function trySelectors(
  page: Page,
  candidates: Array<[string, string]>
): Promise<{ element: Awaited<ReturnType<Page['$']>>; selector: string } | null> {
  for (const [key, defaultSel] of candidates) {
    const selector = resolveSelector(key, defaultSel);
    const el = await page.$(selector).catch(() => null);
    if (el) return { element: el, selector };
  }
  return null;
}

// ─────────────────────────────────────────────
// QUEUE STATE
// ─────────────────────────────────────────────

/** p-limit instance — controls max concurrent scrapes. Recreated when settings change. */
let limiter = pLimit(3);

/** Whether the queue drain loop is currently running. */
let queueRunning = false;

// ─────────────────────────────────────────────
// PUBLIC ENTRY POINTS
// ─────────────────────────────────────────────

/**
 * Enqueues a single session for scraping.
 * Always sets scrapingStatus to 'pending' (even if it was already pending)
 * so the drain loop will pick it up on the next iteration.
 * Triggers the queue drain loop — if a drain is already running it will
 * pick up the new session in its next while-loop iteration.
 *
 * @param sessionId - The session to enqueue for scraping.
 *
 * @example
 * autoScraper.enqueue('session-uuid')
 */
function enqueue(sessionId: string): void {
  const session = db_.getSessionById(sessionId);
  if (!session) return;

  // Always write 'pending' — this ensures the drain loop sees it even if
  // the session was previously in 'done' or 'failed' state.
  db_.updateSession(sessionId, { scrapingStatus: 'pending' });

  // Trigger drain without awaiting — fire and forget.
  // drainQueue() is a no-op if already running; the while loop inside will
  // pick up the newly-pending session on its next iteration.
  drainQueue().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[auto-scraper] Queue drain error: ${message}`);
  });
}

/**
 * Starts the scrape queue on server startup.
 * Picks up any sessions that were left in 'pending' or 'scraping' state
 * from a previous server run (e.g. after a crash).
 *
 * @example
 * autoScraper.startQueue()
 */
function startQueue(): void {
  // Reset any sessions stuck in 'scraping' state from a previous crash
  const sessions = db_.getSessions();
  const stuckScraping = sessions.filter((s) => s.scrapingStatus === 'scraping');

  for (const session of stuckScraping) {
    db_.updateSession(session.id, { scrapingStatus: 'pending' });
    db_.logActivity(session.id, 'scrape_reset', 'Reset from stuck scraping state on startup');
  }

  // Update concurrency from settings
  const settings = db_.getSettings();
  limiter = pLimit(settings.maxScrapeParallel);

  // Drain any pending sessions
  drainQueue().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[auto-scraper] Startup queue drain error: ${message}`);
  });
}

// ─────────────────────────────────────────────
// QUEUE DRAIN
// ─────────────────────────────────────────────

/** Whether scraping has been cancelled by the operator. */
let cancelRequested = false;

/**
 * Cancels all pending and in-progress scraping.
 * Sets all 'pending' and 'scraping' sessions back to 'failed',
 * and sets a flag so the drain loop stops picking up new sessions.
 *
 * @example
 * autoScraper.cancelAll()
 */
function cancelAll(): void {
  cancelRequested = true;

  // Reset scraping sessions back to pending — they can be resumed with Sync All.
  // Do NOT mark as failed — that would lose the session's place in the queue.
  const sessions = db_.getSessions();
  for (const session of sessions) {
    if (session.scrapingStatus === 'scraping') {
      db_.updateSession(session.id, { scrapingStatus: 'pending' });
      db_.logActivity(session.id, 'scrape_paused', 'Scraping paused by operator — click Sync All to resume');
    }
  }

  // Reset the flag after a short delay so future scrapes work normally
  setTimeout(() => { cancelRequested = false; }, 2_000);

  console.log('[auto-scraper] All scraping paused by operator');
}

/**
 * Picks up all sessions with scrapingStatus='pending' and processes them
 * through the concurrency limiter.
 *
 * Only one drain loop runs at a time — concurrent calls are no-ops.
 * queueRunning is cleared BEFORE returning so that any enqueue() call
 * that arrives while the last batch is processing can start a new drain.
 */
async function drainQueue(): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;

  try {
    // Keep processing until no pending sessions remain or cancel is requested
    while (true) {
      if (cancelRequested) break;
      const pending = db_.getSessions().filter((s) => s.scrapingStatus === 'pending');
      if (pending.length === 0) break;

      // Process all pending sessions through the limiter concurrently
      await Promise.all(
        pending.map((session) =>
          limiter(() => scrapeWithRetry(session.id))
        )
      );
    }
  } finally {
    // Clear the flag BEFORE returning so the next enqueue() can start a new drain.
    // If we cleared it after returning, a session added during the last batch
    // would never be picked up until the next explicit enqueue() call.
    queueRunning = false;
  }
}

// ─────────────────────────────────────────────
// SCRAPE WITH RETRY
// ─────────────────────────────────────────────

/**
 * Attempts to scrape a session, retrying once after RETRY_DELAY_MS on failure.
 *
 * @param sessionId - The session to scrape.
 */
async function scrapeWithRetry(sessionId: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const success = await scrapeSession(sessionId);
    if (success) return;

    if (attempt < MAX_ATTEMPTS) {
      console.log(`[auto-scraper] Retrying session ${sessionId} in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
      await sleep(RETRY_DELAY_MS);

      // Reset to pending for retry
      db_.updateSession(sessionId, { scrapingStatus: 'pending' });
    }
  }

  // All attempts exhausted — mark as failed
  db_.updateSession(sessionId, { scrapingStatus: 'failed' });
  db_.logActivity(sessionId, 'scrape_failed', `All ${MAX_ATTEMPTS} scrape attempts failed`);
}

// ─────────────────────────────────────────────
// CORE SCRAPE LOGIC
// ─────────────────────────────────────────────

/**
 * Scrapes a single session's Facebook profile data.
 * Launches a headless stealth browser, injects cookies, harvests all fields,
 * updates the database, and closes the browser.
 *
 * @param sessionId - The session to scrape.
 * @returns True if scraping succeeded, false if it failed.
 */
async function scrapeSession(sessionId: string): Promise<boolean> {
  const session = db_.getSessionById(sessionId);
  if (!session) return false;

  // Skip only if currently scraping — not if done (re-scrape must be allowed)
  if (session.scrapingStatus === 'scraping') {
    return true;
  }

  // Validate cookie before launching a browser — saves resources on obviously dead cookies.
  // A valid FB session cookie must contain both c_user (UID) and xs (session token).
  const hasValidCookie = session.cookie.includes('c_user=') && session.cookie.includes('xs=');
  if (!hasValidCookie) {
    db_.updateSession(sessionId, { scrapingStatus: 'failed', healthStatus: 'dead' });
    db_.logActivity(sessionId, 'scrape_error', 'Invalid cookie — missing c_user or xs fields');
    return false;
  }

  // Mark as scraping
  db_.updateSession(sessionId, { scrapingStatus: 'scraping' });

  const settings = db_.getSettings();
  const proxy = session.proxyId
    ? db_.getProxies().find((p) => p.id === session.proxyId)
    : undefined;

  let instance = null;

  try {
    // Launch headless stealth browser
    instance = await stealthBrowser.launch({
      sessionId,
      proxy,
      settings,
      headless: true,
    });

    // Inject cookies
    await stealthBrowser.injectCookies(instance.context, session.cookie);

    const { page } = instance;

    // Navigate to Facebook home to verify session is alive
    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });

    // Run health check immediately after navigation — this sets the real status
    // instead of keeping the default 'live' that was set at import time.
    const health = await stealthBrowser.checkHealth(page);
    db_.updateSession(sessionId, { healthStatus: health.status, lastCheck: Date.now() });

    // If account is dead, banned, or checkpoint — stop scraping, no point continuing
    if (health.status === 'dead' || health.status === 'banned') {
      throw new Error(`Account ${health.status}: ${health.message}`);
    }

    if (health.status === 'checkpoint') {
      db_.updateSession(sessionId, { scrapingStatus: 'failed' });
      db_.logActivity(sessionId, 'scrape_error', `Checkpoint detected — manual verification required`);
      return false;
    }

    if (health.status === '2fa_required') {
      // Handle 2FA if prompted
      if (session.twoFactorSecret) {
        await handle2FA(page, session.twoFactorSecret);
        // Re-navigate after 2FA
        await page.goto('https://www.facebook.com/', {
          waitUntil: 'domcontentloaded',
          timeout: NAV_TIMEOUT_MS,
        });
      } else {
        db_.updateSession(sessionId, { scrapingStatus: 'failed' });
        db_.logActivity(sessionId, 'scrape_error', '2FA required but no secret stored');
        return false;
      }
    }

    // Handle 2FA if prompted (legacy URL-based check as fallback)
    if (page.url().includes('two_step') || page.url().includes('checkpoint')) {
      if (session.twoFactorSecret) {
        await handle2FA(page, session.twoFactorSecret);
      } else {
        throw new Error('2FA required but no secret stored');
      }
    }

    // Verify we are logged in — check both URL and page content
    const finalUrl = page.url();
    if (
      finalUrl.includes('/login') ||
      finalUrl.includes('login.php') ||
      finalUrl.includes('checkpoint') ||
      finalUrl.includes('two_step')
    ) {
      throw new Error('Session expired or blocked — redirected to: ' + finalUrl);
    }

    // Also check for login form presence (dead session without URL redirect)
    const loginFormPresent = await page.$('input[name="email"], #email, #pass').catch(() => null);
    if (loginFormPresent) {
      db_.updateSession(sessionId, { healthStatus: 'dead', scrapingStatus: 'failed' });
      db_.logActivity(sessionId, 'scrape_error', 'Session dead — login form detected on facebook.com');
      return false;
    }

    // Harvest all profile data
    const profileData = await harvestProfile(page, session);

    // Update session with all harvested data
    db_.updateSession(sessionId, {
      ...profileData,
      scrapingStatus: 'done',
      scrapedAt: Date.now(),
    });

    db_.logActivity(sessionId, 'scrape_completed', `Scraped: ${profileData.fbName}, ${profileData.friendsCount} friends, ${profileData.groupsJoinedCount} groups`);
    return true;

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Do NOT persist partial data — discard everything on failure
    db_.updateSession(sessionId, { scrapingStatus: 'failed' });
    db_.logActivity(sessionId, 'scrape_error', message);
    return false;

  } finally {
    // Always close the browser, even on error
    if (instance) {
      await stealthBrowser.close(instance).catch(() => {
        // Ignore close errors
      });
    }
  }
}

// ─────────────────────────────────────────────
// 2FA HANDLER
// ─────────────────────────────────────────────

/**
 * Handles a Facebook 2FA prompt during scraping.
 * Generates a TOTP code and enters it into the 2FA input field.
 * Retries once with the next window if the first code is rejected.
 *
 * @param page   - The Playwright page showing the 2FA prompt.
 * @param secret - The base32 TOTP secret from the session record.
 */
async function handle2FA(page: Page, secret: string): Promise<void> {
  const code = totpGenerator.generate(secret);

  // Try selector_cache first, then multiple fallback selectors for 2FA input
  const inputResult = await trySelectors(page, [
    ['fb_2fa_input_approvals',  '[name="approvals_code"]'],
    ['fb_2fa_input_mfa',        '[name="mfa_code"]'],
    ['fb_2fa_input_text',       'input[type="text"]'],
    ['fb_2fa_input_number',     'input[type="number"]'],
  ]);

  if (!inputResult?.element) {
    throw new Error('2FA prompt detected but input field not found');
  }

  await inputResult.element.fill(code);
  await page.keyboard.press('Enter');
  await sleep(2000);

  if (page.url().includes('two_step') || page.url().includes('checkpoint')) {
    const freshCode = await totpGenerator.waitAndRetry(secret);
    await inputResult.element.fill(freshCode);
    await page.keyboard.press('Enter');
    await sleep(2000);

    if (page.url().includes('two_step') || page.url().includes('checkpoint')) {
      throw new Error('2FA code rejected twice — session cannot be verified');
    }
  }
}

// ─────────────────────────────────────────────
// PROFILE HARVESTING
// ─────────────────────────────────────────────

/**
 * Harvests all profile data from a logged-in Facebook session.
 * Navigates to multiple Facebook pages to collect different data types.
 *
 * @param page    - The Playwright page with an active Facebook session.
 * @param session - The current session record (used for UID extraction).
 * @returns A partial Session object with all harvested fields.
 */
async function harvestProfile(
  page: Page,
  session: Session
): Promise<Partial<Session>> {
  const data: Partial<Session> = {};

  // ── Identity ──────────────────────────────
  // Step 1: Navigate to facebook.com/me and wait for the redirect to settle.
  // Use 'domcontentloaded' — Facebook never reaches 'networkidle' due to
  // continuous background XHR requests, which would always cause a 20s timeout.
  await page.goto('https://www.facebook.com/me', {
    waitUntil: 'domcontentloaded',
    timeout: NAV_TIMEOUT_MS,
  });
  await sleep(CONTENT_WAIT_MS);

  const redirectedUrl = page.url();
  const uidFromRedirect = extractUidFromUrl(redirectedUrl);

  // Prefer the freshly-extracted UID; fall back to the stored one.
  const resolvedUid = (uidFromRedirect && uidFromRedirect.length > 0)
    ? uidFromRedirect
    : session.uid;

  // Only update UID in DB if we found a new one and the session doesn't have a real numeric UID yet.
  // 'pending_' prefix means it was a placeholder set at import time — replace it with the real UID.
  const hasRealUid = session.uid && /^\d+$/.test(session.uid);
  if (uidFromRedirect && uidFromRedirect.length > 0 && !hasRealUid) {
    data.uid = uidFromRedirect;
  }

  // Step 2: Ensure we are on a confirmed profile page before extracting the name.
  // A confirmed profile page URL contains either:
  //   - /profile.php?id=<uid>  (numeric UID)
  //   - /<uid>                 (username or numeric UID as path segment)
  const isOnProfilePage = (url: string): boolean =>
    url.includes('/profile.php') ||
    url.includes('/people/') ||
    (resolvedUid.length > 0 && url.includes(`/${resolvedUid}`)) ||
    (uidFromRedirect.length > 0 && url.includes(`/${uidFromRedirect}`));

  if (!isOnProfilePage(redirectedUrl) && resolvedUid.length > 0) {
    // We landed on a non-profile page (e.g. Chats, Notifications, Feed).
    // Navigate directly to the profile using the UID.
    const directProfileUrl = `https://www.facebook.com/profile.php?id=${resolvedUid}`;

    await page.goto(directProfileUrl, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await sleep(CONTENT_WAIT_MS);
  }

  // Record the confirmed profile URL.
  data.profileUrl = page.url();

  // Step 3: Extract name — try from current page first, then force profile.php if needed.
  // If we're still not on a profile page (e.g. UID was pending_ and now resolved),
  // try one more time with the freshly resolved UID.
  const currentUrl = page.url();
  if (!isOnProfilePage(currentUrl) && uidFromRedirect && uidFromRedirect.length > 0) {
    await page.goto(`https://www.facebook.com/profile.php?id=${uidFromRedirect}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await sleep(CONTENT_WAIT_MS);
    data.profileUrl = page.url();
  }

  // Step 3: Extract name ONLY from a confirmed profile page.
  // PRIMARY: document.title — most reliable on FB ("Name | Facebook").
  // FALLBACK: CSS selectors — used only when title extraction fails.
  if (isOnProfilePage(page.url())) {
    // Primary: parse name from document.title — FB profile pages always have "Name | Facebook".
    // This is more reliable than CSS selectors which change with every FB UI update.
    const pageTitle = await page.title().catch(() => '');
    const titleMatch = pageTitle.match(/^(.+?)\s*\|\s*Facebook\s*$/i);
    if (titleMatch) {
      const nameFromTitle = titleMatch[1].trim();
      // Sanity check — a real FB name is 2–80 chars and is NOT a FB navigation page title.
      // FB redirects to "Notifications", "Chats", "Home" etc. when the profile URL fails.
      const FB_SYSTEM_TITLES = new Set([
        'notifications', 'chats', 'messages', 'home', 'feed', 'watch',
        'marketplace', 'groups', 'events', 'gaming', 'reels', 'friends',
        'memories', 'saved', 'pages', 'ads manager', 'fundraisers',
      ]);
      const isSystemTitle = FB_SYSTEM_TITLES.has(nameFromTitle.toLowerCase());
      if (nameFromTitle.length >= 2 && nameFromTitle.length <= 80 && !isSystemTitle) {
        data.fbName = nameFromTitle;
      }
    }

    // Fallback: CSS selectors — only if title extraction failed.
    if (!data.fbName) {
      const nameResult = await trySelectors(page, [
        ['fb_profile_name_h1',       'h1[data-testid="profile-name"]'],
        ['fb_profile_name_heor9g',   'h1.x1heor9g'],
        ['fb_profile_name_pagelet',  '[data-pagelet="ProfileTilesFeed"] h1'],
        ['fb_profile_name_cover',    '[data-pagelet="ProfileCover"] h1'],
        ['fb_profile_name_generic',  'h1'],
      ]);

      if (nameResult?.element) {
        const rawName = await nameResult.element.textContent();
        // Sanity check — a real FB name is 2–80 chars and doesn't look like a nav label.
        if (rawName && rawName.trim().length >= 2 && rawName.trim().length <= 80) {
          data.fbName = rawName.trim();
        }
      }
    }
  }

  // If name extraction failed entirely, keep the existing fbName from DB — never overwrite with garbage.
  if (!data.fbName && session.fbName && session.fbName.length > 0) {
    data.fbName = session.fbName;
  }

  // Extract gender, creation date, and country from about page
  const aboutData = await harvestAboutPage(page, session);
  Object.assign(data, aboutData);

  // ── Friends count ─────────────────────────
  data.friendsCount = await harvestFriendsCount(page, data.uid ?? session.uid);

  // ── Groups ────────────────────────────────
  const groupsData = await harvestGroups(page, data.uid ?? session.uid);
  data.groupsJoinedCount = groupsData.length;
  data.joinedGroupsData = JSON.stringify(groupsData);

  // ── Pages ─────────────────────────────────
  const pagesData = await harvestPages(page, data.uid ?? session.uid);
  data.ownedPagesData = JSON.stringify(pagesData);

  // ── Business Managers ─────────────────────
  const bmData = await harvestBusinessManagers(page);
  data.bmCount = bmData.length;
  data.bmData = JSON.stringify(bmData);

  // ── Professional mode & monetization ──────
  const monetizationData = await harvestMonetizationStatus(page, data.uid ?? session.uid);
  Object.assign(data, monetizationData);

  return data;
}

// ─────────────────────────────────────────────
// INDIVIDUAL HARVESTERS
// ─────────────────────────────────────────────

/**
 * Harvests identity data from the Facebook About page.
 * Also detects country from the page's html[lang] attribute as a fallback
 * when the session has no country set from its proxy.
 *
 * @param page    - The Playwright page (currently on a profile page).
 * @param session - The current session record (used to avoid overwriting existing country).
 */
async function harvestAboutPage(page: Page, session: Session): Promise<Partial<Session>> {
  const data: Partial<Session> = {};

  /** Maps HTML lang codes to ISO 3166-1 alpha-2 country codes. */
  const LANG_TO_COUNTRY: Record<string, string> = {
    vi: 'VN',
    bn: 'BD',
    en: 'US',
    id: 'ID',
    th: 'TH',
    ms: 'MY',
    tl: 'PH',
    ar: 'EG',
    tr: 'TR',
    pt: 'BR',
    de: 'DE',
    fr: 'FR',
    hi: 'IN',
    ur: 'PK',
    sw: 'NG',
    zh: 'CN',
    ja: 'JP',
    ko: 'KR',
    es: 'MX',
    ru: 'RU',
    it: 'IT',
    nl: 'NL',
    pl: 'PL',
  };

  try {
    const currentUrl = page.url();
    const aboutUrl = currentUrl.includes('profile.php')
      ? currentUrl + '&sk=about'
      : currentUrl.replace(/\/$/, '') + '/about';

    await page.goto(aboutUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await sleep(CONTENT_WAIT_MS);

    // Extract gender
    const pageText = await page.textContent('body') ?? '';
    if (pageText.includes('Female') || pageText.includes('Woman')) data.gender = 'Female';
    else if (pageText.includes('Male') || pageText.includes('Man')) data.gender = 'Male';

    // Extract creation date (joined date)
    const joinedMatch = pageText.match(/Joined\s+(\w+\s+\d{4})/i);
    if (joinedMatch) data.creationDate = joinedMatch[1];

    // Detect country from html[lang] — only if the session has no country from proxy.
    // A proxy-assigned country is more accurate than a lang-based guess.
    const hasCountry = session.country && session.country !== 'Unknown' && session.country.length > 0;
    if (!hasCountry) {
      const lang = await page.$eval('html', (el) => el.getAttribute('lang')).catch(() => null);
      if (lang) {
        // Full lang tag overrides (e.g. "en-GB" → UK, "en-US" → US, "pt-BR" → BR).
        const FULL_LANG_OVERRIDES: Record<string, string> = {
          'en-GB': 'UK',
          'en-US': 'US',
          'en-AU': 'AU',
          'en-CA': 'CA',
          'pt-BR': 'BR',
          'pt-PT': 'PT',
          'zh-TW': 'TW',
          'zh-HK': 'HK',
        };
        const fullLangKey = lang.toLowerCase();
        const primaryLang = lang.split('-')[0].toLowerCase();
        const mappedCountry =
          FULL_LANG_OVERRIDES[fullLangKey] ??
          LANG_TO_COUNTRY[fullLangKey] ??
          LANG_TO_COUNTRY[primaryLang];
        if (mappedCountry) {
          data.country = mappedCountry;
        }
      }
    }

  } catch {
    // About page harvest is non-critical — continue without it
  }

  return data;
}

/**
 * Harvests the friends count from the profile page.
 */
async function harvestFriendsCount(page: Page, uid: string): Promise<number> {
  try {
    const friendsUrl = uid
      ? `https://www.facebook.com/${uid}/friends`
      : 'https://www.facebook.com/me/friends';

    await page.goto(friendsUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await sleep(CONTENT_WAIT_MS);

    // Try cached selector first
    const countResult = await trySelectors(page, [
      ['fb_friends_count_badge',   '[data-testid="friends_count"]'],
      ['fb_friends_count_header',  'a[href*="/friends"] span'],
      ['fb_friends_count_tab',     '[role="tab"] span'],
    ]);

    if (countResult?.element) {
      const text = await countResult.element.textContent() ?? '';
      const match = text.match(/(\d[\d,]*)/);
      if (match) return parseInt(match[1].replace(/,/g, ''), 10);
    }

    // Text-based fallback
    const pageText = await page.textContent('body') ?? '';
    const match = pageText.match(/(\d[\d,]*)\s+friends?/i);
    if (match) return parseInt(match[1].replace(/,/g, ''), 10);
  } catch {
    // Non-critical
  }
  return 0;
}

/**
 * Harvests all joined groups from the groups page.
 * Scrolls to load all groups before extracting.
 */
async function harvestGroups(page: Page, uid: string): Promise<GroupRecord[]> {
  const groups: GroupRecord[] = [];

  try {
    await page.goto('https://www.facebook.com/groups/?category=joined', {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await sleep(CONTENT_WAIT_MS);

    // Scroll to load all groups (up to 5 scrolls)
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(1500);
    }

    // Try cached group item selector first, then fallbacks
    const groupLinkSelector = resolveSelector(
      'fb_group_list_item_link',
      'a[href*="/groups/"]'
    );
    const groupElements = await page.$$(groupLinkSelector);

    for (const el of groupElements) {
      const href = await el.getAttribute('href');
      const name = await el.textContent();

      if (href && name && href.includes('/groups/') && !href.includes('?')) {
        const url = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
        const cleanName = name.trim();

        if (cleanName.length > 0 && !groups.some((g) => g.url === url)) {
          groups.push({ name: cleanName, url, memberCount: 0, role: 'member' });
        }
      }
    }
  } catch {
    // Non-critical
  }

  return groups;
}

/**
 * Harvests owned Facebook Pages from the pages management section.
 */
async function harvestPages(page: Page, uid: string): Promise<PageRecord[]> {
  const pages: PageRecord[] = [];

  try {
    await page.goto('https://www.facebook.com/pages/?category=your_pages', {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await sleep(CONTENT_WAIT_MS);

    // Try cached page item selector first
    const pageLinkSelector = resolveSelector(
      'fb_pages_list_item_link',
      'a[href*="/pages/"]'
    );
    const pageElements = await page.$$(pageLinkSelector);

    for (const el of pageElements) {
      const href = await el.getAttribute('href');
      const name = await el.textContent();

      if (href && name && href.includes('/pages/') && !href.includes('?')) {
        const url = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
        const cleanName = name.trim();
        const idMatch = href.match(/\/pages\/[^/]+\/(\d+)/);

        if (cleanName.length > 0 && !pages.some((p) => p.url === url)) {
          pages.push({ name: cleanName, id: idMatch ? idMatch[1] : '', url, category: '', likes: 0 });
        }
      }
    }
  } catch {
    // Non-critical
  }

  return pages;
}

/**
 * Harvests Business Manager data from business.facebook.com.
 * Tries the overview page first; falls back to the bookmarks page if redirected.
 * Returns an empty array on any failure — BM harvest is non-critical.
 */
async function harvestBusinessManagers(page: Page): Promise<BMRecord[]> {
  const bms: BMRecord[] = [];

  try {
    await page.goto('https://business.facebook.com/overview', {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT_MS,
    });
    await sleep(CONTENT_WAIT_MS);

    // If we got redirected away from business.facebook.com, try the bookmarks fallback.
    // business.facebook.com often redirects to login or a different page for restricted accounts.
    const currentUrl = page.url();
    if (!currentUrl.includes('business.facebook.com')) {
      console.log('[auto-scraper] BM harvest: redirected from business.facebook.com, trying bookmarks fallback');
      await page.goto('https://www.facebook.com/bookmarks/pages', {
        waitUntil: 'domcontentloaded',
        timeout: NAV_TIMEOUT_MS,
      });
      await sleep(CONTENT_WAIT_MS);
    }

    // Try cached BM selector first, then fallbacks
    const bmSelector = resolveSelector(
      'fb_bm_selector_item',
      '[data-testid="business-selector-item"]'
    );
    const bmLinkSelector = resolveSelector(
      'fb_bm_link_business_id',
      'a[href*="business_id="]'
    );

    // Try both selectors
    let bmElements = await page.$$(bmSelector);
    if (bmElements.length === 0) {
      bmElements = await page.$$(bmLinkSelector);
    }

    for (const el of bmElements) {
      const name = await el.textContent();
      const href = await el.getAttribute('href');
      const idMatch = href?.match(/business_id=(\d+)/);

      if (name && name.trim().length > 0) {
        bms.push({
          name: name.trim(),
          id: idMatch ? idMatch[1] : '',
          role: 'Admin',
          adAccountCount: 0,
          restrictionStatus: 'Live',
        });
      }
    }

    console.log(`[auto-scraper] BM harvest: ${bms.length} BM(s) found`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[auto-scraper] BM harvest failed (non-critical): ${message}`);
  }

  return bms;
}

/**
 * Checks professional mode and monetization status.
 */
async function harvestMonetizationStatus(page: Page, uid: string): Promise<Partial<Session>> {
  const data: Partial<Session> = {
    professionalMode: false,
    monetizationStatus: false,
  };

  try {
    const profileUrl = uid
      ? `https://www.facebook.com/${uid}`
      : 'https://www.facebook.com/me';

    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
    await sleep(CONTENT_WAIT_MS);

    // Try cached professional mode indicator
    const proResult = await trySelectors(page, [
      ['fb_professional_dashboard_link', 'a[href*="professional_dashboard"]'],
      ['fb_creator_studio_link',         'a[href*="creator_studio"]'],
    ]);
    if (proResult?.element) data.professionalMode = true;

    // Try cached monetization indicator
    const monoResult = await trySelectors(page, [
      ['fb_monetization_link',  'a[href*="monetization"]'],
      ['fb_stars_link',         'a[href*="stars"]'],
      ['fb_instream_ads_link',  'a[href*="instream"]'],
    ]);
    if (monoResult?.element) data.monetizationStatus = true;

    // Text-based fallback
    if (!data.professionalMode || !data.monetizationStatus) {
      const pageText = await page.textContent('body') ?? '';
      if (!data.professionalMode && (pageText.includes('Professional dashboard') || pageText.includes('Creator Studio'))) {
        data.professionalMode = true;
      }
      if (!data.monetizationStatus && (pageText.includes('Monetization') || pageText.includes('Stars') || pageText.includes('In-stream ads'))) {
        data.monetizationStatus = true;
      }
    }
  } catch {
    // Non-critical
  }

  return data;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Extracts a Facebook UID from a profile URL.
 * Handles both numeric ID format and username format.
 *
 * @param url - The Facebook profile URL.
 * @returns The UID string, or empty string if not found.
 *
 * @example
 * extractUidFromUrl('https://www.facebook.com/profile.php?id=123456789') // → '123456789'
 * extractUidFromUrl('https://www.facebook.com/john.doe') // → 'john.doe'
 */
function extractUidFromUrl(url: string): string {
  // Numeric ID format: /profile.php?id=123456789
  const numericMatch = url.match(/[?&]id=(\d+)/);
  if (numericMatch) return numericMatch[1];

  // Username format: facebook.com/username (not a standard path)
  const usernameMatch = url.match(/facebook\.com\/([^/?#]+)/);
  if (usernameMatch && !['me', 'home', 'groups', 'pages', 'watch'].includes(usernameMatch[1])) {
    return usernameMatch[1];
  }

  return '';
}

/**
 * Returns a Promise that resolves after the specified number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The auto-scraper — harvests Facebook profile data after session import.
 *
 * @example
 * import { autoScraper } from '../automation/auto-scraper'
 *
 * // On server startup:
 * autoScraper.startQueue()
 *
 * // After importing a new session:
 * autoScraper.enqueue(session.id)
 */
export const autoScraper = {
  /** Enqueues a session for scraping. Triggers queue drain. */
  enqueue,
  /** Starts the scrape queue on server startup. Picks up pending sessions. */
  startQueue,
  /** Cancels all pending and in-progress scraping immediately. */
  cancelAll,
};
