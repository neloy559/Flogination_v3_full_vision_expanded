/**
 * Flogination V5 — Session Manager
 *
 * Manages the lifecycle of all active browser sessions.
 * Each session gets a completely isolated Chromium process via CloakBrowser.
 *
 * Responsibilities:
 *  - Launch / close / hibernate / wake browser instances
 *  - Track in-memory session state (idle, launching, active, hibernating)
 *  - Integrate proxy kill-switch monitoring per session
 *  - Detect OOM browser crashes and auto-relaunch
 *  - Run health checks against facebook.com
 *  - Provide session state to the API layer
 *
 * State is in-memory only — server restarts clear all running state.
 * The database is the source of truth for persistent session data.
 */

import { db_ } from '../database';
import { stealthBrowser, StealthBrowserInstance } from './stealth-browser';
import type { ChildProcess } from 'child_process';
import { proxyMonitor } from './proxy-monitor';
import { webhookService } from '../utils/webhook-service';
import type { Session, SessionState } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Delay before attempting to relaunch a browser that crashed due to OOM. */
const OOM_RELAUNCH_DELAY_MS = 10_000;

/** Maximum number of automatic OOM relaunch attempts per session. */
const MAX_OOM_RELAUNCHES = 1;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** In-memory record for an active session. */
interface ActiveSession {
  session: Session;
  instance: StealthBrowserInstance;
  state: SessionState;
  /** Number of OOM crashes that have occurred for this session. */
  oomCrashCount: number;
  /** PID of the Chromium browser process for OOM monitoring. */
  browserPid?: number;
}

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

/**
 * In-memory map of all active sessions.
 * Key: sessionId, Value: ActiveSession record.
 * Cleared on server restart — sessions must be relaunched manually.
 */
const activeSessions = new Map<string, ActiveSession>();

// ─────────────────────────────────────────────
// LAUNCH
// ─────────────────────────────────────────────

/**
 * Launches a stealth browser for a session.
 * Injects cookies, starts proxy monitoring, and tracks the browser PID.
 *
 * @param sessionId - The ID of the session to launch.
 * @param headless  - If true, launches without a visible window (for background tasks).
 * @returns Success or failure with an error message.
 *
 * @example
 * const result = await sessionManager.launch('session-uuid')
 * // → { success: true }
 */
async function launch(
  sessionId: string,
  headless = false
): Promise<{ success: boolean; error?: string }> {
  const session = db_.getSessionById(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const existing = activeSessions.get(sessionId);
  if (existing && existing.state !== 'idle') {
    return { success: false, error: `Session already ${existing.state}` };
  }

  // Mark as launching immediately to prevent duplicate launch attempts
  if (existing) {
    existing.state = 'launching';
  }

  try {
    const settings = db_.getSettings();
    const proxy = session.proxyId ? db_.getProxies().find((p) => p.id === session.proxyId) : undefined;

    // Build proxy string for CloakBrowser and proxy monitor
    const proxyString = proxy
      ? `${proxy.protocol}://${proxy.username ? encodeURIComponent(proxy.username) + ':' + encodeURIComponent(proxy.password ?? '') + '@' : ''}${proxy.host}:${proxy.port}`
      : undefined;

    // Launch the stealth browser
    const instance = await stealthBrowser.launch({
      sessionId,
      proxy,
      settings,
      headless,
    });

    // Inject Facebook cookies before any navigation
    await stealthBrowser.injectCookies(instance.context, session.cookie);

    // Track browser PID for OOM detection.
    // CloakBrowser may not expose .process() — guard against it being missing or null.
    let browserProcess: ChildProcess | null = null;
    try {
      const processGetter = (instance.browser as unknown as { process?: () => ChildProcess | null }).process;
      if (typeof processGetter === 'function') {
        browserProcess = processGetter.call(instance.browser);
      }
    } catch {
      // CloakBrowser stub browser — process() not available, OOM detection skipped
    }
    const browserPid = browserProcess?.pid;

    // Set up OOM crash detection only when we have a real process handle
    if (browserProcess) {
      setupOOMDetection(sessionId, browserProcess);
    }

    // Register in active sessions map
    activeSessions.set(sessionId, {
      session,
      instance,
      state: 'active',
      oomCrashCount: 0,
      browserPid,
    });

    // Start proxy kill-switch monitoring if proxy is assigned
    if (proxyString && settings.proxyKillSwitch) {
      proxyMonitor.start(sessionId, proxyString, async (id) => {
        await hibernate(id);
      });
    }

    db_.logActivity(
      sessionId,
      'session_launched',
      `Launched ${headless ? 'headless' : 'headed'} with proxy: ${proxy?.host ?? 'none'}`
    );

    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);

    // Clean up launching state on failure
    activeSessions.delete(sessionId);

    db_.logActivity(sessionId, 'session_launch_error', error);
    return { success: false, error };
  }
}

// ─────────────────────────────────────────────
// CLOSE
// ─────────────────────────────────────────────

/**
 * Closes a session's browser instance and cleans up all associated resources.
 * Stops proxy monitoring, clears OOM detection, removes from active map.
 *
 * @param sessionId - The ID of the session to close.
 * @returns Success or failure with an error message.
 */
async function close(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  const active = activeSessions.get(sessionId);
  if (!active) {
    return { success: false, error: 'Session not running' };
  }

  active.state = 'closing';

  try {
    // Stop proxy monitoring first
    proxyMonitor.stop(sessionId);

    // Close the browser
    await stealthBrowser.close(active.instance);

    activeSessions.delete(sessionId);
    db_.logActivity(sessionId, 'session_closed', 'Session closed by operator');
    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    // Remove from map even on error — browser is likely dead
    activeSessions.delete(sessionId);
    return { success: false, error };
  }
}

// ─────────────────────────────────────────────
// HIBERNATE / WAKE
// ─────────────────────────────────────────────

/**
 * Hibernates a session by closing its active page.
 * The browser context and cookies are preserved — wake() restores the page.
 * Saves RAM while keeping the session ready to resume quickly.
 *
 * @param sessionId - The ID of the session to hibernate.
 * @returns Success or failure with an error message.
 */
async function hibernate(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  const active = activeSessions.get(sessionId);
  if (!active || active.state !== 'active') {
    return { success: false, error: 'Session not active' };
  }

  try {
    active.state = 'hibernating';

    // Close the page but keep the context alive
    if (!active.instance.page.isClosed()) {
      await active.instance.page.close();
    }

    activeSessions.set(sessionId, active);
    db_.logActivity(sessionId, 'session_hibernated', 'Session hibernated');
    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    active.state = 'active'; // revert state on failure
    return { success: false, error };
  }
}

/**
 * Wakes a hibernated session by opening a new page in the existing context.
 * The browser context (cookies, storage) is preserved from before hibernation.
 *
 * @param sessionId - The ID of the session to wake.
 * @returns Success or failure with an error message.
 */
async function wake(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  const active = activeSessions.get(sessionId);
  if (!active || active.state !== 'hibernating') {
    return { success: false, error: 'Session not hibernating' };
  }

  try {
    // Open a new page in the existing context
    const newPage = await active.instance.context.newPage();

    // Re-inject stealth script on the new page.
    // page.addInitScript() is page-scoped — it does not carry over to new pages
    // created after hibernation. We must re-apply it so that the first navigation
    // on the woken page still has all fingerprint overrides in place.
    await stealthBrowser.injectStealthScript(newPage, active.instance.fingerprint);

    active.instance.page = newPage;
    active.state = 'active';

    activeSessions.set(sessionId, active);
    db_.logActivity(sessionId, 'session_woke', 'Session woke from hibernation');
    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────

/**
 * Checks the health of a Facebook session.
 * Launches a temporary headless browser if the session is not currently running.
 *
 * @param sessionId - The ID of the session to check.
 * @returns The health status and a message.
 */
async function checkHealth(
  sessionId: string
): Promise<{ success: boolean; status?: string; error?: string }> {
  const session = db_.getSessionById(sessionId);
  if (!session) {
    return { success: false, error: 'Session not found' };
  }

  const active = activeSessions.get(sessionId);

  if (active && active.state === 'active') {
    // Use the existing browser instance
    const health = await stealthBrowser.checkHealth(active.instance.page);
    updateHealthStatus(sessionId, health.status, session.healthStatus);
    return { success: true, status: health.status };
  }

  // Launch a temporary headless browser for the check
  const launchResult = await launch(sessionId, true);
  if (!launchResult.success) {
    return { success: false, error: `Failed to launch for health check: ${launchResult.error}` };
  }

  const launched = activeSessions.get(sessionId);
  if (!launched) {
    return { success: false, error: 'Launch succeeded but session not found in map' };
  }

  const health = await stealthBrowser.checkHealth(launched.instance.page);
  updateHealthStatus(sessionId, health.status, session.healthStatus);

  // Close the temporary browser
  await close(sessionId);

  return { success: true, status: health.status };
}

/**
 * Updates the session's health status in the database.
 * Fires a webhook if the status changed to checkpoint or dead.
 */
function updateHealthStatus(
  sessionId: string,
  newStatus: string,
  previousStatus: string
): void {
  db_.updateSession(sessionId, {
    healthStatus: newStatus as Session['healthStatus'],
    lastCheck: Date.now(),
  });

  if (newStatus !== previousStatus) {
    db_.logActivity(
      sessionId,
      'health_status_changed',
      `Status changed: ${previousStatus} → ${newStatus}`
    );

    // Fire webhook for bad status changes
    if (newStatus === 'checkpoint' || newStatus === 'dead') {
      const session = db_.getSessionById(sessionId);
      if (session) {
        webhookService.fireSessionAlert({
          sessionId,
          uid: session.uid,
          fbName: session.fbName,
          previousStatus,
          newStatus,
          timestamp: Date.now(),
        }).catch(() => {
          // Webhook failure is non-fatal
        });
      }
    }
  }
}

// ─────────────────────────────────────────────
// OOM CRASH DETECTION
// ─────────────────────────────────────────────

/**
 * Sets up OOM crash detection for a browser process.
 * When the process exits unexpectedly, attempts one automatic relaunch.
 *
 * @param sessionId      - The session whose browser to monitor.
 * @param browserProcess - The Node.js ChildProcess of the Chromium instance.
 */
function setupOOMDetection(
  sessionId: string,
  browserProcess: NodeJS.Process | { on: (event: string, cb: () => void) => void }
): void {
  (browserProcess as { on: (event: string, cb: () => void) => void }).on('exit', () => {
    const active = activeSessions.get(sessionId);

    // Only handle unexpected exits — not ones we triggered via close()
    if (!active || active.state === 'closing') return;

    console.warn(`[session-manager] Browser process exited unexpectedly for session ${sessionId}`);

    // Update in-memory state to idle
    active.state = 'idle';
    activeSessions.delete(sessionId);

    db_.logActivity(
      sessionId,
      'browser_oom_crash',
      `Browser process exited unexpectedly (possible OOM). Crash count: ${active.oomCrashCount + 1}`
    );

    // Attempt one automatic relaunch after delay
    if (active.oomCrashCount < MAX_OOM_RELAUNCHES) {
      console.log(`[session-manager] Scheduling relaunch for session ${sessionId} in ${OOM_RELAUNCH_DELAY_MS / 1000}s`);

      setTimeout(async () => {
        const result = await launch(sessionId);
        if (result.success) {
          const relaunched = activeSessions.get(sessionId);
          if (relaunched) {
            relaunched.oomCrashCount = active.oomCrashCount + 1;
          }
          db_.logActivity(sessionId, 'browser_oom_relaunch', 'Browser relaunched after OOM crash');
        } else {
          db_.logActivity(sessionId, 'browser_oom_relaunch_failed', result.error ?? 'Unknown error');
        }
      }, OOM_RELAUNCH_DELAY_MS);
    } else {
      db_.logActivity(
        sessionId,
        'browser_oom_max_relaunches',
        `Max relaunch attempts (${MAX_OOM_RELAUNCHES}) reached. Manual intervention required.`
      );
    }
  });
}

// ─────────────────────────────────────────────
// STATE QUERIES
// ─────────────────────────────────────────────

/**
 * Returns the current in-memory state of a session.
 * Returns 'idle' if the session is not in the active map.
 *
 * @param sessionId - The session ID to query.
 */
function getState(sessionId: string): SessionState {
  return activeSessions.get(sessionId)?.state ?? 'idle';
}

/**
 * Returns all currently active session records.
 * Used by the API to enrich session list responses with runtime state.
 */
function getActiveSessions(): ActiveSession[] {
  return Array.from(activeSessions.values());
}

/**
 * Returns the Playwright Page for an active session.
 * Returns undefined if the session is not active or is hibernating.
 *
 * @param sessionId - The session ID to get the page for.
 */
function getPage(sessionId: string) {
  const active = activeSessions.get(sessionId);
  if (!active || active.state !== 'active') return undefined;
  return active.instance.page;
}

/**
 * Returns the full StealthBrowserInstance for an active session.
 * Used by automation tools that need direct browser access.
 *
 * @param sessionId - The session ID to get the instance for.
 */
function getInstance(sessionId: string): StealthBrowserInstance | undefined {
  return activeSessions.get(sessionId)?.instance;
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The session manager — controls all browser session lifecycles.
 *
 * @example
 * import { sessionManager } from '../automation/session-manager'
 *
 * await sessionManager.launch(session.id)
 * const state = sessionManager.getState(session.id) // → 'active'
 * await sessionManager.hibernate(session.id)
 * await sessionManager.wake(session.id)
 * await sessionManager.close(session.id)
 */
export const sessionManager = {
  /** Launches a stealth browser for a session. */
  launch,
  /** Closes a session's browser and cleans up resources. */
  close,
  /** Hibernates a session (closes page, keeps context). */
  hibernate,
  /** Wakes a hibernated session (opens new page in existing context). */
  wake,
  /** Checks the health of a Facebook session. */
  checkHealth,
  /** Returns the current state of a session. */
  getState,
  /** Returns all active session records. */
  getActive: getActiveSessions,
  /** Returns the Playwright Page for an active session. */
  getPage,
  /** Returns the full browser instance for an active session. */
  getInstance,
};
