/**
 * Flogination V5 — Campaign Engine
 *
 * Manages the full lifecycle of automation campaigns.
 * A campaign is a named job (Group Hunter, Comment Engine, Page Factory, etc.)
 * that runs a set of tasks across multiple sessions.
 *
 * Lifecycle:
 *  pending → running → (paused ↔ running) → completed | failed
 *
 * Task drain loop:
 *  - While campaign is 'running' and pending tasks exist, execute next task.
 *  - Pause: set status to 'paused' — loop exits naturally on next iteration.
 *  - Resume: set status back to 'running' — restart loop.
 *  - Cancel: set status to 'failed' — mark all pending tasks as 'skipped'.
 *
 * Webhooks:
 *  - Fires 'campaign-started' when transitioning to 'running'.
 *  - Fires 'campaign-finished' when transitioning to 'completed' or 'failed'.
 */

import { db_ } from '../database';
import { webhookService } from '../utils/webhook-service';
import type { Campaign, CampaignTask, CampaignType, CampaignProgress } from '../../types';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/**
 * A function that executes a single campaign task.
 * Provided by each tool (page-factory, group-hunter, etc.) when starting a campaign.
 */
export type TaskExecutor = (task: CampaignTask) => Promise<{
  success: boolean;
  result?: Record<string, unknown>;
  error?: string;
}>;

/** In-memory state for a running campaign. */
interface RunningCampaign {
  campaignId: string;
  executor: TaskExecutor;
  /** Set to true when pause/cancel is requested — stops the drain loop. */
  stopRequested: boolean;
}

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

/** Active campaign drain loops keyed by campaignId. */
const runningCampaigns = new Map<string, RunningCampaign>();

// ─────────────────────────────────────────────
// CAMPAIGN CREATION
// ─────────────────────────────────────────────

/**
 * Creates a new campaign record in the database with status 'pending'.
 *
 * @param name     - Human-readable campaign name.
 * @param type     - The campaign type (group_hunter, comment_engine, etc.).
 * @param config   - Campaign-specific configuration object.
 * @param tasks    - Array of task definitions to create for this campaign.
 * @returns The created Campaign record.
 *
 * @example
 * const campaign = campaignEngine.create(
 *   'BD Group Hunter - June',
 *   'group_hunter',
 *   { targets: ['https://facebook.com/groups/123'], phases: ['join'] },
 *   [{ sessionId: 'abc', action: 'join_group' }]
 * )
 */
function create(
  name: string,
  type: CampaignType,
  config: Record<string, unknown>,
  tasks: Array<{ sessionId: string; action: string }>
): Campaign {
  const campaign = db_.createCampaign({
    name,
    type,
    status: 'draft',
    config: JSON.stringify(config),
  });

  // Create all task records upfront
  for (const task of tasks) {
    db_.createCampaignTask({
      campaignId: campaign.id,
      sessionId: task.sessionId,
      action: task.action,
      status: 'pending',
    });
  }

  return campaign;
}

// ─────────────────────────────────────────────
// CAMPAIGN START
// ─────────────────────────────────────────────

/**
 * Starts a campaign by transitioning it to 'running' and beginning the task drain loop.
 * Fires the 'campaign-started' webhook.
 *
 * @param campaignId - The campaign to start.
 * @param executor   - The function that executes individual tasks.
 * @returns Success or failure with an error message.
 *
 * @example
 * await campaignEngine.start(campaign.id, async (task) => {
 *   // Execute the task using the appropriate tool
 *   return { success: true, result: { pagesCreated: 1 } }
 * })
 */
async function start(
  campaignId: string,
  executor: TaskExecutor
): Promise<{ success: boolean; error?: string }> {
  const campaign = db_.getCampaignById(campaignId);
  if (!campaign) {
    return { success: false, error: 'Campaign not found' };
  }

  if (campaign.status === 'running') {
    return { success: false, error: 'Campaign is already running' };
  }

  // Transition to running
  db_.updateCampaign(campaignId, { status: 'running' });

  const tasks = db_.getCampaignTasks(campaignId);
  const sessionCount = new Set(tasks.map((t) => t.sessionId)).size;

  // Fire campaign-started webhook
  await webhookService.fireCampaignStarted({
    campaignId,
    campaignName: campaign.name,
    type: campaign.type,
    sessionCount,
    timestamp: Date.now(),
  });

  // Register in running campaigns map
  const runningState: RunningCampaign = {
    campaignId,
    executor,
    stopRequested: false,
  };
  runningCampaigns.set(campaignId, runningState);

  // Start drain loop in background — don't await
  drainLoop(campaignId, runningState).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[campaign-engine] Drain loop error for campaign ${campaignId}: ${message}`);
    db_.updateCampaign(campaignId, { status: 'failed', completedAt: Date.now() });
  });

  return { success: true };
}

// ─────────────────────────────────────────────
// TASK DRAIN LOOP
// ─────────────────────────────────────────────

/**
 * The main task execution loop for a campaign.
 * Processes pending tasks one at a time until:
 *  - All tasks are done/failed/skipped, OR
 *  - stopRequested is set to true (pause/cancel).
 */
async function drainLoop(
  campaignId: string,
  state: RunningCampaign
): Promise<void> {
  while (true) {
    // Check if stop was requested (pause or cancel)
    if (state.stopRequested) break;

    // Re-read campaign status from DB (may have been changed externally)
    const campaign = db_.getCampaignById(campaignId);
    if (!campaign || campaign.status !== 'running') break;

    // Get next pending task
    const tasks = db_.getCampaignTasks(campaignId);
    const nextTask = tasks.find((t) => t.status === 'pending');

    if (!nextTask) {
      // All tasks processed — campaign complete
      await completeCampaign(campaignId);
      break;
    }

    // Execute the task
    await executeTask(nextTask, state.executor);
  }

  runningCampaigns.delete(campaignId);
}

/**
 * Executes a single campaign task using the provided executor.
 * Updates task status to 'running' before execution and 'done'/'failed' after.
 */
async function executeTask(
  task: CampaignTask,
  executor: TaskExecutor
): Promise<void> {
  // Mark task as running
  db_.updateCampaignTask(task.id, {
    status: 'running',
    startedAt: Date.now(),
  });

  try {
    const result = await executor(task);

    db_.updateCampaignTask(task.id, {
      status: result.success ? 'done' : 'failed',
      result: result.result ? JSON.stringify(result.result) : undefined,
      error: result.error,
      completedAt: Date.now(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    db_.updateCampaignTask(task.id, {
      status: 'failed',
      error: message,
      completedAt: Date.now(),
    });
  }
}

/**
 * Marks a campaign as completed and fires the finished webhook.
 */
async function completeCampaign(campaignId: string): Promise<void> {
  const campaign = db_.getCampaignById(campaignId);
  if (!campaign) return;

  db_.updateCampaign(campaignId, {
    status: 'completed',
    completedAt: Date.now(),
  });

  const progress = getProgress(campaignId);

  await webhookService.fireCampaignFinished({
    campaignId,
    campaignName: campaign.name,
    type: campaign.type,
    status: 'completed',
    taskSuccessCount: progress.done,
    taskFailCount: progress.failed,
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────
// PAUSE / RESUME / CANCEL
// ─────────────────────────────────────────────

/**
 * Pauses a running campaign.
 * Sets stopRequested on the drain loop — it exits after the current task finishes.
 * Pending tasks remain pending and will be picked up when the campaign is resumed.
 *
 * @param campaignId - The campaign to pause.
 */
function pause(campaignId: string): { success: boolean; error?: string } {
  const running = runningCampaigns.get(campaignId);
  if (!running) {
    return { success: false, error: 'Campaign is not running' };
  }

  running.stopRequested = true;
  db_.updateCampaign(campaignId, { status: 'paused' });

  return { success: true };
}

/**
 * Resumes a paused campaign.
 * Sets status back to 'running' and restarts the drain loop.
 *
 * @param campaignId - The campaign to resume.
 * @param executor   - The task executor function (must be provided again on resume).
 */
async function resume(
  campaignId: string,
  executor: TaskExecutor
): Promise<{ success: boolean; error?: string }> {
  const campaign = db_.getCampaignById(campaignId);
  if (!campaign) return { success: false, error: 'Campaign not found' };
  if (campaign.status !== 'paused') return { success: false, error: 'Campaign is not paused' };

  return start(campaignId, executor);
}

/**
 * Cancels a campaign by setting it to 'cancelled' and skipping all pending tasks.
 * Fires the 'campaign-finished' webhook with status 'cancelled'.
 *
 * @param campaignId - The campaign to cancel.
 */
async function cancel(campaignId: string): Promise<{ success: boolean; error?: string }> {
  const running = runningCampaigns.get(campaignId);
  if (running) {
    running.stopRequested = true;
  }

  const campaign = db_.getCampaignById(campaignId);
  if (!campaign) return { success: false, error: 'Campaign not found' };

  db_.updateCampaign(campaignId, { status: 'cancelled', completedAt: Date.now() });

  // Skip all pending tasks
  const tasks = db_.getCampaignTasks(campaignId);
  for (const task of tasks.filter((t) => t.status === 'pending')) {
    db_.updateCampaignTask(task.id, { status: 'skipped' });
  }

  const progress = getProgress(campaignId);
  await webhookService.fireCampaignFinished({
    campaignId,
    campaignName: campaign.name,
    type: campaign.type,
    status: 'cancelled',
    taskSuccessCount: progress.done,
    taskFailCount: progress.failed,
    timestamp: Date.now(),
  });

  return { success: true };
}

// ─────────────────────────────────────────────
// PROGRESS
// ─────────────────────────────────────────────

/**
 * Returns the current progress of a campaign.
 *
 * @param campaignId - The campaign to get progress for.
 * @returns Progress counts and percentage.
 *
 * @example
 * const progress = campaignEngine.getProgress('campaign-uuid')
 * // → { total: 10, done: 6, failed: 1, skipped: 0, percent: 70 }
 */
function getProgress(campaignId: string): CampaignProgress {
  const tasks = db_.getCampaignTasks(campaignId);
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const skipped = tasks.filter((t) => t.status === 'skipped').length;
  const percent = total > 0 ? Math.round(((done + failed + skipped) / total) * 100) : 0;

  return { total, done, failed, skipped, percent };
}

/**
 * Returns true if a campaign is currently running.
 */
function isRunning(campaignId: string): boolean {
  return runningCampaigns.has(campaignId);
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The campaign engine — manages automation job lifecycles.
 *
 * @example
 * import { campaignEngine } from '../campaigns/campaign-engine'
 *
 * // Create and start a campaign:
 * const campaign = campaignEngine.create('My Campaign', 'group_hunter', config, tasks)
 * await campaignEngine.start(campaign.id, async (task) => {
 *   // execute task
 *   return { success: true }
 * })
 *
 * // Check progress:
 * const progress = campaignEngine.getProgress(campaign.id)
 * // → { total: 10, done: 6, failed: 1, skipped: 0, percent: 70 }
 */
export const campaignEngine = {
  /** Creates a campaign with tasks. Status starts as 'pending'. */
  create,
  /** Starts a campaign and begins the task drain loop. */
  start,
  /** Pauses a running campaign. Pending tasks remain pending for resume. */
  pause,
  /** Resumes a paused campaign. Restarts the drain loop from where it left off. */
  resume,
  /** Cancels a campaign. Sets status to 'cancelled'. Skips pending tasks. */
  cancel,
  /** Returns progress counts and percentage for a campaign. */
  getProgress,
  /** Returns true if a campaign is currently running. */
  isRunning,
};
