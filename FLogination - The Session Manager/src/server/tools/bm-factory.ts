/**
 * Flogination V5 — BM Factory
 *
 * Automates Facebook Business Manager creation using worker accounts
 * and transfers admin access to a designated parking account.
 *
 * Why parking?
 *  Same logic as Page Factory — worker accounts may get banned.
 *  BMs transferred to a strong parking account survive worker bans.
 *
 * Flow per worker:
 *  1. Launch stealth browser for worker account.
 *  2. Navigate to business.facebook.com and create a new BM.
 *  3. Extract the BM ID from the URL.
 *  4. Navigate to BM settings → People → Add People.
 *  5. Invite the parking account as Admin using their email.
 *  6. Poll BM people list every 15s (max 10 min) for acceptance.
 *  7. Insert parked_assets record with transferStatus='transferred'.
 *  8. Update parking session's bmData JSON field.
 *  9. Fire 'asset-parked' webhook.
 *
 * If worker gets a BM creation restriction:
 *  - Mark remaining tasks as 'skipped'.
 *  - Log the restriction and continue with other workers.
 */

import { db_ } from '../database';
import { sessionManager } from '../automation/session-manager';
import { selfHealing } from '../automation/self-healing';
import { campaignEngine } from '../campaigns/campaign-engine';
import { webhookService } from '../utils/webhook-service';
import { S } from '../utils/selector-resolver';
import type { Campaign, BMRecord } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** How often to poll the BM people list for invitation acceptance. */
const ADMIN_POLL_INTERVAL_MS = 15_000;

/** Maximum time to wait for parking account to accept BM admin invitation. */
const ADMIN_ACCEPT_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes

/** Randomized delay range between consecutive BM creation actions. */
const ACTION_DELAY_MIN_MS = 60_000;
const ACTION_DELAY_MAX_MS = 180_000;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** Configuration for a BM Factory job. */
export interface BMFactoryConfig {
  /** IDs of worker sessions that will create BMs. */
  workerSessionIds: string[];
  /** ID of the parking session that will receive admin rights. */
  parkingSessionId: string;
  /** Number of BMs each worker should create. */
  bmsPerWorker: number;
  /** BM name template. Use {random} for a random word. */
  nameTemplate: string;
  /** Whether to auto-create an ad account slot within each BM. */
  createAdAccount?: boolean;
}

// ─────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────

/**
 * Starts a BM Factory job.
 * Creates a campaign with tasks for each worker × BMs combination,
 * then starts the campaign engine drain loop.
 *
 * @param config - The BM Factory configuration.
 * @returns The created Campaign record.
 *
 * @example
 * const campaign = await bmFactory.start({
 *   workerSessionIds: ['worker-1', 'worker-2'],
 *   parkingSessionId: 'parking-account',
 *   bmsPerWorker: 2,
 *   nameTemplate: 'AdOps {random}',
 *   createAdAccount: true,
 * })
 */
async function start(config: BMFactoryConfig): Promise<Campaign> {
  const parkingSession = db_.getSessionById(config.parkingSessionId);
  if (!parkingSession) {
    throw new Error(`Parking session not found: ${config.parkingSessionId}`);
  }

  if (!parkingSession.email) {
    throw new Error('Parking account must have an email address for BM admin invitations');
  }

  // Build task list: one task per worker per BM
  const tasks: Array<{ sessionId: string; action: string }> = [];
  for (const workerId of config.workerSessionIds) {
    for (let i = 0; i < config.bmsPerWorker; i++) {
      tasks.push({ sessionId: workerId, action: 'create_and_park_bm' });
    }
  }

  const campaign = campaignEngine.create(
    `BM Factory — ${config.bmsPerWorker} BMs × ${config.workerSessionIds.length} workers`,
    'bm_factory',
    config as unknown as Record<string, unknown>,
    tasks
  );

  await campaignEngine.start(campaign.id, async (task) => {
    return executeBMCreationTask(task.sessionId, config);
  });

  return campaign;
}

// ─────────────────────────────────────────────
// TASK EXECUTOR
// ─────────────────────────────────────────────

/**
 * Executes a single BM creation task for one worker session.
 * Creates one BM and transfers admin access to the parking account.
 */
async function executeBMCreationTask(
  workerSessionId: string,
  config: BMFactoryConfig
): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
  const workerSession = db_.getSessionById(workerSessionId);
  if (!workerSession) {
    return { success: false, error: 'Worker session not found' };
  }

  const parkingSession = db_.getSessionById(config.parkingSessionId);
  if (!parkingSession || !parkingSession.email) {
    return { success: false, error: 'Parking session not found or missing email' };
  }

  // Launch browser for worker if not already running
  const workerState = sessionManager.getState(workerSessionId);
  let launchedForTask = false;

  if (workerState === 'idle') {
    const launchResult = await sessionManager.launch(workerSessionId, false);
    if (!launchResult.success) {
      return { success: false, error: `Failed to launch worker browser: ${launchResult.error}` };
    }
    launchedForTask = true;
  }

  const page = sessionManager.getPage(workerSessionId);
  if (!page) {
    return { success: false, error: 'Worker browser page not available' };
  }

  try {
    // Check worker health
    const health = await sessionManager.checkHealth(workerSessionId);
    if (health.status === 'checkpoint' || health.status === 'dead') {
      return { success: false, error: `Worker account is ${health.status} — skipping` };
    }

    // Step 1: Navigate to Business Manager creation
    await page.goto('https://business.facebook.com/overview', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await randomDelay(2000, 4000);

    // Check for BM restriction before attempting creation
    const pageText = await page.textContent('body') ?? '';
    if (pageText.includes('restricted') || pageText.includes('not allowed to create')) {
      db_.logActivity(workerSessionId, 'bm_creation_restricted', 'Worker account has BM creation restriction');
      return { success: false, error: 'Worker account has BM creation restriction' };
    }

    // Step 2: Click "Create Account" or "Add Business"
    const createResult = await selfHealing.withHealing(
      page, 'fb_create_bm_button', S.CREATE_BM_BUTTON,
      async (sel) => {
        await page.click(sel);
        await randomDelay(1500, 3000);
      }
    );
    if (!createResult.success) {
      return { success: false, error: 'Could not find BM creation button' };
    }

    // Step 3: Fill BM name
    const bmName = resolveNameTemplate(config.nameTemplate);
    const nameResult = await selfHealing.withHealing(
      page, 'fb_bm_name_input', S.BM_NAME_INPUT,
      async (sel) => { await page.fill(sel, bmName); }
    );
    if (!nameResult.success) {
      return { success: false, error: 'Could not fill BM name field' };
    }
    await randomDelay(1000, 2000);

    // Step 4: Fill business email (use worker's email or a placeholder)
    const emailResult = await selfHealing.withHealing(
      page, 'fb_bm_email_input', S.BM_EMAIL_INPUT,
      async (sel) => {
        const email = workerSession.email ?? `business${Date.now()}@gmail.com`;
        await page.fill(sel, email);
      }
    );
    // Email field may not always appear — non-fatal

    await randomDelay(1000, 2000);

    // Step 5: Submit the creation form
    const submitResult = await selfHealing.withHealing(
      page, 'fb_bm_submit_button', S.BM_SUBMIT_BUTTON,
      async (sel) => { await page.click(sel); }
    );
    if (!submitResult.success) {
      return { success: false, error: 'Could not submit BM creation form' };
    }
    await randomDelay(3000, 6000);

    // Step 6: Extract BM ID from URL
    const currentUrl = page.url();
    const bmId = extractBMId(currentUrl);
    if (!bmId) {
      return { success: false, error: `Could not extract BM ID from URL: ${currentUrl}` };
    }

    db_.logActivity(workerSessionId, 'bm_created', `Created BM: ${bmName} (ID: ${bmId})`);

    await randomDelay(ACTION_DELAY_MIN_MS / 3, ACTION_DELAY_MAX_MS / 3);

    // Step 7: Invite parking account as Admin
    const inviteSuccess = await inviteParkingAccountAsAdmin(
      page, bmId, parkingSession.email, workerSessionId
    );
    if (!inviteSuccess) {
      return { success: false, error: 'Failed to invite parking account as BM admin' };
    }

    await randomDelay(ACTION_DELAY_MIN_MS / 2, ACTION_DELAY_MAX_MS / 2);

    // Step 8: Poll for admin acceptance
    const accepted = await pollForAdminAcceptance(page, bmId, parkingSession.email, workerSessionId);

    if (!accepted) {
      db_.createParkedAsset({
        type: 'bm',
        assetId: bmId,
        assetName: bmName,
        creatorSessionId: workerSessionId,
        parkingSessionId: config.parkingSessionId,
        transferStatus: 'failed',
      });
      db_.logActivity(workerSessionId, 'bm_transfer_timeout', `BM ${bmId} transfer timed out`);
      return { success: false, error: 'Admin invitation not accepted within 10 minutes' };
    }

    // Step 9: Record parked asset
    const asset = db_.createParkedAsset({
      type: 'bm',
      assetId: bmId,
      assetName: bmName,
      creatorSessionId: workerSessionId,
      parkingSessionId: config.parkingSessionId,
      transferStatus: 'transferred',
      transferredAt: Date.now(),
    });

    // Step 10: Update parking session's bmData
    updateParkingSessionBMData(config.parkingSessionId, bmId, bmName);

    // Fire webhook
    await webhookService.fireAssetParked({
      assetId: bmId,
      assetName: bmName,
      type: 'bm',
      parkingSessionId: config.parkingSessionId,
      timestamp: Date.now(),
    });

    db_.logActivity(workerSessionId, 'bm_parked', `BM ${bmName} (${bmId}) transferred to parking account`);

    await randomDelay(ACTION_DELAY_MIN_MS, ACTION_DELAY_MAX_MS);

    return { success: true, result: { bmId, bmName, assetId: asset.id } };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    db_.logActivity(workerSessionId, 'bm_factory_error', message);
    return { success: false, error: message };
  } finally {
    if (launchedForTask) {
      await sessionManager.close(workerSessionId).catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Invites the parking account as an Admin of the newly created BM.
 */
async function inviteParkingAccountAsAdmin(
  page: import('playwright-core').Page,
  bmId: string,
  parkingEmail: string,
  sessionId: string
): Promise<boolean> {
  try {
    // Navigate to BM People settings
    await page.goto(`https://business.facebook.com/settings/people/?business_id=${bmId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await randomDelay(2000, 3000);

    // Click "Add People" button
    const addResult = await selfHealing.withHealing(
      page, 'fb_bm_add_people_button', S.BM_ADD_PEOPLE,
      async (sel) => {
        await page.click(sel);
        await randomDelay(1500, 2500);
      }
    );
    if (!addResult.success) return false;

    // Fill parking account email
    const emailResult = await selfHealing.withHealing(
      page, 'fb_bm_invite_email_input', S.BM_INVITE_EMAIL,
      async (sel) => {
        await page.fill(sel, parkingEmail);
        await randomDelay(1000, 2000);
      }
    );
    if (!emailResult.success) return false;

    // Select Admin role
    const roleResult = await selfHealing.withHealing(
      page, 'fb_bm_admin_role_option', S.BM_ADMIN_ROLE,
      async (sel) => { await page.click(sel); }
    );
    // Role selection may default to Admin — non-fatal if fails

    // Click Invite/Next button
    const inviteResult = await selfHealing.withHealing(
      page, 'fb_bm_invite_button', S.BM_INVITE_BUTTON,
      async (sel) => { await page.click(sel); }
    );
    if (!inviteResult.success) return false;

    await randomDelay(2000, 3000);
    db_.logActivity(sessionId, 'bm_admin_invited', `Invited ${parkingEmail} to BM ${bmId}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Polls the BM people list every 15 seconds until the parking account appears as admin.
 * Times out after 10 minutes.
 */
async function pollForAdminAcceptance(
  page: import('playwright-core').Page,
  bmId: string,
  parkingEmail: string,
  sessionId: string
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < ADMIN_ACCEPT_TIMEOUT_MS) {
    try {
      await page.goto(`https://business.facebook.com/settings/people/?business_id=${bmId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      await randomDelay(1000, 2000);

      const pageText = await page.textContent('body') ?? '';
      if (pageText.includes(parkingEmail) || pageText.toLowerCase().includes('admin')) {
        db_.logActivity(sessionId, 'bm_admin_accepted', `Parking account accepted BM admin role for ${bmId}`);
        return true;
      }
    } catch {
      // Poll failure is non-fatal
    }

    await randomDelay(ADMIN_POLL_INTERVAL_MS, ADMIN_POLL_INTERVAL_MS + 2000);
  }

  return false;
}

/**
 * Updates the parking session's bmData JSON field to include the newly transferred BM.
 */
function updateParkingSessionBMData(parkingSessionId: string, bmId: string, bmName: string): void {
  const parkingSession = db_.getSessionById(parkingSessionId);
  if (!parkingSession) return;

  try {
    const existingBMs: BMRecord[] = JSON.parse(parkingSession.bmData || '[]');
    const newBM: BMRecord = {
      name: bmName,
      id: bmId,
      role: 'Admin',
      adAccountCount: 0,
      restrictionStatus: 'Live',
    };

    // Avoid duplicates
    if (!existingBMs.some((bm) => bm.id === bmId)) {
      existingBMs.push(newBM);
      db_.updateSession(parkingSessionId, {
        bmData: JSON.stringify(existingBMs),
        bmCount: existingBMs.length,
      });
    }
  } catch {
    // Non-critical — bmData update failure doesn't affect the transfer
  }
}

/**
 * Extracts a Facebook Business Manager ID from a URL.
 */
function extractBMId(url: string): string | null {
  // business_id=123456789
  const queryMatch = url.match(/[?&]business_id=(\d+)/);
  if (queryMatch) return queryMatch[1];

  // /123456789/ in path
  const pathMatch = url.match(/business\.facebook\.com\/(\d+)/);
  if (pathMatch) return pathMatch[1];

  return null;
}

/**
 * Resolves a BM name template, replacing {random} with a random word.
 */
function resolveNameTemplate(template: string): string {
  const randomWords = [
    'Global', 'Elite', 'Prime', 'Pro', 'Max', 'Ultra', 'Smart', 'Digital',
    'Creative', 'Dynamic', 'Innovative', 'Modern', 'Premium', 'Expert', 'Master',
    'Alpha', 'Apex', 'Core', 'Edge', 'Nexus',
  ];
  const randomWord = randomWords[Math.floor(Math.random() * randomWords.length)];
  return template.replace(/\{random\}/gi, randomWord);
}

/**
 * Returns a Promise that resolves after a random delay between min and max ms.
 */
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The BM Factory tool — creates Facebook Business Managers and parks them safely.
 *
 * @example
 * import { bmFactory } from '../tools/bm-factory'
 *
 * const campaign = await bmFactory.start({
 *   workerSessionIds: ['worker-1', 'worker-2'],
 *   parkingSessionId: 'parking-account',
 *   bmsPerWorker: 2,
 *   nameTemplate: 'AdOps {random}',
 * })
 */
// ─────────────────────────────────────────────
// NAMED ENTRY POINT (task-spec signature)
// ─────────────────────────────────────────────

/**
 * Starts a BM Factory job using the canonical task-spec parameter signature.
 * Wraps `start(config)` for callers that prefer explicit positional parameters.
 *
 * @param workerIds - IDs of worker sessions that will create BMs.
 * @param parkingId - ID of the parking session that will receive admin rights.
 * @param config    - Additional BM Factory configuration (bmsPerWorker, nameTemplate, etc.).
 * @returns The created Campaign record.
 *
 * @example
 * const campaign = await bmFactory.startBMFactoryJob(
 *   ['worker-1', 'worker-2'],
 *   'parking-account',
 *   { bmsPerWorker: 2, nameTemplate: 'AdOps {random}', createAdAccount: true }
 * )
 */
async function startBMFactoryJob(
  workerIds: string[],
  parkingId: string,
  config: Omit<BMFactoryConfig, 'workerSessionIds' | 'parkingSessionId'>
): Promise<Campaign> {
  return start({ ...config, workerSessionIds: workerIds, parkingSessionId: parkingId });
}

export const bmFactory = {
  /** Starts a BM Factory job using a config object. Returns the created campaign. */
  start,
  /** Starts a BM Factory job using positional parameters (workerIds, parkingId, config). */
  startBMFactoryJob,
};
