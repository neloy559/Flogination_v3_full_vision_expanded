/**
 * Flogination V5 — Inbox Warm-Up Engine
 *
 * Builds inbox activity for sessions to make them appear human and active
 * to Facebook's trust scoring system.
 *
 * Two modes:
 *
 * Internal mode:
 *  - Selected sessions message each other in a round-robin pattern.
 *  - No external contacts involved — purely internal traffic.
 *  - Randomized delays 5–60 minutes between sends.
 *  - Max messagesPerDay per session (1–20).
 *
 * External mode:
 *  - Monitors incoming messages for selected sessions.
 *  - Auto-generates and sends AI replies to real incoming messages.
 *  - Response delay: 2–30 minutes (configurable) to simulate human response time.
 *
 * Warm-Up Score (0–100):
 *  - msgsSent7d    × 0.40 weight
 *  - msgsReplied7d × 0.40 weight
 *  - accountAgeFactor × 0.20 weight (capped at 1 year)
 *
 * If a session's health changes to checkpoint/restricted/dead during a job,
 * that session's tasks are paused immediately.
 */

import { db_ } from '../database';
import { inboxManager } from './inbox-manager';
import { contactManager } from './contact-manager';
import { aiGateway } from '../utils/ai-gateway';
import { spinParser } from '../utils/spin-parser';
import type { WarmUpJob, WarmUpConfig } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Minimum delay between warm-up messages from the same session. */
const WARMUP_DELAY_MIN_MS = 5 * 60_000;   // 5 minutes

/** Maximum delay between warm-up messages from the same session. */
const WARMUP_DELAY_MAX_MS = 60 * 60_000;  // 60 minutes

/** Minimum response delay for external mode (simulates human thinking). */
const EXTERNAL_RESPONSE_MIN_MS = 2 * 60_000;   // 2 minutes

/** Maximum response delay for external mode. */
const EXTERNAL_RESPONSE_MAX_MS = 30 * 60_000;  // 30 minutes

/** Score weights for warm-up score calculation. */
const SCORE_WEIGHT_SENT    = 0.40;
const SCORE_WEIGHT_REPLIED = 0.40;
const SCORE_WEIGHT_AGE     = 0.20;

/** One year in milliseconds — used for account age score cap. */
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

/** Active warm-up job runners keyed by jobId. */
const activeJobs = new Map<string, { stopRequested: boolean }>();

// ─────────────────────────────────────────────
// JOB LIFECYCLE
// ─────────────────────────────────────────────

/**
 * Creates and starts a warm-up job.
 *
 * @param mode       - 'internal' (sessions message each other) or 'external' (AI replies to real messages).
 * @param sessionIds - The sessions to include in the warm-up job.
 * @param config     - Warm-up configuration parameters.
 * @returns The created WarmUpJob record.
 *
 * @example
 * const job = await warmupEngine.createJob('internal', ['s1', 's2', 's3'], {
 *   messagesPerDay: 5,
 *   durationDays: 7,
 *   responseDelayMinMs: 300000,
 *   responseDelayMaxMs: 1800000,
 *   messageTemplates: ['{Hey|Hi}! {How are you|What\'s up}?', 'Just checking in!'],
 * })
 */
async function createJob(
  mode: 'internal' | 'external',
  sessionIds: string[],
  config: WarmUpConfig
): Promise<WarmUpJob> {
  const job = db_.createWarmUpJob({
    mode,
    sessionIds: JSON.stringify(sessionIds),
    config: JSON.stringify(config),
    status: 'running',
  });

  // Start the job in background
  runJob(job.id, mode, sessionIds, config).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[warmup-engine] Job ${job.id} error: ${message}`);
    db_.updateWarmUpJob(job.id, { status: 'completed' });
  });

  return job;
}

/**
 * Starts an existing warm-up job that is not currently running.
 * Use this to kick off a job that was created with status 'paused' or 'completed',
 * or to manually start a job that was not auto-started.
 *
 * @param jobId - The ID of the warm-up job to start.
 * @returns Success or failure with an error message.
 *
 * @example
 * const result = await warmupEngine.startJob('job-uuid')
 * if (!result.success) console.error(result.error)
 */
async function startJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  const job = db_.getWarmUpJobById(jobId);
  if (!job) return { success: false, error: 'Job not found' };

  // If already running in memory, do not double-start
  if (activeJobs.has(jobId)) {
    return { success: false, error: 'Job is already running' };
  }

  const sessionIds: string[] = JSON.parse(job.sessionIds);
  const config: WarmUpConfig = JSON.parse(job.config);

  db_.updateWarmUpJob(jobId, { status: 'running' });

  runJob(jobId, job.mode as 'internal' | 'external', sessionIds, config).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[warmup-engine] Job ${jobId} error: ${message}`);
    db_.updateWarmUpJob(jobId, { status: 'completed' });
  });

  return { success: true };
}

/**
 * Pauses a running warm-up job.
 */
function pauseJob(jobId: string): { success: boolean; error?: string } {
  const running = activeJobs.get(jobId);
  if (!running) return { success: false, error: 'Job not running' };

  running.stopRequested = true;
  db_.updateWarmUpJob(jobId, { status: 'paused' });
  return { success: true };
}

/**
 * Resumes a paused warm-up job.
 */
async function resumeJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  const job = db_.getWarmUpJobs().find((j) => j.id === jobId);
  if (!job) return { success: false, error: 'Job not found' };
  if (job.status !== 'paused') return { success: false, error: 'Job is not paused' };

  const sessionIds: string[] = JSON.parse(job.sessionIds);
  const config: WarmUpConfig = JSON.parse(job.config);

  db_.updateWarmUpJob(jobId, { status: 'running' });

  runJob(jobId, job.mode as 'internal' | 'external', sessionIds, config).catch(() => {});
  return { success: true };
}

/**
 * Deletes a warm-up job and stops it if running.
 */
function deleteJob(jobId: string): boolean {
  const running = activeJobs.get(jobId);
  if (running) running.stopRequested = true;
  return db_.deleteWarmUpJob(jobId);
}

// ─────────────────────────────────────────────
// JOB RUNNER
// ─────────────────────────────────────────────

/**
 * Runs a warm-up job until completion, pause, or stop request.
 */
async function runJob(
  jobId: string,
  mode: 'internal' | 'external',
  sessionIds: string[],
  config: WarmUpConfig
): Promise<void> {
  const state = { stopRequested: false };
  activeJobs.set(jobId, state);

  try {
    if (mode === 'internal') {
      await runInternalMode(jobId, sessionIds, config, state);
    } else {
      await runExternalMode(jobId, sessionIds, config, state);
    }
  } finally {
    activeJobs.delete(jobId);
    const job = db_.getWarmUpJobs().find((j) => j.id === jobId);
    if (job && job.status === 'running') {
      db_.updateWarmUpJob(jobId, { status: 'completed' });
    }
  }
}

// ─────────────────────────────────────────────
// INTERNAL MODE
// ─────────────────────────────────────────────

/**
 * Runs internal warm-up: sessions message each other in round-robin.
 * Continues for durationDays, respecting messagesPerDay limit per session.
 */
async function runInternalMode(
  jobId: string,
  sessionIds: string[],
  config: WarmUpConfig,
  state: { stopRequested: boolean }
): Promise<void> {
  if (sessionIds.length < 2) {
    console.warn('[warmup-engine] Internal mode requires at least 2 sessions');
    return;
  }

  const endTime = Date.now() + config.durationDays * 24 * 60 * 60 * 1_000;
  const dailySentCount = new Map<string, number>();
  let lastResetDay = new Date().toDateString();

  while (Date.now() < endTime && !state.stopRequested) {
    // Reset daily counts at midnight
    const today = new Date().toDateString();
    if (today !== lastResetDay) {
      dailySentCount.clear();
      lastResetDay = today;
    }

    // Build round-robin pairs: A→B, B→C, C→A, etc.
    for (let i = 0; i < sessionIds.length && !state.stopRequested; i++) {
      const fromId = sessionIds[i];
      const toId = sessionIds[(i + 1) % sessionIds.length];

      // Check daily limit
      const sentToday = dailySentCount.get(fromId) ?? 0;
      if (sentToday >= config.messagesPerDay) continue;

      // Check session health
      const session = db_.getSessionById(fromId);
      if (!session || session.healthStatus === 'checkpoint' ||
          session.healthStatus === 'restricted' || session.healthStatus === 'dead') {
        db_.logActivity(fromId, 'warmup_paused_health', `Warm-up paused: session is ${session?.healthStatus}`);
        continue;
      }

      // Get recipient UID
      const toSession = db_.getSessionById(toId);
      if (!toSession || !toSession.uid) continue;

      // Pick a random message template
      const template = config.messageTemplates[
        Math.floor(Math.random() * config.messageTemplates.length)
      ];
      const message = spinParser.resolve(template);

      // Send the message
      const sent = await inboxManager.sendDM(fromId, toSession.uid, message);

      if (sent) {
        dailySentCount.set(fromId, sentToday + 1);

        // Log interaction
        contactManager.logInteraction(toSession.uid, fromId, 'dm', 'sent', message);
        db_.logActivity(fromId, 'warmup_message_sent', `Warm-up message sent to ${toSession.uid}`);
      }

      // Wait before next message
      const delay = randomDelayValue(WARMUP_DELAY_MIN_MS, WARMUP_DELAY_MAX_MS);
      await sleep(delay);
    }

    // Wait a bit before next round
    await sleep(60_000);
  }
}

// ─────────────────────────────────────────────
// EXTERNAL MODE
// ─────────────────────────────────────────────

/**
 * Runs external warm-up: monitors incoming messages and auto-replies with AI.
 * Runs for durationDays, checking for new messages every minute.
 */
async function runExternalMode(
  jobId: string,
  sessionIds: string[],
  config: WarmUpConfig,
  state: { stopRequested: boolean }
): Promise<void> {
  const endTime = Date.now() + config.durationDays * 24 * 60 * 60 * 1_000;

  // Track which messages we've already replied to (by contactUid + sessionId)
  const repliedTo = new Set<string>();

  while (Date.now() < endTime && !state.stopRequested) {
    for (const sessionId of sessionIds) {
      if (state.stopRequested) break;

      // Check session health
      const session = db_.getSessionById(sessionId);
      if (!session || session.healthStatus !== 'live') continue;

      // Get unread conversations for this session
      const unreadConvs = inboxManager.getConversations({
        sessionId,
        unreadOnly: true,
      });

      for (const conv of unreadConvs) {
        const replyKey = `${sessionId}:${conv.contactUid}`;
        if (repliedTo.has(replyKey)) continue;

        // Generate AI reply
        const settings = db_.getSettings();
        let replyText: string;

        if (settings.ai.enabled) {
          const aiResult = await aiGateway.generateHumanResponse(
            settings.ai,
            `Incoming message from ${conv.contactName}: "${conv.lastMessage}"`,
            'message'
          );
          replyText = aiResult.success && aiResult.content
            ? aiResult.content
            : spinParser.resolve(config.messageTemplates[0] ?? 'Thanks for reaching out!');
        } else {
          replyText = spinParser.resolve(
            config.messageTemplates[Math.floor(Math.random() * config.messageTemplates.length)]
          );
        }

        // Apply response delay (simulate human thinking time)
        const responseDelay = randomDelayValue(
          config.responseDelayMinMs ?? EXTERNAL_RESPONSE_MIN_MS,
          config.responseDelayMaxMs ?? EXTERNAL_RESPONSE_MAX_MS
        );
        await sleep(responseDelay);

        // Send reply
        const sent = await inboxManager.sendReply(sessionId, conv.contactUid, replyText);
        if (sent.success) {
          repliedTo.add(replyKey);
          db_.logActivity(sessionId, 'warmup_auto_reply', `Auto-replied to ${conv.contactName}`);
        }
      }
    }

    // Check every minute
    await sleep(60_000);
  }
}

// ─────────────────────────────────────────────
// WARM-UP SCORE
// ─────────────────────────────────────────────

/**
 * Calculates the warm-up score for a session (0–100).
 *
 * Formula:
 *  score = (msgsSent7d × 0.40) + (msgsReplied7d × 0.40) + (accountAgeFactor × 20)
 *
 * Where:
 *  - msgsSent7d: messages sent in last 7 days (capped at 50 for full score)
 *  - msgsReplied7d: messages received and replied to in last 7 days (capped at 50)
 *  - accountAgeFactor: min(accountAgeMs / ONE_YEAR_MS, 1.0)
 *
 * @param sessionId - The session to calculate the score for.
 * @returns A score between 0 and 100.
 *
 * @example
 * const score = warmupEngine.calculateScore('session-uuid')
 * // → 67
 */
function calculateScore(sessionId: string): number {
  const session = db_.getSessionById(sessionId);
  if (!session) return 0;

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1_000;

  // Count messages sent in last 7 days from activity logs
  const logs = db_.getActivityLogs(sessionId, 500);
  const sentLogs = logs.filter(
    (l) => l.action === 'inbox_message_sent' && l.timestamp >= sevenDaysAgo
  );
  const repliedLogs = logs.filter(
    (l) => l.action === 'warmup_auto_reply' && l.timestamp >= sevenDaysAgo
  );

  // Normalize to 0–1 (cap at 50 messages for full score)
  const sentScore = Math.min(sentLogs.length / 50, 1.0);
  const repliedScore = Math.min(repliedLogs.length / 50, 1.0);

  // Account age factor
  const creationDate = session.creationDate
    ? new Date(session.creationDate).getTime()
    : session.createdAt;
  const accountAgeMs = Date.now() - creationDate;
  const ageFactor = Math.min(accountAgeMs / ONE_YEAR_MS, 1.0);

  const score = (sentScore * SCORE_WEIGHT_SENT * 100) +
                (repliedScore * SCORE_WEIGHT_REPLIED * 100) +
                (ageFactor * SCORE_WEIGHT_AGE * 100);

  return Math.round(Math.min(score, 100));
}

/**
 * Returns warm-up scores for all sessions in a job.
 *
 * @param jobId - The warm-up job ID.
 * @returns Array of { sessionId, score } objects.
 */
function getJobScores(jobId: string): Array<{ sessionId: string; score: number }> {
  const job = db_.getWarmUpJobs().find((j) => j.id === jobId);
  if (!job) return [];

  const sessionIds: string[] = JSON.parse(job.sessionIds);
  return sessionIds.map((id) => ({ sessionId: id, score: calculateScore(id) }));
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function randomDelayValue(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The Warm-Up Engine — builds inbox activity to improve account trust scores.
 *
 * @example
 * import { warmupEngine } from '../inbox/warmup-engine'
 *
 * // Start internal warm-up:
 * const job = await warmupEngine.createJob('internal', ['s1', 's2', 's3'], {
 *   messagesPerDay: 5,
 *   durationDays: 7,
 *   responseDelayMinMs: 300000,
 *   responseDelayMaxMs: 1800000,
 *   messageTemplates: ['{Hey|Hi}!', 'How are things?'],
 * })
 *
 * // Check scores:
 * const scores = warmupEngine.getJobScores(job.id)
 * // → [{ sessionId: 's1', score: 45 }, ...]
 */
export const warmupEngine = {
  /** Creates and starts a warm-up job. */
  createJob,
  /** Starts an existing warm-up job by ID. */
  startJob,
  /** Pauses a running warm-up job. */
  pauseJob,
  /** Resumes a paused warm-up job. */
  resumeJob,
  /** Deletes a warm-up job. */
  deleteJob,
  /** Calculates the warm-up score for a session (0–100). */
  calculateScore,
  /** Returns warm-up scores for all sessions in a job. */
  getJobScores,
};
