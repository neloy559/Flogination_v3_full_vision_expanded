/**
 * Flogination V5 — Content Amplifier
 *
 * Two modes:
 *
 * Mode 1 — Post Seeder:
 *  Boosts a specific post with likes, reacts, comments, shares, and saves
 *  from multiple sessions to signal organic engagement to Facebook's algorithm.
 *
 * Mode 2 — Video Watch Farm:
 *  Multiple sessions watch a video for a configured duration to accumulate
 *  watch time toward Facebook's monetization threshold (4,000 hours / 365 days).
 *
 * Both modes use stealth browsers with human-like interaction patterns.
 */

import { db_ } from '../database';
import { sessionManager } from '../automation/session-manager';
import { selfHealing } from '../automation/self-healing';
import { campaignEngine } from '../campaigns/campaign-engine';
import { mongoClient } from '../utils/mongo-client';
import { spinParser } from '../utils/spin-parser';
import type { Campaign } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Minimum warm-up score for video watch farm sessions. */
const MIN_WARM_SCORE_FOR_WATCH = 50;

/** Delay between consecutive actions from the same session. */
const ACTION_DELAY_MIN_MS = 2 * 60_000;
const ACTION_DELAY_MAX_MS = 15 * 60_000;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export interface PostSeederConfig {
  targetUrl: string;
  sessionIds: string[];
  actions: {
    like?: boolean;
    react?: boolean;
    comment?: boolean;
    share?: boolean;
    save?: boolean;
  };
  commentTemplate?: string;
  timing: 'burst' | 'drip';
  dripHours?: number;
}

export interface VideoWatchFarmConfig {
  targetUrl: string;
  sessionIds: string[];
  /** Watch duration as percentage of video length (50–100). */
  watchDurationPercent: number;
  /** Spread sessions over this many days. */
  scheduleDays?: number;
}

// ─────────────────────────────────────────────
// POST SEEDER
// ─────────────────────────────────────────────

/**
 * Starts a Post Seeder campaign.
 * Each session performs the configured engagement actions on the target post.
 */
async function startPostSeeder(config: PostSeederConfig): Promise<Campaign> {
  const tasks = config.sessionIds.map(id => ({
    sessionId: id,
    action: `seed_post:${config.targetUrl}`,
  }));

  const campaign = campaignEngine.create(
    `Post Seeder — ${config.targetUrl.slice(-20)}`,
    'content_amplifier',
    config as unknown as Record<string, unknown>,
    tasks
  );

  await campaignEngine.start(campaign.id, async (task) => {
    return executePostSeedTask(task.sessionId, config, campaign.id);
  });

  return campaign;
}

async function executePostSeedTask(
  sessionId: string,
  config: PostSeederConfig,
  campaignId: string
): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
  const page = sessionManager.getPage(sessionId);
  if (!page) {
    const result = await sessionManager.launch(sessionId, false);
    if (!result.success) return { success: false, error: result.error };
  }

  const activePage = sessionManager.getPage(sessionId);
  if (!activePage) return { success: false, error: 'Page not available' };

  try {
    await activePage.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(2000);

    const actionsPerformed: string[] = [];

    // Like
    if (config.actions.like) {
      const likeResult = await selfHealing.withHealing(
        activePage, 'fb_like_button',
        '[aria-label="Like"], [data-testid="like-button"]',
        async (sel) => activePage.click(sel)
      );
      if (likeResult.success) actionsPerformed.push('like');
      await sleep(1000 + Math.random() * 2000);
    }

    // React
    if (config.actions.react) {
      // Hover over like to show reaction picker
      const reactResult = await selfHealing.withHealing(
        activePage, 'fb_react_love',
        '[aria-label="Love"], [data-testid="love-reaction"]',
        async (sel) => activePage.click(sel)
      );
      if (reactResult.success) actionsPerformed.push('react');
      await sleep(1000 + Math.random() * 2000);
    }

    // Comment
    if (config.actions.comment && config.commentTemplate) {
      const commentText = spinParser.resolve(config.commentTemplate);
      const commentResult = await selfHealing.withHealing(
        activePage, 'fb_comment_input',
        '[data-testid="UFI2CommentFormBody/root"], [aria-label*="Write a comment"]',
        async (sel) => {
          await activePage.click(sel);
          await sleep(500);
          await activePage.keyboard.type(commentText, { delay: 40 });
          await sleep(300);
          await activePage.keyboard.press('Enter');
        }
      );
      if (commentResult.success) actionsPerformed.push('comment');
      await sleep(2000);
    }

    // Share
    if (config.actions.share) {
      const shareResult = await selfHealing.withHealing(
        activePage, 'fb_share_button',
        '[aria-label="Share"], [data-testid="share-button"]',
        async (sel) => activePage.click(sel)
      );
      if (shareResult.success) {
        await sleep(1000);
        // Click "Share now" in the share dialog
        await selfHealing.withHealing(
          activePage, 'fb_share_now',
          '[aria-label="Share now"], [data-testid="share-now"]',
          async (sel) => activePage.click(sel)
        );
        actionsPerformed.push('share');
      }
      await sleep(2000);
    }

    // Save
    if (config.actions.save) {
      const saveResult = await selfHealing.withHealing(
        activePage, 'fb_save_button',
        '[aria-label="Save post"], [data-testid="save-button"]',
        async (sel) => activePage.click(sel)
      );
      if (saveResult.success) actionsPerformed.push('save');
    }

    db_.logActivity(sessionId, 'post_seeded', `Actions: ${actionsPerformed.join(', ')} on ${config.targetUrl}`);

    await mongoClient.writeCampaignResult({
      campaignId,
      taskId: `seed-${sessionId}-${Date.now()}`,
      sessionId,
      action: 'post_seed',
      outcome: 'success',
      data: { targetUrl: config.targetUrl, actionsPerformed },
    });

    // Apply timing delay
    const delayMs = config.timing === 'drip' && config.dripHours
      ? Math.random() * config.dripHours * 60 * 60 * 1000
      : randomDelayValue(ACTION_DELAY_MIN_MS, ACTION_DELAY_MAX_MS);
    await sleep(delayMs);

    return { success: true, result: { actionsPerformed } };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// VIDEO WATCH FARM
// ─────────────────────────────────────────────

/**
 * Starts a Video Watch Farm campaign.
 * Sessions with warmUpScore > MIN_WARM_SCORE_FOR_WATCH are preferred.
 * Spreads sessions over scheduleDays to look natural.
 */
async function startVideoWatchFarm(config: VideoWatchFarmConfig): Promise<Campaign> {
  // Prefer warm sessions
  const warmSessions = config.sessionIds.filter(id => {
    const session = db_.getSessionById(id);
    return session?.healthStatus === 'live';
  });

  if (warmSessions.length === 0) {
    throw new Error('No live sessions available for video watch farm');
  }

  const tasks = warmSessions.map(id => ({
    sessionId: id,
    action: `watch_video:${config.targetUrl}`,
  }));

  const campaign = campaignEngine.create(
    `Video Watch Farm — ${config.targetUrl.slice(-20)}`,
    'content_amplifier',
    config as unknown as Record<string, unknown>,
    tasks
  );

  await campaignEngine.start(campaign.id, async (task) => {
    return executeVideoWatchTask(task.sessionId, config, campaign.id);
  });

  return campaign;
}

async function executeVideoWatchTask(
  sessionId: string,
  config: VideoWatchFarmConfig,
  campaignId: string
): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
  const page = sessionManager.getPage(sessionId);
  if (!page) {
    const result = await sessionManager.launch(sessionId, false);
    if (!result.success) return { success: false, error: result.error };
  }

  const activePage = sessionManager.getPage(sessionId);
  if (!activePage) return { success: false, error: 'Page not available' };

  try {
    await activePage.goto(config.targetUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await sleep(2000);

    // Click play intentionally (not autoplay)
    const playResult = await selfHealing.withHealing(
      activePage, 'fb_video_play_button',
      '[aria-label="Play video"], [data-testid="play-button"], video',
      async (sel) => activePage.click(sel)
    );

    if (!playResult.success) {
      return { success: false, error: 'Could not find video play button' };
    }

    // Get video duration and calculate watch time
    const videoDuration = await activePage.evaluate(() => {
      const video = document.querySelector('video');
      return video?.duration ?? 300; // default 5 min
    });

    const watchSeconds = Math.floor(videoDuration * (config.watchDurationPercent / 100));

    db_.logActivity(sessionId, 'video_watch_started', `Watching ${watchSeconds}s of ${config.targetUrl}`);

    // Simulate human watching behavior during the video
    const checkInterval = 30_000; // check every 30s
    let elapsed = 0;

    while (elapsed < watchSeconds * 1000) {
      await sleep(Math.min(checkInterval, (watchSeconds * 1000) - elapsed));
      elapsed += checkInterval;

      // Occasional scroll to simulate engagement
      if (Math.random() > 0.7) {
        await activePage.evaluate(() => window.scrollBy(0, Math.random() * 100 - 50));
      }
    }

    const minutesWatched = Math.round(watchSeconds / 60);

    db_.logActivity(sessionId, 'video_watch_completed', `Watched ${minutesWatched} minutes of ${config.targetUrl}`);

    await mongoClient.writeCampaignResult({
      campaignId,
      taskId: `watch-${sessionId}-${Date.now()}`,
      sessionId,
      action: 'video_watch',
      outcome: 'success',
      data: { targetUrl: config.targetUrl, minutesWatched, watchDurationPercent: config.watchDurationPercent },
    });

    return { success: true, result: { minutesWatched } };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function randomDelayValue(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

export const contentAmplifier = {
  startPostSeeder,
  startVideoWatchFarm,
};
