/**
 * Flogination V5 — Group Hunter
 *
 * Mass-joins target Facebook groups across multiple sessions,
 * then optionally runs post campaigns and DM outreach inside those groups.
 *
 * Three phases (each optional):
 *
 * Phase 1 — Join:
 *  - For each session × group: navigate to group URL and send join request.
 *  - Track status per session/group: pending → requested → accepted/rejected.
 *  - Randomized delay 15–90s between join requests from the same session.
 *
 * Phase 2 — Post Campaign (after join accepted):
 *  - Post content with spin syntax support to joined groups.
 *  - Randomized delay 5–30 min between posts from the same session.
 *
 * Phase 3 — DM Outreach:
 *  - Scrape member UIDs from target groups.
 *  - Filter by activity, keywords, recency.
 *  - Send DMs to filtered members via inboxManager.
 *  - Daily DM limit per session: 1–50.
 */

import { db_ } from '../database';
import { sessionManager } from '../automation/session-manager';
import { selfHealing } from '../automation/self-healing';
import { campaignEngine } from '../campaigns/campaign-engine';
import { mongoClient } from '../utils/mongo-client';
import { spinParser } from '../utils/spin-parser';
import { contactManager } from '../inbox/contact-manager';
import { inboxManager } from '../inbox/inbox-manager';
import { S } from '../utils/selector-resolver';
import type { Campaign } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Minimum delay between join requests from the same session (15 seconds). */
const JOIN_DELAY_MIN_MS = 15_000;

/** Maximum delay between join requests from the same session (90 seconds). */
const JOIN_DELAY_MAX_MS = 90_000;

/** Minimum delay between posts from the same session (5 minutes). */
const POST_DELAY_MIN_MS = 5 * 60_000;

/** Maximum delay between posts from the same session (30 minutes). */
const POST_DELAY_MAX_MS = 30 * 60_000;

/** Minimum delay between DMs from the same session (5 minutes). */
const DM_DELAY_MIN_MS = 5 * 60_000;

/** Maximum delay between DMs from the same session (90 minutes). */
const DM_DELAY_MAX_MS = 90 * 60_000;

/** Maximum number of group search results to collect per keyword. */
const MAX_GROUP_RESULTS = 50;

/** Maximum DMs per session per day (hard cap). */
const MAX_DAILY_DM_LIMIT = 50;

/** Minimum DMs per session per day. */
const MIN_DAILY_DM_LIMIT = 1;

/** Maximum characters allowed in a Facebook post. */
const FB_POST_MAX_CHARS = 63_206;

/** Number of scroll iterations when loading group members. */
const MEMBER_SCROLL_ITERATIONS = 5;

/** Number of scroll iterations when loading group search results. */
const SEARCH_SCROLL_ITERATIONS = 3;

/** Milliseconds to wait after navigation before interacting. */
const NAV_SETTLE_MS = 2_000;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** Configuration for a Group Hunter job. */
export interface GroupHunterConfig {
  /** IDs of sessions that will participate. */
  sessionIds: string[];
  /** Target group URLs, group IDs, or search keywords (one per entry). */
  targets: string[];
  /**
   * Which phases to run.
   * - join: send join requests to each target group
   * - post: post content to joined groups
   * - dm: scrape members and send DMs
   */
  phases: {
    join: boolean;
    post?: PostPhaseConfig;
    dm?: DMPhaseConfig;
  };
}

/** Configuration for the post phase. */
export interface PostPhaseConfig {
  /** Post content with optional {spin|syntax} tokens. */
  content: string;
  /** 'burst' = post immediately, 'drip' = spread over dripHours. */
  timing: 'burst' | 'drip';
  /** Hours to spread posts over (for drip mode). */
  dripHours?: number;
}

/** Configuration for the DM outreach phase. */
export interface DMPhaseConfig {
  /** Message template with optional {spin|syntax} tokens. */
  messageTemplate: string;
  /** Max DMs per session per day (clamped to MIN_DAILY_DM_LIMIT–MAX_DAILY_DM_LIMIT). */
  dailyLimit: number;
  /** Only message members who posted/commented within this many days. */
  activeWithinDays?: number;
  /** Keywords that indicate buying/selling intent. */
  buyingKeywords?: string[];
}

/** Join status for a session × group pair. */
export type JoinStatus =
  | 'pending'
  | 'requested'
  | 'accepted'
  | 'rejected'
  | 'already_member'
  | 'failed';


// ─────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────

/**
 * Starts a Group Hunter job.
 * Creates a campaign with tasks for each phase × session × group combination,
 * then starts the campaign engine drain loop.
 *
 * @param config - The Group Hunter configuration.
 * @returns The created Campaign record.
 *
 * @example
 * const campaign = await groupHunter.start({
 *   sessionIds: ['session-1', 'session-2'],
 *   targets: ['https://facebook.com/groups/123', 'buy sell BD'],
 *   phases: {
 *     join: true,
 *     post: { content: '{Check this out|Look at this}: https://example.com', timing: 'drip', dripHours: 4 },
 *     dm: { messageTemplate: 'Hi! {Interested?|Want to know more?}', dailyLimit: 20 },
 *   },
 * })
 */
async function start(config: GroupHunterConfig): Promise<Campaign> {
  // Resolve target group URLs (keywords need to be searched first)
  const resolvedTargets = await resolveTargets(config.targets, config.sessionIds[0]);

  if (resolvedTargets.length === 0) {
    throw new Error('No valid group targets found. Check your URLs or keywords.');
  }

  // Build tasks: one per session per group per phase
  const tasks: Array<{ sessionId: string; action: string }> = [];

  if (config.phases.join) {
    for (const sessionId of config.sessionIds) {
      for (const groupUrl of resolvedTargets) {
        tasks.push({ sessionId, action: `join:${groupUrl}` });
      }
    }
  }

  if (config.phases.post) {
    for (const sessionId of config.sessionIds) {
      for (const groupUrl of resolvedTargets) {
        tasks.push({ sessionId, action: `post:${groupUrl}` });
      }
    }
  }

  if (config.phases.dm) {
    for (const sessionId of config.sessionIds) {
      for (const groupUrl of resolvedTargets) {
        tasks.push({ sessionId, action: `dm:${groupUrl}` });
      }
    }
  }

  const campaign = campaignEngine.create(
    `Group Hunter — ${resolvedTargets.length} groups × ${config.sessionIds.length} sessions`,
    'group_hunter',
    { ...config, resolvedTargets } as unknown as Record<string, unknown>,
    tasks
  );

  await campaignEngine.start(campaign.id, async (task) => {
    // Split on first colon only — group URLs contain colons (https:)
    const colonIndex = task.action.indexOf(':');
    const phase = task.action.slice(0, colonIndex);
    const groupUrl = task.action.slice(colonIndex + 1);

    switch (phase) {
      case 'join':
        return executeJoinTask(task.sessionId, groupUrl, campaign.id);
      case 'post':
        return executePostTask(task.sessionId, groupUrl, config.phases.post!, campaign.id);
      case 'dm':
        return executeDMTask(task.sessionId, groupUrl, config.phases.dm!, campaign.id);
      default:
        return { success: false, error: `Unknown phase: ${phase}` };
    }
  });

  return campaign;
}


// ─────────────────────────────────────────────
// TARGET RESOLUTION
// ─────────────────────────────────────────────

/**
 * Resolves target inputs to group URLs.
 * Direct URLs and group IDs are returned as-is.
 * Keywords trigger a Facebook group search (up to MAX_GROUP_RESULTS results).
 *
 * @param targets   - Array of group URLs, group IDs, or search keywords.
 * @param sessionId - Session to use for keyword searches.
 * @returns Deduplicated array of resolved group URLs.
 */
async function resolveTargets(targets: string[], sessionId: string): Promise<string[]> {
  const resolved: string[] = [];

  for (const target of targets) {
    if (target.includes('facebook.com/groups/')) {
      // Direct URL — use as-is
      resolved.push(target);
    } else if (/^\d+$/.test(target)) {
      // Numeric group ID — convert to URL
      resolved.push(`https://www.facebook.com/groups/${target}`);
    } else {
      // Keyword — search Facebook for matching groups
      const searchResults = await searchGroupsByKeyword(target, sessionId);
      resolved.push(...searchResults);
    }
  }

  // Deduplicate while preserving order
  return [...new Set(resolved)];
}

/**
 * Searches Facebook for groups matching a keyword.
 * Scrolls the results page to load more groups before extracting links.
 *
 * @param keyword   - The search keyword.
 * @param sessionId - Session to use for the search.
 * @returns Array of group URLs (up to MAX_GROUP_RESULTS).
 */
async function searchGroupsByKeyword(keyword: string, sessionId: string): Promise<string[]> {
  const page = sessionManager.getPage(sessionId);
  if (!page) return [];

  const results: string[] = [];

  try {
    const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(NAV_SETTLE_MS);

    // Scroll to load more results
    for (let i = 0; i < SEARCH_SCROLL_ITERATIONS; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(1_500);
    }

    // Extract group links — exclude links with query params (navigation links)
    const links = await page.$$('a[href*="/groups/"]');
    for (const link of links) {
      const href = await link.getAttribute('href');
      if (href && href.includes('/groups/') && !href.includes('?')) {
        const url = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
        if (!results.includes(url)) {
          results.push(url);
          if (results.length >= MAX_GROUP_RESULTS) break;
        }
      }
    }
  } catch {
    // Search failure is non-fatal — return whatever was collected
  }

  return results;
}


// ─────────────────────────────────────────────
// PHASE 1: JOIN
// ─────────────────────────────────────────────

/**
 * Executes a join request for one session × group pair.
 * Navigates to the group URL, clicks the Join button, and tracks the result.
 * Pauses the session if a checkpoint or restriction is detected.
 *
 * @param sessionId  - The session performing the join.
 * @param groupUrl   - The Facebook group URL to join.
 * @param campaignId - The parent campaign ID for result logging.
 * @returns Success/failure with join status and group URL.
 */
async function executeJoinTask(
  sessionId: string,
  groupUrl: string,
  campaignId: string
): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
  // Ensure session is running — launch headless if needed
  let page = sessionManager.getPage(sessionId);
  if (!page) {
    const launchResult = await sessionManager.launch(sessionId, false);
    if (!launchResult.success) {
      return { success: false, error: `Failed to launch browser: ${launchResult.error}` };
    }
    page = sessionManager.getPage(sessionId);
  }

  if (!page) return { success: false, error: 'Page not available after launch' };

  try {
    // Check session health before acting
    const health = await sessionManager.checkHealth(sessionId);
    if (health.status === 'checkpoint' || health.status === 'restricted') {
      // Pause the session — mark as restricted so the operator knows
      db_.updateSession(sessionId, { healthStatus: 'restricted' });
      db_.logActivity(sessionId, 'session_paused_checkpoint', `Session paused: ${health.status} detected before join`);
      return { success: false, error: `Session is ${health.status} — paused` };
    }
    if (health.status === 'dead') {
      return { success: false, error: 'Session is dead' };
    }

    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(NAV_SETTLE_MS);

    const pageText = (await page.textContent('body')) ?? '';

    // Check if already a member — no action needed
    if (pageText.includes('Leave Group') || pageText.includes('Joined')) {
      db_.logActivity(sessionId, 'group_already_member', `Already member of ${groupUrl}`);
      return { success: true, result: { status: 'already_member' as JoinStatus, groupUrl } };
    }

    // Click the Join Group button via self-healing selector
    const joinResult = await selfHealing.withHealing(
      page,
      'fb_join_group_button',
      S.JOIN_GROUP,
      async (sel) => {
        await page!.click(sel);
      }
    );

    if (!joinResult.success) {
      return { success: false, error: 'Could not find Join Group button' };
    }

    await sleep(NAV_SETTLE_MS);

    // Determine join outcome from page text
    const afterText = (await page.textContent('body')) ?? '';
    const status: JoinStatus =
      afterText.includes('Pending') || afterText.includes('Requested')
        ? 'requested'
        : afterText.includes('Joined') || afterText.includes('Leave')
          ? 'accepted'
          : 'requested';

    db_.logActivity(sessionId, 'group_join_requested', `Join ${status} for ${groupUrl}`);

    await mongoClient.writeCampaignResult({
      campaignId,
      taskId: `join-${sessionId}-${Date.now()}`,
      sessionId,
      action: 'join_group',
      outcome: status,
      data: { groupUrl, status },
    });

    await randomDelay(JOIN_DELAY_MIN_MS, JOIN_DELAY_MAX_MS);
    return { success: true, result: { status, groupUrl } };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Detect checkpoint/restriction from error messages
    if (message.toLowerCase().includes('checkpoint') || message.toLowerCase().includes('restricted')) {
      db_.updateSession(sessionId, { healthStatus: 'restricted' });
      db_.logActivity(sessionId, 'session_paused_checkpoint', `Session paused: ${message}`);
    }

    return { success: false, error: message };
  }
}


// ─────────────────────────────────────────────
// PHASE 2: POST
// ─────────────────────────────────────────────

/**
 * Posts content to a group from one session.
 * Resolves spin syntax to produce unique content per session.
 * Pauses the session if a checkpoint or restriction is detected.
 *
 * @param sessionId  - The session performing the post.
 * @param groupUrl   - The Facebook group URL to post in.
 * @param postConfig - Post phase configuration (content, timing).
 * @param campaignId - The parent campaign ID for result logging.
 * @returns Success/failure with group URL and content length.
 */
async function executePostTask(
  sessionId: string,
  groupUrl: string,
  postConfig: PostPhaseConfig,
  campaignId: string
): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
  const page = sessionManager.getPage(sessionId);
  if (!page) return { success: false, error: 'Session not running' };

  try {
    // Resolve spin syntax — unique content per session
    const resolvedContent = spinParser.resolve(postConfig.content);

    if (resolvedContent.length > FB_POST_MAX_CHARS) {
      return { success: false, error: `Post content exceeds Facebook ${FB_POST_MAX_CHARS} character limit` };
    }

    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(NAV_SETTLE_MS);

    // Check for checkpoint/restriction on the page
    const pageText = (await page.textContent('body')) ?? '';
    if (pageText.toLowerCase().includes('checkpoint') || pageText.toLowerCase().includes('your account has been restricted')) {
      db_.updateSession(sessionId, { healthStatus: 'restricted' });
      db_.logActivity(sessionId, 'session_paused_checkpoint', `Session paused: checkpoint detected during post`);
      return { success: false, error: 'Session checkpoint detected — paused' };
    }

    // Click "Write something..." post composer
    const composerResult = await selfHealing.withHealing(
      page,
      'fb_group_post_composer',
      S.GROUP_POST_COMPOSER,
      async (sel) => {
        await page.click(sel);
        await sleep(1_000);
      }
    );
    if (!composerResult.success) {
      return { success: false, error: 'Could not open post composer' };
    }

    // Type the post content with human-like delay
    await page.keyboard.type(resolvedContent, { delay: 30 });
    await sleep(1_000);

    // Click Post button
    const postResult = await selfHealing.withHealing(
      page,
      'fb_group_post_submit',
      S.GROUP_POST_SUBMIT,
      async (sel) => {
        await page.click(sel);
      }
    );
    if (!postResult.success) {
      return { success: false, error: 'Could not submit post' };
    }

    await sleep(NAV_SETTLE_MS);
    db_.logActivity(sessionId, 'group_post_delivered', `Posted to ${groupUrl}`);

    await mongoClient.writeCampaignResult({
      campaignId,
      taskId: `post-${sessionId}-${Date.now()}`,
      sessionId,
      action: 'group_post',
      outcome: 'success',
      data: { groupUrl, contentPreview: resolvedContent.slice(0, 100) },
    });

    // Apply drip delay if configured, otherwise use standard post delay
    const delayMs =
      postConfig.timing === 'drip' && postConfig.dripHours
        ? Math.random() * postConfig.dripHours * 60 * 60 * 1_000
        : randomDelayValue(POST_DELAY_MIN_MS, POST_DELAY_MAX_MS);

    await sleep(delayMs);
    return { success: true, result: { groupUrl, contentLength: resolvedContent.length } };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Detect checkpoint/restriction from error messages
    if (message.toLowerCase().includes('checkpoint') || message.toLowerCase().includes('restricted')) {
      db_.updateSession(sessionId, { healthStatus: 'restricted' });
      db_.logActivity(sessionId, 'session_paused_checkpoint', `Session paused: ${message}`);
    }

    return { success: false, error: message };
  }
}


// ─────────────────────────────────────────────
// PHASE 3: DM OUTREACH
// ─────────────────────────────────────────────

/**
 * Scrapes group members and sends DMs to filtered members.
 * Uses contactManager to upsert contacts and inboxManager to send DMs.
 * Writes results to MongoDB. Pauses session on checkpoint/restriction.
 *
 * @param sessionId  - The session performing the DM outreach.
 * @param groupUrl   - The Facebook group URL to scrape members from.
 * @param dmConfig   - DM phase configuration (template, daily limit, filters).
 * @param campaignId - The parent campaign ID for result logging.
 * @returns Success/failure with members found and DMs sent counts.
 */
async function executeDMTask(
  sessionId: string,
  groupUrl: string,
  dmConfig: DMPhaseConfig,
  campaignId: string
): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
  const page = sessionManager.getPage(sessionId);
  if (!page) return { success: false, error: 'Session not running' };

  try {
    // Scrape member UIDs from the group members page
    const memberUids = await scrapeGroupMembers(page, groupUrl);

    if (memberUids.length === 0) {
      db_.logActivity(sessionId, 'no_matching_members', `No members found in ${groupUrl}`);
      return { success: true, result: { groupUrl, membersFound: 0, dmsSent: 0 } };
    }

    // Store scraped UIDs in MongoDB for campaign analytics
    await mongoClient.writeCampaignResult({
      campaignId,
      taskId: `scrape-${sessionId}-${Date.now()}`,
      sessionId,
      action: 'scrape_members',
      outcome: 'success',
      data: { groupUrl, memberUids, count: memberUids.length },
    });

    // Clamp daily limit to valid range
    const limit = Math.min(
      Math.max(dmConfig.dailyLimit, MIN_DAILY_DM_LIMIT),
      MAX_DAILY_DM_LIMIT
    );

    let dmsSent = 0;

    for (const uid of memberUids.slice(0, limit)) {
      if (dmsSent >= limit) break;

      // Resolve spin syntax — unique message per recipient
      const message = spinParser.resolve(dmConfig.messageTemplate);

      // Send DM via inboxManager (uses human-like typing simulation)
      const dmSuccess = await inboxManager.sendDM(sessionId, uid, message);

      if (dmSuccess) {
        dmsSent++;

        // Upsert contact record via contactManager
        contactManager.upsert(uid, { firstSeenVia: sessionId });

        // Log the interaction via contactManager
        contactManager.logInteraction(uid, sessionId, 'dm', 'sent', message);

        // Write per-DM result to MongoDB
        await mongoClient.writeCampaignResult({
          campaignId,
          taskId: `dm-${sessionId}-${uid}-${Date.now()}`,
          sessionId,
          action: 'send_dm',
          outcome: 'success',
          data: { uid, groupUrl, messagePreview: message.slice(0, 80) },
        });

        await randomDelay(DM_DELAY_MIN_MS, DM_DELAY_MAX_MS);
      }
    }

    db_.logActivity(sessionId, 'dm_outreach_complete', `Sent ${dmsSent} DMs from ${groupUrl}`);
    return { success: true, result: { groupUrl, membersFound: memberUids.length, dmsSent } };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Detect checkpoint/restriction from error messages
    if (message.toLowerCase().includes('checkpoint') || message.toLowerCase().includes('restricted')) {
      db_.updateSession(sessionId, { healthStatus: 'restricted' });
      db_.logActivity(sessionId, 'session_paused_checkpoint', `Session paused: ${message}`);
    }

    return { success: false, error: message };
  }
}


// ─────────────────────────────────────────────
// MEMBER SCRAPING
// ─────────────────────────────────────────────

/**
 * Scrapes member UIDs from a Facebook group's members page.
 * Scrolls to load more members before extracting profile links.
 *
 * @param page     - The Playwright page to use for scraping.
 * @param groupUrl - The Facebook group URL (members page is derived from this).
 * @returns Array of Facebook UIDs found on the members page.
 */
async function scrapeGroupMembers(
  page: import('playwright-core').Page,
  groupUrl: string
): Promise<string[]> {
  const uids: string[] = [];

  try {
    const membersUrl = groupUrl.replace(/\/$/, '') + '/members';
    await page.goto(membersUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(NAV_SETTLE_MS);

    // Scroll to load more members
    for (let i = 0; i < MEMBER_SCROLL_ITERATIONS; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(1_500);
    }

    // Extract profile links — /user/UID or profile.php?id=UID formats
    const profileLinks = await page.$$('a[href*="/user/"], a[href*="profile.php"]');

    for (const link of profileLinks) {
      const href = await link.getAttribute('href');
      if (!href) continue;

      // Extract UID from /user/123456789 or profile.php?id=123456789
      const uidMatch = href.match(/\/user\/(\d+)/) ?? href.match(/[?&]id=(\d+)/);
      if (uidMatch && !uids.includes(uidMatch[1])) {
        uids.push(uidMatch[1]);
      }
    }
  } catch {
    // Scraping failure is non-critical — return whatever was collected
  }

  return uids;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Returns a random delay value between minMs and maxMs (inclusive).
 *
 * @param minMs - Minimum delay in milliseconds.
 * @param maxMs - Maximum delay in milliseconds.
 * @returns A random number of milliseconds in the given range.
 */
function randomDelayValue(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

/**
 * Waits for a random duration between minMs and maxMs.
 * Used to simulate human-like pacing between automation actions.
 *
 * @param minMs - Minimum delay in milliseconds.
 * @param maxMs - Maximum delay in milliseconds.
 */
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, randomDelayValue(minMs, maxMs)));
}

/**
 * Waits for a fixed duration.
 *
 * @param ms - Duration in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// NAMED ENTRY POINT (task-spec signature)
// ─────────────────────────────────────────────

/**
 * Starts a Group Hunter job using the canonical task-spec parameter signature.
 * Wraps `start(config)` for callers that prefer explicit positional parameters.
 *
 * @param sessionIds - IDs of sessions that will participate.
 * @param targets    - Target group URLs, group IDs, or search keywords.
 * @param phases     - Which phases to run and their configuration.
 * @returns The created Campaign record.
 *
 * @example
 * const campaign = await groupHunter.startGroupHunterJob(
 *   ['session-1', 'session-2'],
 *   ['https://facebook.com/groups/123', 'buy sell dhaka'],
 *   { join: true, post: { content: '{Check this|Look here}!', timing: 'burst' } }
 * )
 */
async function startGroupHunterJob(
  sessionIds: string[],
  targets: string[],
  phases: GroupHunterConfig['phases']
): Promise<Campaign> {
  return start({ sessionIds, targets, phases });
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The Group Hunter tool — mass-joins Facebook groups and runs post/DM campaigns.
 *
 * Phases:
 *  - join: Navigate to each group and click Join. Tracks status per session/group.
 *  - post: Resolve spin syntax and post content to joined groups.
 *  - dm:   Scrape member UIDs, upsert contacts, send DMs via inboxManager.
 *
 * @example
 * import { groupHunter } from '../tools/group-hunter'
 *
 * // Using the config object form:
 * const campaign = await groupHunter.start({
 *   sessionIds: ['session-1', 'session-2'],
 *   targets: ['https://facebook.com/groups/123', 'buy sell dhaka'],
 *   phases: { join: true, post: { content: 'Check this out!', timing: 'burst' } },
 * })
 *
 * // Using the positional parameter form:
 * const campaign = await groupHunter.startGroupHunterJob(
 *   ['session-1', 'session-2'],
 *   ['https://facebook.com/groups/123'],
 *   { join: true }
 * )
 */
export const groupHunter = {
  /** Starts a Group Hunter job using a config object. Returns the created campaign. */
  start,
  /** Starts a Group Hunter job using positional parameters (sessionIds, targets, phases). */
  startGroupHunterJob,
};
