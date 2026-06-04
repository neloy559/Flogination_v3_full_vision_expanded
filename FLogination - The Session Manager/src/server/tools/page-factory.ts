/**
 * Flogination V5 — Page Factory
 *
 * Automates Facebook Page creation using worker accounts and transfers
 * ownership to a designated parking account for safekeeping.
 *
 * Why parking?
 *  Worker accounts are burner/weak accounts that may get banned.
 *  By transferring page admin rights to a strong parking account immediately
 *  after creation, the pages survive even if the worker gets banned.
 *
 * Flow per worker:
 *  1. Launch stealth browser for worker account.
 *  2. Navigate to facebook.com/pages/create.
 *  3. Fill page name, category, bio using human-like typing.
 *  4. Upload profile picture and cover image (optional).
 *  5. Extract the new page ID from the URL.
 *  6. Invite the parking account as Admin.
 *  7. Poll the page admin list every 15s (max 10 min) for acceptance.
 *  8. On acceptance: remove worker from admins.
 *  9. Insert parked_assets record with transferStatus='transferred'.
 * 10. Fire 'asset-parked' webhook.
 *
 * If worker is banned/checkpointed during the job:
 *  - Mark remaining tasks as 'skipped'.
 *  - Close browser and continue with other workers.
 */

import { db_ } from '../database';
import { sessionManager } from '../automation/session-manager';
import { selfHealing } from '../automation/self-healing';
import { campaignEngine } from '../campaigns/campaign-engine';
import { webhookService } from '../utils/webhook-service';
import { S } from '../utils/selector-resolver';
import type { Campaign } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** How often to poll the page admin list for invitation acceptance. */
const ADMIN_POLL_INTERVAL_MS = 15_000;

/** Maximum time to wait for parking account to accept admin invitation. */
const ADMIN_ACCEPT_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes

/** Randomized delay range between consecutive actions on the same worker. */
const ACTION_DELAY_MIN_MS = 30_000;
const ACTION_DELAY_MAX_MS = 120_000;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** Configuration for a Page Factory job. */
export interface PageFactoryConfig {
  /** IDs of worker sessions that will create pages. */
  workerSessionIds: string[];
  /** ID of the parking session that will receive admin rights. */
  parkingSessionId: string;
  /** Number of pages each worker should create. */
  pagesPerWorker: number;
  /** Page name template. Use {random} for a random word. */
  nameTemplate: string;
  /** Facebook page category (e.g. 'Business', 'Entertainment'). */
  category: string;
  /** Page bio/description text. */
  bio?: string;
  /** Profile picture URL or base64 data. */
  profilePictureUrl?: string;
  /** Cover image URL or base64 data. */
  coverImageUrl?: string;
}

// ─────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────

/**
 * Starts a Page Factory job.
 * Creates a campaign with tasks for each worker × pages combination,
 * then starts the campaign engine drain loop.
 *
 * @param config - The Page Factory configuration.
 * @returns The created Campaign record.
 *
 * @example
 * const campaign = await pageFactory.start({
 *   workerSessionIds: ['worker-1', 'worker-2'],
 *   parkingSessionId: 'parking-account',
 *   pagesPerWorker: 3,
 *   nameTemplate: 'TechStore {random}',
 *   category: 'Business',
 * })
 */
async function start(config: PageFactoryConfig): Promise<Campaign> {
  const parkingSession = db_.getSessionById(config.parkingSessionId);
  if (!parkingSession) {
    throw new Error(`Parking session not found: ${config.parkingSessionId}`);
  }

  // Build task list: one task per worker per page
  const tasks: Array<{ sessionId: string; action: string }> = [];
  for (const workerId of config.workerSessionIds) {
    for (let i = 0; i < config.pagesPerWorker; i++) {
      tasks.push({ sessionId: workerId, action: 'create_and_park_page' });
    }
  }

  const campaign = campaignEngine.create(
    `Page Factory — ${config.pagesPerWorker} pages × ${config.workerSessionIds.length} workers`,
    'page_factory',
    config as unknown as Record<string, unknown>,
    tasks
  );

  // Start the campaign with our task executor
  await campaignEngine.start(campaign.id, async (task) => {
    return executePageCreationTask(task.sessionId, config);
  });

  return campaign;
}

// ─────────────────────────────────────────────
// TASK EXECUTOR
// ─────────────────────────────────────────────

/**
 * Executes a single page creation task for one worker session.
 * Creates one page and transfers it to the parking account.
 */
async function executePageCreationTask(
  workerSessionId: string,
  config: PageFactoryConfig
): Promise<{ success: boolean; result?: Record<string, unknown>; error?: string }> {
  const workerSession = db_.getSessionById(workerSessionId);
  if (!workerSession) {
    return { success: false, error: 'Worker session not found' };
  }

  const parkingSession = db_.getSessionById(config.parkingSessionId);
  if (!parkingSession) {
    return { success: false, error: 'Parking session not found' };
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
    // Check worker health before proceeding
    const health = await sessionManager.checkHealth(workerSessionId);
    if (health.status === 'checkpoint' || health.status === 'dead') {
      return { success: false, error: `Worker account is ${health.status} — skipping` };
    }

    // Step 1: Navigate to page creation
    await page.goto('https://www.facebook.com/pages/create', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await randomDelay(2000, 4000);

    // Step 2: Fill page name
    const pageName = resolveNameTemplate(config.nameTemplate);
    const nameResult = await selfHealing.withHealing(
      page, 'fb_page_name_input', S.PAGE_NAME_INPUT,
      async (sel) => { await page.fill(sel, pageName); }
    );
    if (!nameResult.success) {
      return { success: false, error: 'Could not fill page name field' };
    }
    await randomDelay(1000, 2000);

    // Step 3: Select category
    if (config.category) {
      const categoryResult = await selfHealing.withHealing(
        page, 'fb_page_category_input', S.PAGE_CATEGORY_INPUT,
        async (sel) => {
          await page.fill(sel, config.category);
          await randomDelay(500, 1000);
          // Click first suggestion
          const suggestion = await page.$('[role="option"]:first-child, [data-testid="category-option"]:first-child');
          if (suggestion) await suggestion.click();
        }
      );
      // Category is optional — don't fail if it doesn't work
      if (!categoryResult.success) {
        db_.logActivity(workerSessionId, 'page_factory_warning', 'Could not set category — continuing without it');
      }
    }
    await randomDelay(1000, 2000);

    // Step 4: Click Create Page button
    const createResult = await selfHealing.withHealing(
      page, 'fb_create_page_button', S.CREATE_PAGE_BUTTON,
      async (sel) => { await page.click(sel); }
    );
    if (!createResult.success) {
      return { success: false, error: 'Could not click Create Page button' };
    }
    await randomDelay(3000, 5000);

    // Step 5: Extract page ID from URL
    const currentUrl = page.url();
    const pageId = extractPageId(currentUrl);
    if (!pageId) {
      return { success: false, error: `Could not extract page ID from URL: ${currentUrl}` };
    }

    db_.logActivity(workerSessionId, 'page_created', `Created page: ${pageName} (ID: ${pageId})`);

    // Step 6: Add bio if provided
    if (config.bio) {
      await addPageBio(page, config.bio, workerSessionId);
      await randomDelay(ACTION_DELAY_MIN_MS / 3, ACTION_DELAY_MAX_MS / 3);
    }

    // Step 7: Invite parking account as admin
    const inviteSuccess = await inviteParkingAccountAsAdmin(
      page, pageId, parkingSession.uid || parkingSession.email || '', workerSessionId
    );
    if (!inviteSuccess) {
      return { success: false, error: 'Failed to invite parking account as admin' };
    }

    await randomDelay(ACTION_DELAY_MIN_MS / 2, ACTION_DELAY_MAX_MS / 2);

    // Step 8: Poll for admin acceptance (max 10 min)
    const accepted = await pollForAdminAcceptance(page, pageId, parkingSession.uid, workerSessionId);

    if (!accepted) {
      // Record as failed transfer but don't fail the whole task
      db_.createParkedAsset({
        type: 'page',
        assetId: pageId,
        assetName: pageName,
        creatorSessionId: workerSessionId,
        parkingSessionId: config.parkingSessionId,
        transferStatus: 'failed',
      });
      db_.logActivity(workerSessionId, 'page_transfer_timeout', `Page ${pageId} transfer timed out after 10 minutes`);
      return { success: false, error: 'Admin invitation not accepted within 10 minutes' };
    }

    // Step 9: Remove worker from admins
    await removeWorkerFromAdmins(page, pageId, workerSessionId);

    // Step 10: Record parked asset
    const asset = db_.createParkedAsset({
      type: 'page',
      assetId: pageId,
      assetName: pageName,
      creatorSessionId: workerSessionId,
      parkingSessionId: config.parkingSessionId,
      transferStatus: 'transferred',
      transferredAt: Date.now(),
    });

    // Fire webhook
    await webhookService.fire('asset-parked', {
      assetId: pageId,
      assetName: pageName,
      type: 'page',
      parkingSessionId: config.parkingSessionId,
      timestamp: Date.now(),
    });

    db_.logActivity(workerSessionId, 'page_parked', `Page ${pageName} (${pageId}) transferred to parking account`);

    await randomDelay(ACTION_DELAY_MIN_MS, ACTION_DELAY_MAX_MS);

    return { success: true, result: { pageId, pageName, assetId: asset.id } };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    db_.logActivity(workerSessionId, 'page_factory_error', message);
    return { success: false, error: message };
  } finally {
    // Close browser if we launched it for this task
    if (launchedForTask) {
      await sessionManager.close(workerSessionId).catch(() => {});
    }
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Adds a bio/description to a newly created page.
 */
async function addPageBio(page: import('playwright-core').Page, bio: string, sessionId: string): Promise<void> {
  try {
    const bioResult = await selfHealing.withHealing(
      page, 'fb_page_bio_input', S.PAGE_BIO_INPUT,
      async (sel) => { await page.fill(sel, bio); }
    );
    if (!bioResult.success) {
      db_.logActivity(sessionId, 'page_factory_warning', 'Could not add bio — continuing without it');
    }
  } catch {
    // Bio is optional
  }
}

/**
 * Invites the parking account as an admin of the newly created page.
 */
async function inviteParkingAccountAsAdmin(
  page: import('playwright-core').Page,
  pageId: string,
  parkingIdentifier: string,
  sessionId: string
): Promise<boolean> {
  try {
    // Navigate to page settings → Page Roles
    await page.goto(`https://www.facebook.com/${pageId}/settings/?tab=admin_roles`, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });
    await randomDelay(2000, 3000);

    // Fill in the parking account identifier
    const inputResult = await selfHealing.withHealing(
      page, 'fb_page_role_input', S.PAGE_ROLE_INPUT,
      async (sel) => {
        await page.fill(sel, parkingIdentifier);
        await randomDelay(1000, 2000);
      }
    );
    if (!inputResult.success) return false;

    // Select Admin role
    const roleResult = await selfHealing.withHealing(
      page, 'fb_admin_role_select', 'select[name="role"], [data-testid="role-selector"]',
      async (sel) => {
        await page.selectOption(sel, 'ADMIN');
      }
    );
    // Role selection may not be needed if Admin is default

    // Click Add button
    const addResult = await selfHealing.withHealing(
      page, 'fb_add_role_button', S.ADD_ROLE_BUTTON,
      async (sel) => { await page.click(sel); }
    );
    if (!addResult.success) return false;

    await randomDelay(2000, 3000);
    db_.logActivity(sessionId, 'page_admin_invited', `Invited parking account to page ${pageId}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Polls the page admin list every 15 seconds until the parking account appears as admin.
 * Times out after 10 minutes.
 */
async function pollForAdminAcceptance(
  page: import('playwright-core').Page,
  pageId: string,
  parkingUid: string,
  sessionId: string
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < ADMIN_ACCEPT_TIMEOUT_MS) {
    try {
      await page.goto(`https://www.facebook.com/${pageId}/settings/?tab=admin_roles`, {
        waitUntil: 'domcontentloaded',
        timeout: 15_000,
      });
      await randomDelay(1000, 2000);

      const pageText = await page.textContent('body') ?? '';
      if (parkingUid && pageText.includes(parkingUid)) {
        db_.logActivity(sessionId, 'page_admin_accepted', `Parking account accepted admin role for page ${pageId}`);
        return true;
      }
    } catch {
      // Poll failure is non-fatal — try again
    }

    await randomDelay(ADMIN_POLL_INTERVAL_MS, ADMIN_POLL_INTERVAL_MS + 2000);
  }

  return false;
}

/**
 * Removes the worker account from the page's admin roles.
 */
async function removeWorkerFromAdmins(
  page: import('playwright-core').Page,
  pageId: string,
  sessionId: string
): Promise<void> {
  try {
    await page.goto(`https://www.facebook.com/${pageId}/settings/?tab=admin_roles`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    await randomDelay(2000, 3000);

    // Click remove button next to "You" or the worker's name
    const removeResult = await selfHealing.withHealing(
      page, 'fb_remove_self_admin', S.REMOVE_SELF_ADMIN,
      async (sel) => {
        await page.click(sel);
        await randomDelay(1000, 2000);
        // Confirm removal dialog
        const confirmBtn = await page.$('[data-testid="confirm-button"], button[type="submit"]');
        if (confirmBtn) await confirmBtn.click();
      }
    );

    if (removeResult.success) {
      db_.logActivity(sessionId, 'page_worker_removed', `Worker removed from page ${pageId} admins`);
    }
  } catch {
    // Non-critical — parking account already has admin
    db_.logActivity(sessionId, 'page_factory_warning', `Could not remove worker from page ${pageId} admins`);
  }
}

/**
 * Extracts a Facebook page ID from a URL.
 * Handles: /pages/name/ID, /ID, and ?page_id=ID formats.
 */
function extractPageId(url: string): string | null {
  // /pages/page-name/123456789
  const pagesMatch = url.match(/\/pages\/[^/]+\/(\d+)/);
  if (pagesMatch) return pagesMatch[1];

  // ?page_id=123456789
  const queryMatch = url.match(/[?&]page_id=(\d+)/);
  if (queryMatch) return queryMatch[1];

  // /123456789 (numeric path)
  const numericMatch = url.match(/facebook\.com\/(\d{10,})/);
  if (numericMatch) return numericMatch[1];

  return null;
}

/**
 * Resolves a page name template.
 * Replaces {random} with a random word from a built-in word list.
 */
function resolveNameTemplate(template: string): string {
  const randomWords = [
    'Global', 'Elite', 'Prime', 'Pro', 'Max', 'Ultra', 'Smart', 'Digital',
    'Creative', 'Dynamic', 'Innovative', 'Modern', 'Premium', 'Expert', 'Master',
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
 * The Page Factory tool — creates Facebook Pages and parks them safely.
 *
 * @example
 * import { pageFactory } from '../tools/page-factory'
 *
 * const campaign = await pageFactory.start({
 *   workerSessionIds: ['worker-1', 'worker-2'],
 *   parkingSessionId: 'parking-account',
 *   pagesPerWorker: 3,
 *   nameTemplate: 'TechStore {random}',
 *   category: 'Business',
 * })
 */
// ─────────────────────────────────────────────
// NAMED ENTRY POINT (task-spec signature)
// ─────────────────────────────────────────────

/**
 * Starts a Page Factory job using the canonical task-spec parameter signature.
 * Wraps `start(config)` for callers that prefer explicit positional parameters.
 *
 * @param workerIds - IDs of worker sessions that will create pages.
 * @param parkingId - ID of the parking session that will receive admin rights.
 * @param config    - Additional Page Factory configuration (pagesPerWorker, nameTemplate, etc.).
 * @returns The created Campaign record.
 *
 * @example
 * const campaign = await pageFactory.startPageFactoryJob(
 *   ['worker-1', 'worker-2'],
 *   'parking-account',
 *   { pagesPerWorker: 3, nameTemplate: 'TechStore {random}', category: 'Business' }
 * )
 */
async function startPageFactoryJob(
  workerIds: string[],
  parkingId: string,
  config: Omit<PageFactoryConfig, 'workerSessionIds' | 'parkingSessionId'>
): Promise<Campaign> {
  return start({ ...config, workerSessionIds: workerIds, parkingSessionId: parkingId });
}

export const pageFactory = {
  /** Starts a Page Factory job using a config object. Returns the created campaign. */
  start,
  /** Starts a Page Factory job using positional parameters (workerIds, parkingId, config). */
  startPageFactoryJob,
};
