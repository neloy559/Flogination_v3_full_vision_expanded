/**
 * Flogination V5 — Comment Marketing Engine
 *
 * Drops comments across Facebook posts, reels, and pages from multiple accounts
 * with AI-generated or spin-syntax unique content per session.
 *
 * Three operational stances:
 *
 * 1. URL Promotion (url_promotion):
 *    - Find viral posts by keyword with engagement threshold filter.
 *    - Each session drops a unique comment embedding the promo URL via spinParser.
 *
 * 2. Reels Commenting (reels_commenting):
 *    - Find reels by keyword or direct URL.
 *    - Optional: reply to the top-liked comment (thread hijacking).
 *
 * 3. Page/Product Review (page_review):
 *    - AI generates unique review per session (falls back to spin syntax on AI error).
 *
 * Rate-limit handling:
 *    - Cool-down 30min–24h when Facebook signals rate-limiting.
 *    - Other sessions continue unaffected.
 *    - Non-rate-limit errors mark the task as failed immediately.
 */

import { db_ } from '../database';
import { sessionManager } from '../automation/session-manager';
import { selfHealing } from '../automation/self-healing';
import { campaignEngine } from '../campaigns/campaign-engine';
import { mongoClient } from '../utils/mongo-client';
import { spinParser } from '../utils/spin-parser';
import { aiGateway } from '../utils/ai-gateway';
import { S } from '../utils/selector-resolver';
import type { Campaign } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Default minimum engagement (likes + comments + shares) for a "viral" post. */
const DEFAULT_VIRAL_THRESHOLD = 100;

/** Minimum delay between consecutive comments from the same session. */
const COMMENT_DELAY_MIN_MS = 2 * 60_000;   // 2 minutes

/** Maximum delay between consecutive comments from the same session. */
const COMMENT_DELAY_MAX_MS = 15 * 60_000;  // 15 minutes

/** Minimum cool-down when rate-limited (30 minutes). */
const COOLDOWN_MIN_MS = 30 * 60_000;

/** Maximum cool-down when rate-limited (24 hours). */
const COOLDOWN_MAX_MS = 24 * 60 * 60_000;

/** Default cool-down when rate-limited (2 hours). */
const DEFAULT_COOLDOWN_MS = 2 * 60 * 60_000;

/** Maximum comment length Facebook allows. */
const MAX_COMMENT_LENGTH = 8_000;

/** Maximum posts to collect per keyword search. */
const MAX_SEARCH_RESULTS = 20;

/** Number of scroll passes when searching for posts/reels. */
const SEARCH_SCROLL_PASSES = 3;

/** Delay between scroll passes in milliseconds. */
const SCROLL_PASS_DELAY_MS = 1_500;

/** Delay after page navigation before interacting. */
const PAGE_LOAD_SETTLE_MS = 2_000;

/** Delay after clicking comment input before typing. */
const CLICK_SETTLE_MS = 500;

/** Delay after typing before submitting. */
const PRE_SUBMIT_DELAY_MS = 500;

/** Delay after submitting to confirm the comment posted. */
const POST_SUBMIT_DELAY_MS = 1_500;

/** Keywords that indicate Facebook rate-limiting in page text. */
const RATE_LIMIT_SIGNALS = [
  'temporarily blocked',
  'rate limit',
  'you\'re temporarily blocked',
  'action blocked',
  'you can\'t use this feature right now',
];


// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** The operational stance for a comment campaign. */
export type CommentStance = 'url_promotion' | 'reels_commenting' | 'page_review';

/** Timing mode for comment delivery. */
export type CommentTiming = 'burst' | 'drip';

/** Configuration for a Comment Engine job. */
export interface CommentJobConfig {
  /** IDs of sessions that will post comments. */
  sessionIds: string[];
  /** The operational stance. */
  stance: CommentStance;
  /** Target inputs: keywords, page URLs, group URLs, or direct post/reel URLs. */
  targets: string[];
  /** Comment content template with optional {spin|syntax} tokens. */
  contentTemplate: string;
  /** URL to embed in comments (url_promotion stance only). */
  promoUrl?: string;
  /** Minimum engagement score for viral post detection. */
  viralThreshold?: number;
  /** 'burst' = comment immediately, 'drip' = spread over dripHours. */
  timing: CommentTiming;
  /** Hours to spread comments over (drip mode). */
  dripHours?: number;
  /** Max comments per session per day. */
  maxCommentsPerSessionPerDay?: number;
  /** Cool-down in ms when rate-limited (clamped to 30min–24h). */
  cooldownMs?: number;
  /** Whether to reply to the top-liked comment (reels_commenting stance). */
  replyToTopComment?: boolean;
  /** Page name for AI review generation (page_review stance). */
  pageName?: string;
  /** Product description for AI review generation (page_review stance). */
  productDescription?: string;
}

/** Result of a single comment task execution. */
interface CommentTaskResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}


// ─────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────

/**
 * Starts a Comment Engine campaign.
 *
 * Creates a campaign via campaignEngine for tracking, resolves target URLs
 * based on stance, then runs one comment task per session × target pair.
 *
 * @param sessionIds     - IDs of sessions that will post comments.
 * @param stance         - Operational stance: url_promotion, reels_commenting, or page_review.
 * @param targets        - Keywords or direct URLs to target.
 * @param contentTemplate - Spin-syntax comment template.
 * @param timing         - 'burst' or 'drip' delivery mode.
 * @param options        - Additional optional configuration.
 * @returns The created Campaign record.
 *
 * @example
 * const campaign = await commentEngine.startCommentJob(
 *   ['session-1', 'session-2'],
 *   'url_promotion',
 *   ['viral marketing tips'],
 *   '{Check this out|Have a look}: {promoUrl}',
 *   'drip',
 *   { promoUrl: 'https://example.com', dripHours: 4 }
 * )
 */
async function startCommentJob(
  sessionIds: string[],
  stance: CommentStance,
  targets: string[],
  contentTemplate: string,
  timing: CommentTiming,
  options: Omit<CommentJobConfig, 'sessionIds' | 'stance' | 'targets' | 'contentTemplate' | 'timing'> = {}
): Promise<Campaign> {
  const config: CommentJobConfig = {
    sessionIds,
    stance,
    targets,
    contentTemplate,
    timing,
    ...options,
  };

  // Resolve target post/reel URLs based on stance
  const resolvedTargets = await resolveTargets(config);

  if (resolvedTargets.length === 0) {
    throw new Error('No valid targets found. Check your URLs or keywords.');
  }

  // Build tasks: one per session per target
  const tasks: Array<{ sessionId: string; action: string }> = [];
  for (const sessionId of sessionIds) {
    for (const targetUrl of resolvedTargets) {
      tasks.push({ sessionId, action: `comment:${targetUrl}` });
    }
  }

  const campaign = campaignEngine.create(
    `Comment Engine (${stance}) — ${resolvedTargets.length} targets × ${sessionIds.length} sessions`,
    'comment_engine',
    { ...config, resolvedTargets } as unknown as Record<string, unknown>,
    tasks
  );

  await campaignEngine.start(campaign.id, async (task) => {
    const targetUrl = task.action.replace('comment:', '');
    return executeCommentTask(task.sessionId, targetUrl, config, campaign.id);
  });

  return campaign;
}


// ─────────────────────────────────────────────
// TARGET RESOLUTION
// ─────────────────────────────────────────────

/**
 * Resolves target inputs to post/reel URLs based on the campaign stance.
 * Direct https:// URLs are used as-is; keywords trigger a Facebook search.
 */
async function resolveTargets(config: CommentJobConfig): Promise<string[]> {
  const resolved: string[] = [];
  const sessionId = config.sessionIds[0];

  for (const target of config.targets) {
    if (target.startsWith('https://')) {
      // Direct URL — use as-is
      resolved.push(target);
    } else {
      // Keyword — search for posts or reels
      const threshold = config.viralThreshold ?? DEFAULT_VIRAL_THRESHOLD;
      const searchResults = config.stance === 'reels_commenting'
        ? await searchReels(target, sessionId, threshold)
        : await searchViralPosts(target, sessionId, threshold);

      if (searchResults.length === 0) {
        db_.logActivity(
          sessionId,
          'no_targets_found',
          `No ${config.stance === 'reels_commenting' ? 'reels' : 'posts'} found for keyword: "${target}"`
        );
      }

      resolved.push(...searchResults);
    }
  }

  return [...new Set(resolved)]; // deduplicate
}

/**
 * Searches Facebook for viral posts matching a keyword.
 * Filters by engagement threshold: posts where the visible reaction/comment
 * count text contains a number ≥ threshold are included.
 *
 * @param keyword   - Search keyword.
 * @param sessionId - Session to use for the search.
 * @param threshold - Minimum engagement count to qualify as viral.
 * @returns Array of post URLs meeting the engagement threshold.
 */
async function searchViralPosts(
  keyword: string,
  sessionId: string,
  threshold: number
): Promise<string[]> {
  const page = sessionManager.getPage(sessionId);
  if (!page) return [];

  const results: string[] = [];

  try {
    const searchUrl = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(PAGE_LOAD_SETTLE_MS);

    // Scroll to load more posts
    for (let i = 0; i < SEARCH_SCROLL_PASSES; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(SCROLL_PASS_DELAY_MS);
    }

    // Extract post links with engagement data
    // Each post article contains reaction counts in aria-label or text spans
    const postData = await page.evaluate((thresh: number) => {
      const posts: Array<{ url: string; engagement: number }> = [];

      // Find all post containers
      const articles = document.querySelectorAll('div[data-pagelet*="FeedUnit"], div[role="article"]');

      articles.forEach((article) => {
        // Extract post URL from the timestamp link (most reliable)
        const timeLink = article.querySelector('a[href*="/posts/"], a[href*="story_fbid="], a[href*="/permalink/"]');
        if (!timeLink) return;

        const href = timeLink.getAttribute('href') ?? '';
        const url = href.startsWith('http') ? href : `https://www.facebook.com${href}`;

        // Extract engagement count from reaction/comment spans
        // Facebook shows counts like "1.2K", "234", "5K" in aria-labels or text
        let engagement = 0;

        // Try aria-label on reaction summary
        const reactionEl = article.querySelector('[aria-label*="reaction"], [aria-label*="people reacted"]');
        if (reactionEl) {
          const label = reactionEl.getAttribute('aria-label') ?? '';
          const match = label.match(/[\d,]+/);
          if (match) {
            engagement += parseInt(match[0].replace(/,/g, ''), 10);
          }
        }

        // Try comment count spans
        const commentSpans = article.querySelectorAll('span');
        commentSpans.forEach((span) => {
          const text = span.textContent?.trim() ?? '';
          // Match patterns like "234 comments", "1.2K comments"
          const commentMatch = text.match(/^([\d,.]+[KkMm]?)\s+comment/i);
          if (commentMatch) {
            const raw = commentMatch[1].replace(/,/g, '');
            const multiplier = /[Kk]/.test(raw) ? 1000 : /[Mm]/.test(raw) ? 1_000_000 : 1;
            engagement += Math.round(parseFloat(raw) * multiplier);
          }
        });

        if (engagement >= thresh && url.includes('facebook.com')) {
          posts.push({ url, engagement });
        }
      });

      return posts;
    }, threshold);

    for (const post of postData) {
      if (!results.includes(post.url)) {
        results.push(post.url);
        if (results.length >= MAX_SEARCH_RESULTS) break;
      }
    }

    // Fallback: if engagement filtering yielded nothing, collect links without filtering
    if (results.length === 0) {
      const postLinks = await page.$$('a[href*="/posts/"], a[href*="story_fbid="]');
      for (const link of postLinks) {
        const href = await link.getAttribute('href');
        if (href) {
          const url = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
          if (!results.includes(url)) {
            results.push(url);
            if (results.length >= MAX_SEARCH_RESULTS) break;
          }
        }
      }
    }
  } catch {
    // Non-critical — return whatever was collected
  }

  return results;
}


/**
 * Searches Facebook for reels matching a keyword.
 * Collects reel URLs from the video search results page.
 *
 * @param keyword   - Search keyword.
 * @param sessionId - Session to use for the search.
 * @param _threshold - Engagement threshold (reserved for future reel engagement filtering).
 * @returns Array of reel URLs.
 */
async function searchReels(
  keyword: string,
  sessionId: string,
  _threshold: number
): Promise<string[]> {
  const page = sessionManager.getPage(sessionId);
  if (!page) return [];

  const results: string[] = [];

  try {
    const searchUrl = `https://www.facebook.com/search/videos/?q=${encodeURIComponent(keyword)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(PAGE_LOAD_SETTLE_MS);

    for (let i = 0; i < SEARCH_SCROLL_PASSES; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await sleep(SCROLL_PASS_DELAY_MS);
    }

    const videoLinks = await page.$$('a[href*="/reel/"], a[href*="/videos/"]');
    for (const link of videoLinks) {
      const href = await link.getAttribute('href');
      if (href) {
        const url = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
        if (!results.includes(url)) {
          results.push(url);
          if (results.length >= MAX_SEARCH_RESULTS) break;
        }
      }
    }
  } catch {
    // Non-critical
  }

  return results;
}


// ─────────────────────────────────────────────
// COMMENT TASK EXECUTOR
// ─────────────────────────────────────────────

/**
 * Executes a single comment task for one session × target URL pair.
 *
 * Flow:
 *  1. Ensure session browser is running (launch if needed).
 *  2. Generate unique comment content for this session.
 *  3. Navigate to target URL.
 *  4. Post comment (or reply to top comment for reels_commenting).
 *  5. Detect rate-limit signals and apply cool-down if triggered.
 *  6. Write result to MongoDB campaign_results.
 *  7. Apply inter-comment delay.
 *
 * @param sessionId  - The session posting the comment.
 * @param targetUrl  - The Facebook post/reel URL to comment on.
 * @param config     - The full campaign configuration.
 * @param campaignId - The campaign ID for result tracking.
 * @returns Success or failure with details.
 */
async function executeCommentTask(
  sessionId: string,
  targetUrl: string,
  config: CommentJobConfig,
  campaignId: string
): Promise<CommentTaskResult> {
  // Ensure browser is running for this session
  let page = sessionManager.getPage(sessionId);
  if (!page) {
    const launchResult = await sessionManager.launch(sessionId, false);
    if (!launchResult.success) {
      return { success: false, error: `Failed to launch browser: ${launchResult.error}` };
    }
    page = sessionManager.getPage(sessionId);
  }

  if (!page) {
    return { success: false, error: 'Page not available after launch' };
  }

  try {
    // Generate unique comment content for this session
    const commentText = await generateCommentContent(config, sessionId);

    if (!commentText || commentText.length === 0) {
      return { success: false, error: 'Could not generate comment content' };
    }

    if (commentText.length > MAX_COMMENT_LENGTH) {
      return { success: false, error: `Comment exceeds ${MAX_COMMENT_LENGTH} character limit` };
    }

    // Navigate to target
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(PAGE_LOAD_SETTLE_MS);

    // Post comment based on stance and configuration
    let posted = false;

    if (config.stance === 'reels_commenting' && config.replyToTopComment) {
      // Try to reply to the top-liked comment; fall back to top-level
      posted = await replyToTopComment(page, commentText, sessionId);
      if (!posted) {
        posted = await postTopLevelComment(page, commentText, sessionId);
      }
    } else {
      posted = await postTopLevelComment(page, commentText, sessionId);
    }

    if (!posted) {
      // Check if rate-limited before marking as a generic failure
      const pageText = await page.textContent('body').catch(() => '');
      const isRateLimited = RATE_LIMIT_SIGNALS.some((signal) =>
        (pageText ?? '').toLowerCase().includes(signal.toLowerCase())
      );

      if (isRateLimited) {
        const cooldownMs = clampCooldown(config.cooldownMs ?? DEFAULT_COOLDOWN_MS);
        db_.logActivity(
          sessionId,
          'comment_rate_limited',
          `Rate limited on ${targetUrl}. Cooling down for ${Math.round(cooldownMs / 60_000)} minutes.`,
          campaignId
        );
        await sleep(cooldownMs);
        return { success: false, error: `Rate limited — cooled down for ${Math.round(cooldownMs / 60_000)} minutes` };
      }

      return { success: false, error: 'Could not post comment — element not found or action blocked' };
    }

    // Write result to MongoDB campaign_results
    await mongoClient.writeCampaignResult({
      campaignId,
      taskId: `comment-${sessionId}-${Date.now()}`,
      sessionId,
      action: 'comment_posted',
      outcome: 'success',
      data: {
        targetUrl,
        stance: config.stance,
        commentPreview: commentText.slice(0, 100),
        commentLength: commentText.length,
        timestamp: new Date().toISOString(),
      },
    });

    db_.logActivity(sessionId, 'comment_delivered', `Comment posted on ${targetUrl}`, campaignId);

    // Apply inter-comment delay (randomized 2–15 min, or drip spread)
    const delayMs = config.timing === 'drip' && config.dripHours
      ? Math.random() * config.dripHours * 60 * 60_000
      : randomDelayValue(COMMENT_DELAY_MIN_MS, COMMENT_DELAY_MAX_MS);

    await sleep(delayMs);

    return { success: true, result: { targetUrl, commentLength: commentText.length } };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Mark failed on non-rate-limit errors
    db_.logActivity(sessionId, 'comment_failed', `${message} on ${targetUrl}`, campaignId);
    return { success: false, error: message };
  }
}


// ─────────────────────────────────────────────
// CONTENT GENERATION
// ─────────────────────────────────────────────

/**
 * Generates unique comment content for a session based on the campaign stance.
 *
 * Stance logic:
 *  - page_review: AI generateReview per session; spin fallback on AI error.
 *  - url_promotion: spinParser.resolve with promoUrl substituted into template.
 *  - reels_commenting: spinParser.resolve on the content template.
 *
 * @param config    - The campaign configuration.
 * @param sessionId - The session generating content (used for logging).
 * @returns The resolved comment string.
 */
async function generateCommentContent(
  config: CommentJobConfig,
  sessionId: string
): Promise<string> {
  const settings = db_.getSettings();

  // page_review stance: try AI first, fall back to spin syntax on any AI error
  if (config.stance === 'page_review') {
    if (settings.ai.enabled) {
      try {
        const aiResult = await aiGateway.generateReview(
          settings.ai,
          config.pageName ?? 'this page',
          config.productDescription ?? 'product or service',
          'positive'
        );
        if (aiResult.success && aiResult.content && aiResult.content.trim().length > 0) {
          return aiResult.content.trim();
        }
        // AI returned empty or failed — fall through to spin syntax
        db_.logActivity(
          sessionId,
          'ai_review_fallback',
          `AI review failed (${aiResult.error ?? 'empty response'}), using spin syntax`
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        db_.logActivity(sessionId, 'ai_review_fallback', `AI review threw: ${message}, using spin syntax`);
      }
    }
    // Spin syntax fallback for page_review
    return spinParser.resolve(config.contentTemplate);
  }

  // url_promotion: embed promo URL into spin-resolved template
  if (config.stance === 'url_promotion' && config.promoUrl) {
    const templateWithUrl = config.contentTemplate.replace(/\{promoUrl\}/gi, config.promoUrl);
    return spinParser.resolve(templateWithUrl);
  }

  // reels_commenting and url_promotion without promoUrl: resolve spin syntax
  return spinParser.resolve(config.contentTemplate);
}


// ─────────────────────────────────────────────
// COMMENT POSTING
// ─────────────────────────────────────────────

/**
 * Posts a top-level comment on the current page using selfHealing.withHealing
 * for all Playwright element interactions.
 *
 * @param page        - The Playwright page to interact with.
 * @param commentText - The comment text to post.
 * @param sessionId   - The session ID (for logging).
 * @returns True if the comment was posted successfully.
 */
async function postTopLevelComment(
  page: import('playwright-core').Page,
  commentText: string,
  sessionId: string
): Promise<boolean> {
  try {
    // Click the comment input to focus it
    const inputResult = await selfHealing.withHealing(
      page,
      'fb_comment_input',
      S.COMMENT_INPUT,
      async (sel) => {
        await page.click(sel);
        await sleep(CLICK_SETTLE_MS);
      }
    );
    if (!inputResult.success) {
      db_.logActivity(sessionId, 'comment_input_not_found', 'Could not locate comment input');
      return false;
    }

    // Type the comment text
    await page.keyboard.type(commentText, { delay: 40 });
    await sleep(PRE_SUBMIT_DELAY_MS);

    // Submit with Enter
    await page.keyboard.press('Enter');
    await sleep(POST_SUBMIT_DELAY_MS);

    return true;
  } catch {
    return false;
  }
}

/**
 * Replies to the top-liked comment on a reel or post.
 * Identifies the top comment by finding the first comment with the highest
 * visible like count, then clicks its Reply button.
 * Falls back gracefully — returns false if no comments are found.
 *
 * @param page        - The Playwright page to interact with.
 * @param commentText - The reply text to post.
 * @param sessionId   - The session ID (for logging).
 * @returns True if the reply was posted successfully.
 */
async function replyToTopComment(
  page: import('playwright-core').Page,
  commentText: string,
  sessionId: string
): Promise<boolean> {
  try {
    // Find all top-level comment containers
    const commentContainers = await page.$$(
      '[data-testid="UFI2Comment/root_depth_0"], [aria-label*="comment"], div[role="article"]'
    );

    if (commentContainers.length === 0) return false;

    // Find the comment with the highest like count by reading aria-labels
    let topCommentIndex = 0;
    let topLikeCount = -1;

    for (let i = 0; i < commentContainers.length; i++) {
      try {
        const likeLabel = await commentContainers[i].$('[aria-label*="reaction"], [aria-label*="Like"]');
        if (likeLabel) {
          const label = await likeLabel.getAttribute('aria-label') ?? '';
          const match = label.match(/(\d[\d,]*)/);
          if (match) {
            const count = parseInt(match[1].replace(/,/g, ''), 10);
            if (count > topLikeCount) {
              topLikeCount = count;
              topCommentIndex = i;
            }
          }
        }
      } catch {
        // Skip this comment if we can't read its like count
      }
    }

    // Scroll the top comment into view
    await commentContainers[topCommentIndex].scrollIntoViewIfNeeded();
    await sleep(CLICK_SETTLE_MS);

    // Click the Reply button on the top comment using selfHealing
    const replyResult = await selfHealing.withHealing(
      page,
      'fb_comment_reply_button',
      S.REPLY_BUTTON,
      async (sel) => {
        await page.click(sel);
        await sleep(CLICK_SETTLE_MS);
      }
    );
    if (!replyResult.success) return false;

    // Type the reply
    await page.keyboard.type(commentText, { delay: 40 });
    await sleep(PRE_SUBMIT_DELAY_MS);
    await page.keyboard.press('Enter');
    await sleep(POST_SUBMIT_DELAY_MS);

    db_.logActivity(sessionId, 'comment_reply_posted', 'Replied to top-liked comment');
    return true;
  } catch {
    return false;
  }
}


// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Returns a random delay value between minMs and maxMs (inclusive).
 *
 * @param minMs - Minimum delay in milliseconds.
 * @param maxMs - Maximum delay in milliseconds.
 * @returns A random value in [minMs, maxMs].
 */
function randomDelayValue(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

/**
 * Clamps a cool-down value to the valid range of 30 minutes to 24 hours.
 * Prevents excessively short or long cool-downs from misconfiguration.
 *
 * @param ms - Requested cool-down in milliseconds.
 * @returns Clamped value in [COOLDOWN_MIN_MS, COOLDOWN_MAX_MS].
 */
function clampCooldown(ms: number): number {
  return Math.min(Math.max(ms, COOLDOWN_MIN_MS), COOLDOWN_MAX_MS);
}

/**
 * Returns a Promise that resolves after the specified number of milliseconds.
 *
 * @param ms - Duration to sleep in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The Comment Marketing Engine — drops unique comments across Facebook at scale.
 *
 * Supports three stances:
 *  - url_promotion: viral post discovery + spin-syntax promo URL embedding
 *  - reels_commenting: reel discovery + optional top-comment reply
 *  - page_review: AI-generated reviews with spin-syntax fallback
 *
 * All stances apply randomized 2–15 min delays between comments and
 * 30min–24h cool-downs on rate-limit detection.
 *
 * @example
 * import { commentEngine } from '../tools/comment-engine'
 *
 * // URL Promotion:
 * await commentEngine.startCommentJob(
 *   ['s1', 's2'],
 *   'url_promotion',
 *   ['viral marketing tips'],
 *   '{Check this|Look at this}: {promoUrl}',
 *   'drip',
 *   { promoUrl: 'https://example.com', dripHours: 6 }
 * )
 *
 * // Page Review:
 * await commentEngine.startCommentJob(
 *   ['s1', 's2'],
 *   'page_review',
 *   ['https://facebook.com/SomePage'],
 *   '{Great service|Highly recommend} this page',
 *   'drip',
 *   { pageName: 'TechStore BD', productDescription: 'electronics and gadgets', dripHours: 24 }
 * )
 *
 * // Reels Commenting with top-comment reply:
 * await commentEngine.startCommentJob(
 *   ['s1', 's2'],
 *   'reels_commenting',
 *   ['funny cats'],
 *   '{Haha this is great|So funny!}',
 *   'burst',
 *   { replyToTopComment: true }
 * )
 */
export const commentEngine = {
  /**
   * Starts a Comment Engine campaign.
   * Creates a campaign for tracking, resolves targets, and runs one comment
   * task per session × target pair.
   */
  startCommentJob,
};
