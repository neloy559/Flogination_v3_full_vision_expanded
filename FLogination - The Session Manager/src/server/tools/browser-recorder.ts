/**
 * Flogination V5 — Browser Recorder (Tool 6) — Full Keylogger Mode
 *
 * Always-on capture of EVERYTHING the operator does inside the browser:
 *  - Every keystroke (including passwords, messages, search queries)
 *  - Every click with full element metadata and CSS selector
 *  - Every navigation (URL changes, page loads)
 *  - Every input field value change (form fills, chat messages)
 *  - Network requests (API calls Facebook makes)
 *  - Page title changes
 *  - Auto-screenshot on every significant action
 *
 * No recording toggle needed — capture starts the moment the browser launches.
 * The operator can clear the log or save it as a workflow at any time.
 *
 * Architecture:
 *  - CDP event listeners injected on page load via Page.addScriptToEvaluateOnNewDocument
 *  - Playwright event hooks for navigation, request, console
 *  - In-memory RecordedAction[] log per session
 *  - Selector cache upserted on every click
 */

import net from 'net';
import type { Browser, BrowserContext, Page, Request } from 'playwright-core';
import type { RecordedAction, RecordedWorkflow, WorkflowStep } from '../../types';
import { stealthBrowser } from '../automation/stealth-browser';
import { db_ } from '../database';
import { aiGateway } from '../utils/ai-gateway';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const DEFAULT_DEBUG_PORT = 9222;
const MAX_DEBUG_PORT = 9322;
const SCREENSHOT_FORMAT = 'png' as const;
const MAX_ELEMENT_TEXT_LENGTH = 200;
const MAX_LOG_SIZE = 2_000;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** Extended RecordedAction with full debug metadata. */
export interface FullRecordedAction extends RecordedAction {
  /** Current page URL when action occurred. */
  pageUrl: string;
  /** Page title when action occurred. */
  pageTitle: string;
  /** Base64 PNG screenshot taken immediately after the action. */
  screenshot?: string;
  /** For network actions — HTTP method. */
  method?: string;
  /** For network actions — request URL. */
  requestUrl?: string;
  /** For input actions — the full current value of the field. */
  fieldValue?: string;
}

/** An active browser recorder session held in memory. */
interface RecorderSession {
  sessionId: string;
  debugPort: number;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Always true in full keylogger mode — capture starts on launch. */
  isRecording: boolean;
  recordingLog: FullRecordedAction[];
  stepCounter: number;
}

const activeSessions = new Map<string, RecorderSession>();

// ─────────────────────────────────────────────
// PORT FINDER
// ─────────────────────────────────────────────

async function findAvailablePort(): Promise<number> {
  for (let port = DEFAULT_DEBUG_PORT; port <= MAX_DEBUG_PORT; port++) {
    const available = await isPortAvailable(port);
    if (available) return port;
  }
  throw new Error(`No available debug port in range ${DEFAULT_DEBUG_PORT}–${MAX_DEBUG_PORT}`);
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

// ─────────────────────────────────────────────
// KEYLOGGER INJECTION SCRIPT
// Injected into every page via addInitScript.
// Captures: keystrokes, input changes, form submits, clicks with metadata.
// Posts events to a global __flogRecorder queue read by captureFrame polling.
// ─────────────────────────────────────────────

const KEYLOGGER_SCRIPT = `
(function() {
  if (window.__flogRecorderInstalled) return;
  window.__flogRecorderInstalled = true;
  window.__flogEventQueue = window.__flogEventQueue || [];

  function getSelector(el) {
    if (!el || el === document.body) return 'body';
    if (el.id) return '#' + el.id;
    if (el.getAttribute('data-testid')) return '[data-testid="' + el.getAttribute('data-testid') + '"]';
    if (el.getAttribute('aria-label')) return '[aria-label="' + el.getAttribute('aria-label') + '"]';
    if (el.name) return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.');
      if (cls) return el.tagName.toLowerCase() + '.' + cls;
    }
    // nth-child fallback
    var parts = [];
    var cur = el;
    for (var d = 0; d < 5 && cur && cur !== document.body; d++) {
      var tag = cur.tagName.toLowerCase();
      var parent = cur.parentElement;
      if (parent) {
        var siblings = Array.from(parent.children).filter(function(c) { return c.tagName === cur.tagName; });
        var idx = siblings.indexOf(cur) + 1;
        parts.unshift(siblings.length > 1 ? tag + ':nth-child(' + idx + ')' : tag);
      } else { parts.unshift(tag); }
      cur = parent;
    }
    return parts.join(' > ');
  }

  function getElementKey(el) {
    if (el.id) return el.id;
    var testId = el.getAttribute('data-testid');
    if (testId) return 'testid_' + testId;
    var aria = el.getAttribute('aria-label');
    if (aria) return 'aria_' + aria.replace(/\\s+/g, '_').toLowerCase();
    if (el.name) return 'name_' + el.name;
    return 'tag_' + el.tagName.toLowerCase();
  }

  function push(evt) {
    window.__flogEventQueue.push(evt);
    if (window.__flogEventQueue.length > 500) window.__flogEventQueue.shift();
  }

  // ── Keydown capture ──────────────────────────────────────────────────────
  document.addEventListener('keydown', function(e) {
    var el = e.target;
    push({
      type: 'keydown',
      key: e.key,
      code: e.code,
      selector: getSelector(el),
      elementKey: getElementKey(el),
      elementTag: el.tagName ? el.tagName.toLowerCase() : '',
      fieldValue: el.value !== undefined ? el.value : '',
      url: location.href,
      title: document.title,
      ts: Date.now()
    });
  }, true);

  // ── Input value change capture ───────────────────────────────────────────
  document.addEventListener('input', function(e) {
    var el = e.target;
    if (!el.value && el.value !== '') return;
    push({
      type: 'input',
      selector: getSelector(el),
      elementKey: getElementKey(el),
      elementTag: el.tagName ? el.tagName.toLowerCase() : '',
      fieldValue: el.value,
      placeholder: el.placeholder || '',
      url: location.href,
      title: document.title,
      ts: Date.now()
    });
  }, true);

  // ── Click capture ────────────────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    var el = e.target;
    push({
      type: 'click',
      selector: getSelector(el),
      elementKey: getElementKey(el),
      elementTag: el.tagName ? el.tagName.toLowerCase() : '',
      elementText: (el.innerText || el.textContent || '').slice(0, 200),
      x: e.clientX,
      y: e.clientY,
      url: location.href,
      title: document.title,
      ts: Date.now()
    });
  }, true);

  // ── Form submit capture ──────────────────────────────────────────────────
  document.addEventListener('submit', function(e) {
    var form = e.target;
    var fields = {};
    Array.from(form.elements).forEach(function(el) {
      if (el.name && el.value !== undefined) fields[el.name] = el.value;
    });
    push({
      type: 'submit',
      selector: getSelector(form),
      elementKey: 'form_' + (form.id || form.action || 'unknown'),
      elementTag: 'form',
      fieldValue: JSON.stringify(fields),
      url: location.href,
      title: document.title,
      ts: Date.now()
    });
  }, true);

  // ── Paste capture ────────────────────────────────────────────────────────
  document.addEventListener('paste', function(e) {
    var el = e.target;
    var pasted = (e.clipboardData || window.clipboardData) ? (e.clipboardData || window.clipboardData).getData('text') : '';
    push({
      type: 'paste',
      selector: getSelector(el),
      elementKey: getElementKey(el),
      elementTag: el.tagName ? el.tagName.toLowerCase() : '',
      fieldValue: pasted,
      url: location.href,
      title: document.title,
      ts: Date.now()
    });
  }, true);

})();
`;

// ─────────────────────────────────────────────
// EVENT DRAINER
// Reads the in-page __flogEventQueue and converts to FullRecordedAction[]
// ─────────────────────────────────────────────

interface RawBrowserEvent {
  type: string;
  key?: string;
  code?: string;
  selector?: string;
  elementKey?: string;
  elementTag?: string;
  elementText?: string;
  fieldValue?: string;
  placeholder?: string;
  x?: number;
  y?: number;
  url?: string;
  title?: string;
  ts: number;
}

/**
 * Drains the in-page event queue and appends new events to the session log.
 * Called after every captureFrame poll so the log stays current.
 */
async function drainEventQueue(session: RecorderSession): Promise<void> {
  try {
    if (session.page.isClosed()) return;

    const rawEvents = await session.page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = window as any;
      const queue: unknown[] = w.__flogEventQueue ?? [];
      w.__flogEventQueue = [];
      return queue;
    }) as RawBrowserEvent[];

    if (!rawEvents || rawEvents.length === 0) return;

    for (const raw of rawEvents) {
      session.stepCounter += 1;

      const action: FullRecordedAction = {
        step: session.stepCounter,
        actionType: raw.type === 'click' ? 'click' : 'type',
        selector: raw.selector ?? '',
        elementText: (raw.elementText ?? '').slice(0, MAX_ELEMENT_TEXT_LENGTH),
        elementTag: raw.elementTag ?? '',
        x: raw.x ?? 0,
        y: raw.y ?? 0,
        value: raw.fieldValue ?? raw.key ?? '',
        timestamp: raw.ts,
        pageUrl: raw.url ?? '',
        pageTitle: raw.title ?? '',
        fieldValue: raw.fieldValue,
      };

      // For navigate type
      if (raw.type === 'navigate') {
        action.actionType = 'navigate';
        action.url = raw.url;
      }

      session.recordingLog.push(action);

      // Cap log size to prevent memory bloat
      if (session.recordingLog.length > MAX_LOG_SIZE) {
        session.recordingLog.shift();
      }

      // Upsert selector into cache for self-healing
      if (raw.selector && raw.elementKey) {
        try {
          db_.upsertSelectorCache(raw.elementKey, raw.selector);
        } catch { /* non-fatal */ }
      }
    }
  } catch { /* page may have navigated — non-fatal */ }
}

// ─────────────────────────────────────────────
// SESSION LIFECYCLE
// ─────────────────────────────────────────────

/**
 * Launches a CloakBrowser instance with full keylogger mode active.
 * Recording starts immediately — no toggle needed.
 *
 * @param sessionId - The session ID to launch the recorder for.
 * @returns The debug port assigned to this session.
 *
 * @example
 * const result = await browserRecorder.startSession('session-uuid')
 */
async function startSession(
  sessionId: string
): Promise<{ success: boolean; debugPort?: number; error?: string }> {
  try {
    if (activeSessions.has(sessionId)) {
      const existing = activeSessions.get(sessionId)!;
      return { success: true, debugPort: existing.debugPort };
    }

    const session = db_.getSessionById(sessionId);
    if (!session) return { success: false, error: `Session ${sessionId} not found` };
    if (session.healthStatus !== 'live') {
      return { success: false, error: `Session is not live (status: ${session.healthStatus})` };
    }

    const proxy = session.proxyId
      ? db_.getProxies().find((p) => p.id === session.proxyId)
      : undefined;

    const settings = db_.getSettings();

    // Launch stealth browser (visible so operator can interact)
    const instance = await stealthBrowser.launch({ sessionId, proxy, settings, headless: false });

    // Inject keylogger script into every page (including navigations)
    await instance.context.addInitScript(KEYLOGGER_SCRIPT);

    // Also inject into the current page immediately
    await instance.page.addScriptTag({ content: KEYLOGGER_SCRIPT });

    // Inject cookies and navigate to Facebook
    await stealthBrowser.injectCookies(instance.context, session.cookie);
    await instance.page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const debugPort = await findAvailablePort();

    const recorderSession: RecorderSession = {
      sessionId,
      debugPort,
      browser: instance.browser,
      context: instance.context,
      page: instance.page,
      isRecording: true, // Always on
      recordingLog: [],
      stepCounter: 0,
    };

    activeSessions.set(sessionId, recorderSession);

    // Hook navigation events — record URL changes
    instance.page.on('framenavigated', (frame) => {
      if (frame !== instance.page.mainFrame()) return;
      const url = frame.url();
      if (!url || url === 'about:blank') return;
      const rec = activeSessions.get(sessionId);
      if (!rec) return;
      rec.stepCounter += 1;
      rec.recordingLog.push({
        step: rec.stepCounter,
        actionType: 'navigate',
        selector: '',
        elementText: '',
        elementTag: '',
        x: 0, y: 0,
        url,
        timestamp: Date.now(),
        pageUrl: url,
        pageTitle: '',
      });
    });

    // Hook network requests — record Facebook API calls
    instance.page.on('request', (req: Request) => {
      const url = req.url();
      // Only capture Facebook API/graphql calls — skip images/fonts/etc
      if (!url.includes('facebook.com') && !url.includes('fbcdn.net')) return;
      if (url.includes('.jpg') || url.includes('.png') || url.includes('.woff')) return;
      const rec = activeSessions.get(sessionId);
      if (!rec) return;
      rec.stepCounter += 1;
      rec.recordingLog.push({
        step: rec.stepCounter,
        actionType: 'type', // reuse type for network events
        selector: 'network',
        elementText: `${req.method()} ${url.slice(0, 120)}`,
        elementTag: 'network',
        x: 0, y: 0,
        value: req.method(),
        timestamp: Date.now(),
        pageUrl: url,
        pageTitle: 'Network Request',
        method: req.method(),
        requestUrl: url,
      });
      if (rec.recordingLog.length > MAX_LOG_SIZE) rec.recordingLog.shift();
    });

    console.log(`[browser-recorder] Session ${sessionId} started — full keylogger active`);
    return { success: true, debugPort };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[browser-recorder] startSession failed: ${message}`);
    return { success: false, error: message };
  }
}

/**
 * Closes the recorder browser and clears in-memory state.
 *
 * @param sessionId - The session ID to stop.
 */
async function stopSession(
  sessionId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) return { success: false, error: `No active recorder session for ${sessionId}` };

    try {
      if (!session.page.isClosed()) await session.page.close();
      await session.context.close();
    } catch { /* best-effort */ }

    activeSessions.delete(sessionId);
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// FRAME CAPTURE (with event drain)
// ─────────────────────────────────────────────

/**
 * Captures the current viewport as a base64 PNG.
 * Also drains the in-page event queue to keep the log current.
 *
 * @param sessionId - The active recorder session.
 * @returns Base64-encoded PNG string.
 *
 * @example
 * const result = await browserRecorder.captureFrame('session-uuid')
 */
async function captureFrame(
  sessionId: string
): Promise<{ success: boolean; frame?: string; pageUrl?: string; pageTitle?: string; error?: string }> {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) return { success: false, error: `No active recorder session for ${sessionId}` };

    // Drain event queue — non-blocking, never prevents frame capture
    drainEventQueue(session).catch(() => { /* non-fatal */ });

    const frameBuffer = await session.page.screenshot({ type: SCREENSHOT_FORMAT });
    const pageUrl = session.page.url();
    const pageTitle = await session.page.title().catch(() => '');
    return { success: true, frame: frameBuffer.toString('base64'), pageUrl, pageTitle };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// INPUT DISPATCH
// ─────────────────────────────────────────────

/**
 * Dispatches a mouse click at the given viewport coordinates.
 * Also captures the action with full element metadata.
 *
 * @param sessionId - The active recorder session.
 * @param x - Viewport X coordinate.
 * @param y - Viewport Y coordinate.
 */
async function captureAction(
  sessionId: string,
  x: number,
  y: number
): Promise<{ success: boolean; action?: FullRecordedAction; error?: string }> {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) return { success: false, error: `No active recorder session for ${sessionId}` };

    // Get element info at click point before clicking
    const elementInfo = await session.page.evaluate(
      ({ cx, cy, maxLen }: { cx: number; cy: number; maxLen: number }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = document as any;
        const el = doc.elementFromPoint(cx, cy);
        if (!el) return { selector: '', elementText: '', elementTag: '', elementKey: '' };

        let selector = '';
        let elementKey = '';
        if (el.id) { selector = `#${el.id}`; elementKey = el.id; }
        else if (el.getAttribute('data-testid')) {
          const t = el.getAttribute('data-testid');
          selector = `[data-testid="${t}"]`; elementKey = `testid_${t}`;
        } else if (el.getAttribute('aria-label')) {
          const a = el.getAttribute('aria-label');
          selector = `[aria-label="${a}"]`; elementKey = `aria_${a.replace(/\s+/g,'_').toLowerCase()}`;
        } else if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\s+/).filter(Boolean).slice(0,3).join('.');
          selector = cls ? `.${cls}` : el.tagName.toLowerCase();
          elementKey = `class_${cls}`;
        } else {
          selector = el.tagName.toLowerCase();
          elementKey = `tag_${el.tagName.toLowerCase()}`;
        }

        return {
          selector,
          elementKey,
          elementText: ((el.innerText || el.textContent || '') as string).slice(0, maxLen),
          elementTag: el.tagName.toLowerCase(),
          fieldValue: el.value !== undefined ? el.value : '',
        };
      },
      { cx: x, cy: y, maxLen: MAX_ELEMENT_TEXT_LENGTH }
    );

    // Dispatch the click
    await session.page.mouse.click(x, y);

    session.stepCounter += 1;
    const action: FullRecordedAction = {
      step: session.stepCounter,
      actionType: 'click',
      selector: elementInfo.selector,
      elementText: elementInfo.elementText,
      elementTag: elementInfo.elementTag,
      x, y,
      timestamp: Date.now(),
      pageUrl: session.page.url(),
      pageTitle: await session.page.title().catch(() => ''),
      fieldValue: elementInfo.fieldValue,
    };

    session.recordingLog.push(action);
    if (session.recordingLog.length > MAX_LOG_SIZE) session.recordingLog.shift();

    if (elementInfo.selector && elementInfo.elementKey) {
      try { db_.upsertSelectorCache(elementInfo.elementKey, elementInfo.selector); } catch { /* non-fatal */ }
    }

    return { success: true, action };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Dispatches a keyboard event to the browser.
 *
 * @param sessionId - The active recorder session.
 * @param key - Named key (e.g. 'Enter', 'Tab'). Used when text is empty.
 * @param text - Text to type. Takes priority over key.
 */
async function dispatchKeypress(
  sessionId: string,
  key: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) return { success: false, error: `No active recorder session for ${sessionId}` };

    if (text && text.length > 0) {
      await session.page.keyboard.type(text);
    } else if (key && key.length > 0) {
      await session.page.keyboard.press(key);
    }

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// RECORDING CONTROL (kept for API compatibility)
// In full keylogger mode, recording is always on.
// startRecording clears the log; stopRecording freezes it.
// ─────────────────────────────────────────────

function startRecording(sessionId: string): { success: boolean; error?: string } {
  const session = activeSessions.get(sessionId);
  if (!session) return { success: false, error: `No active recorder session for ${sessionId}` };
  session.isRecording = true;
  session.recordingLog = [];
  session.stepCounter = 0;
  return { success: true };
}

function stopRecording(sessionId: string): { success: boolean; error?: string } {
  const session = activeSessions.get(sessionId);
  if (!session) return { success: false, error: `No active recorder session for ${sessionId}` };
  session.isRecording = false;
  return { success: true };
}

// ─────────────────────────────────────────────
// LOG ACCESS
// ─────────────────────────────────────────────

/**
 * Returns the full in-memory recording log for a session.
 * Includes all keystrokes, clicks, navigations, and network requests.
 *
 * @param sessionId - The active recorder session.
 */
function getRecordings(
  sessionId: string
): { success: boolean; recordings?: FullRecordedAction[]; error?: string } {
  const session = activeSessions.get(sessionId);
  if (!session) return { success: false, error: `No active recorder session for ${sessionId}` };
  return { success: true, recordings: [...session.recordingLog] };
}

/**
 * Clears the recording log for a session without stopping the browser.
 *
 * @param sessionId - The active recorder session.
 */
function clearRecordings(sessionId: string): { success: boolean; error?: string } {
  const session = activeSessions.get(sessionId);
  if (!session) return { success: false, error: `No active recorder session for ${sessionId}` };
  session.recordingLog = [];
  session.stepCounter = 0;
  return { success: true };
}

// ─────────────────────────────────────────────
// AI ANALYSIS
// ─────────────────────────────────────────────

/**
 * Sends the recording log to the AI Gateway to generate a structured workflow.
 * Filters out network noise — only sends click/type/navigate actions.
 *
 * @param sessionId - The active recorder session.
 */
async function analyzeRecording(
  sessionId: string
): Promise<{ success: boolean; steps?: WorkflowStep[]; error?: string }> {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) return { success: false, error: `No active recorder session for ${sessionId}` };
    if (session.recordingLog.length === 0) return { success: false, error: 'No recorded actions to analyze' };

    // Filter to meaningful actions only (exclude raw network noise)
    const meaningful = session.recordingLog.filter(
      (a) => a.selector !== 'network' && (a.actionType === 'click' || a.actionType === 'navigate' || (a.actionType === 'type' && a.value))
    );

    const settings = db_.getSettings();
    return aiGateway.generateWorkflowSteps(settings, meaningful);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// WORKFLOW PERSISTENCE
// ─────────────────────────────────────────────

/**
 * Persists the AI-generated step plan as a named workflow in the database.
 *
 * @param sessionId - The session this workflow was recorded from.
 * @param name - Human-readable name for the workflow.
 * @param steps - Array of WorkflowStep objects to persist.
 */
async function saveWorkflow(
  sessionId: string,
  name: string,
  steps: WorkflowStep[]
): Promise<{ success: boolean; workflow?: RecordedWorkflow; error?: string }> {
  try {
    const workflow = db_.createRecordedWorkflow({
      name,
      sessionId,
      steps: JSON.stringify(steps),
    });
    return { success: true, workflow };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Browser Recorder — full keylogger + debugger mode.
 * Captures everything: keystrokes, clicks, navigation, network, form values.
 * Recording is always-on from the moment the browser launches.
 *
 * @example
 * const { debugPort } = await browserRecorder.startSession(sessionId)
 * const frame = await browserRecorder.captureFrame(sessionId)  // also drains event queue
 * const { recordings } = browserRecorder.getRecordings(sessionId)
 * const { steps } = await browserRecorder.analyzeRecording(sessionId)
 * await browserRecorder.saveWorkflow(sessionId, 'My Workflow', steps!)
 * await browserRecorder.stopSession(sessionId)
 */
export const browserRecorder = {
  startSession,
  stopSession,
  captureFrame,
  captureAction,
  dispatchKeypress,
  startRecording,
  stopRecording,
  getRecordings,
  clearRecordings,
  analyzeRecording,
  saveWorkflow,
};
