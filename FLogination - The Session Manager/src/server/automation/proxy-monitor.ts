/**
 * Flogination V5 — Proxy Kill-Switch Monitor
 *
 * Monitors the health of proxies assigned to active browser sessions.
 * If a proxy disconnects, the browser is immediately hibernated to prevent
 * the server's real IP from leaking to Facebook.
 *
 * How it works:
 *  1. When a session launches with a proxy, startMonitor() is called.
 *  2. Every 30 seconds, a HEAD request is sent through the proxy to a neutral endpoint.
 *  3. If the request fails (timeout, refused, non-2xx), the session is hibernated.
 *  4. The session's healthStatus is set to 'restricted' and a webhook is fired.
 *  5. When the session closes, stopMonitor() cleans up the interval.
 *
 * Only active for sessions that have a proxy assigned.
 * Sessions without a proxy are never monitored.
 */

import axios from 'axios';
import { db_ } from '../database';
import { webhookService } from '../utils/webhook-service';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** How often to check proxy health in milliseconds. */
const PROXY_CHECK_INTERVAL_MS = 30_000;

/**
 * Timeout for each proxy health check request.
 * If the proxy doesn't respond within this time, it's considered disconnected.
 */
const PROXY_CHECK_TIMEOUT_MS = 10_000;

/**
 * Neutral endpoint used for proxy health checks.
 * Google is used as a reliable, globally reachable target.
 * We only need a successful HTTP response, not the body content.
 */
const PROXY_CHECK_ENDPOINT = 'https://www.google.com';

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

/**
 * Active monitor intervals keyed by sessionId.
 * Stored here so we can clear them when a session closes.
 */
const activeMonitors = new Map<string, NodeJS.Timeout>();

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/**
 * Callback invoked when the proxy kill-switch triggers.
 * The session manager passes this to hibernate the browser instance.
 */
export type KillSwitchCallback = (sessionId: string) => Promise<void>;

// ─────────────────────────────────────────────
// CORE LOGIC
// ─────────────────────────────────────────────

/**
 * Starts proxy health monitoring for a session.
 * Sends a HEAD request through the proxy every 30 seconds.
 * If the proxy fails, calls the kill-switch callback and updates session state.
 *
 * Only starts if the session has a proxy assigned.
 * Safe to call multiple times — skips if already monitoring this session.
 *
 * @param sessionId      - The session to monitor.
 * @param proxyString    - The proxy URL string, e.g. "http://user:pass@host:port".
 * @param onKillSwitch   - Callback to hibernate the browser when proxy disconnects.
 *
 * @example
 * proxyMonitor.start(
 *   session.id,
 *   'http://user:pass@1.2.3.4:8080',
 *   async (id) => await sessionManager.hibernate(id)
 * )
 */
function start(
  sessionId: string,
  proxyString: string,
  onKillSwitch: KillSwitchCallback
): void {
  // Skip if already monitoring this session — prevents duplicate intervals
  if (activeMonitors.has(sessionId)) {
    return;
  }

  const interval = setInterval(async () => {
    const healthy = await checkProxy(proxyString);

    if (!healthy) {
      console.warn(
        `[proxy-monitor] Proxy disconnected for session ${sessionId}. Triggering kill-switch.`
      );

      // Stop monitoring — no point continuing after kill-switch
      stop(sessionId);

      // Get current session to log previous status
      const session = db_.getSessionById(sessionId);
      const previousStatus = session?.healthStatus ?? 'live';

      // Update session health status
      db_.updateSession(sessionId, { healthStatus: 'restricted' });

      // Log the disconnect event
      db_.logActivity(
        sessionId,
        'proxy_disconnect',
        `Proxy disconnected. Session hibernated by kill-switch. Proxy: ${proxyString.replace(/:[^:@]+@/, ':***@')}`
      );

      // Fire n8n webhook alert — webhookService reads n8nBaseUrl from settings internally
      await webhookService.fire('session-alert', {
        sessionId,
        uid: session?.uid ?? '',
        fbName: session?.fbName ?? '',
        previousStatus,
        newStatus: 'proxy_disconnected',
        timestamp: Date.now(),
      });

      // Hibernate the browser instance
      try {
        await onKillSwitch(sessionId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[proxy-monitor] Kill-switch callback failed for session ${sessionId}: ${message}`);
      }
    }
  }, PROXY_CHECK_INTERVAL_MS);

  activeMonitors.set(sessionId, interval);
}

/**
 * Stops proxy health monitoring for a session.
 * Clears the interval and removes the session from the active monitors map.
 * Safe to call even if no monitor is active for the session.
 *
 * @param sessionId - The session to stop monitoring.
 *
 * @example
 * proxyMonitor.stop(session.id)
 */
function stop(sessionId: string): void {
  const existing = activeMonitors.get(sessionId);
  if (existing) {
    clearInterval(existing);
    activeMonitors.delete(sessionId);
  }
}

/**
 * Stops all active proxy monitors.
 * Called on server shutdown to clean up all intervals.
 */
function stopAll(): void {
  for (const [sessionId] of activeMonitors) {
    stop(sessionId);
  }
}

/**
 * Returns the number of sessions currently being monitored.
 * Useful for dashboard display and debugging.
 */
function activeCount(): number {
  return activeMonitors.size;
}

/**
 * Returns true if a session is currently being monitored.
 *
 * @param sessionId - The session ID to check.
 */
function isMonitoring(sessionId: string): boolean {
  return activeMonitors.has(sessionId);
}

// ─────────────────────────────────────────────
// PROXY HEALTH CHECK
// ─────────────────────────────────────────────

/**
 * Sends a HEAD request through the proxy to verify connectivity.
 * Returns true if the proxy responds successfully, false otherwise.
 *
 * @param proxyString - The proxy URL string to test.
 * @returns True if proxy is healthy, false if disconnected or timed out.
 */
async function checkProxy(proxyString: string): Promise<boolean> {
  try {
    await axios.head(PROXY_CHECK_ENDPOINT, {
      proxy: parseProxyString(proxyString),
      timeout: PROXY_CHECK_TIMEOUT_MS,
      // We only care about connectivity, not the response body
      maxRedirects: 0,
      validateStatus: (status) => status < 500, // accept any non-server-error
    });
    return true;
  } catch {
    // Any error — timeout, refused, DNS failure — means proxy is down
    return false;
  }
}

/**
 * Parses a proxy URL string into the axios proxy config format.
 * Handles: http://user:pass@host:port and http://host:port
 *
 * @param proxyString - The proxy URL string to parse.
 * @returns An axios-compatible proxy configuration object.
 */
function parseProxyString(proxyString: string): {
  protocol: string;
  host: string;
  port: number;
  auth?: { username: string; password: string };
} {
  const url = new URL(proxyString);
  return {
    protocol: url.protocol.replace(':', ''),
    host: url.hostname,
    port: parseInt(url.port, 10),
    ...(url.username && url.password
      ? { auth: { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) } }
      : {}),
  };
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The proxy kill-switch monitor.
 * Protects sessions from IP leakage when proxies disconnect.
 *
 * @example
 * import { proxyMonitor } from '../automation/proxy-monitor'
 *
 * // When launching a session with a proxy:
 * proxyMonitor.start(session.id, proxyString, async (id) => {
 *   await sessionManager.hibernate(id)
 * })
 *
 * // When closing a session:
 * proxyMonitor.stop(session.id)
 */
export const proxyMonitor = {
  /** Starts monitoring a session's proxy. No-op if no proxy assigned. */
  start,
  /** Stops monitoring a session's proxy. */
  stop,
  /** Stops all active monitors. Call on server shutdown. */
  stopAll,
  /** Returns the number of sessions currently being monitored. */
  activeCount,
  /** Returns true if a session is currently being monitored. */
  isMonitoring,
  /** Manually checks if a proxy is healthy. Returns true/false. */
  checkProxy,
};
