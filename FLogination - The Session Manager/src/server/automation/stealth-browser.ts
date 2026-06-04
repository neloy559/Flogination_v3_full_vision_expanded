/**
 * Flogination V5 — Stealth Browser
 *
 * Launches isolated stealth Chromium instances using CloakBrowser.
 * CloakBrowser patches Chromium at the C++ source level — not JS injection —
 * making it undetectable by Facebook's bot detection systems.
 *
 * Key capabilities:
 *  - C++ level fingerprint patches (Canvas, WebGL, AudioContext, UA, screen)
 *  - humanize:true — Bezier mouse curves, per-character typing, realistic scroll
 *  - geoip:true — auto-detects timezone/locale from proxy exit IP
 *  - Per-session persistent profiles (user-data/{sessionId}/)
 *  - Per-session fingerprint seed stored in fingerprint.json
 *  - Proxy kill-switch integration via proxy-monitor
 *  - WebRTC IP spoofing via --fingerprint-webrtc-ip=auto
 *
 * Each session gets a completely isolated Browser instance — not a shared context.
 * This ensures zero cross-contamination between accounts.
 */

import path from 'path';
import fs from 'fs';
import { randomBytes } from 'crypto';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import type { Proxy, AppSettings, FingerprintData, HealthStatus } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Base directory for all per-session browser profiles. */
const USER_DATA_BASE = process.env.USERPROFILE
  ? path.join(process.env.USERPROFILE, '.flogination', 'profiles')
  : path.resolve(process.cwd(), 'user-data');

/** Filename for the per-session fingerprint seed file. */
const FINGERPRINT_FILE = 'fingerprint.json';

/**
 * Fingerprint seed range for CloakBrowser.
 * Seeds 10000–99999 produce unique, coherent fingerprints.
 */
const FINGERPRINT_SEED_MIN = 10_000;
const FINGERPRINT_SEED_MAX = 99_999;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** A fully launched stealth browser instance with all handles. */
export interface StealthBrowserInstance {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  userDataDir: string;
  fingerprint: FingerprintData;
}

/** Options for launching a stealth browser session. */
export interface LaunchOptions {
  sessionId: string;
  proxy?: Proxy;
  settings: AppSettings;
  /** If true, launches in headless mode (for background scraping). Default: false. */
  headless?: boolean;
}

// ─────────────────────────────────────────────
// FINGERPRINT MANAGEMENT
// ─────────────────────────────────────────────

/**
 * Generates a new unique fingerprint for a session.
 * Uses cryptographically random bytes for the seed to ensure uniqueness.
 * The seed is stored in fingerprint.json and reused on subsequent launches
 * so the same session always presents the same browser identity.
 *
 * Screen size, viewport, WebGL, Canvas, and UA are all derived from the same
 * seed so they form a consistent, coherent fingerprint profile.
 *
 * @returns A FingerprintData object with all per-session identity values.
 */
function generateFingerprint(): FingerprintData {
  const seedBytes = randomBytes(4).readUInt32BE(0);
  const seed = FINGERPRINT_SEED_MIN + (seedBytes % (FINGERPRINT_SEED_MAX - FINGERPRINT_SEED_MIN + 1));

  // Pick a realistic screen resolution — must match what CloakBrowser reports
  // Common Windows desktop resolutions used by real Facebook users
  const SCREEN_POOL: Array<{ width: number; height: number }> = [
    { width: 1920, height: 1080 }, // Most common — 1080p
    { width: 1920, height: 1080 },
    { width: 1920, height: 1080 }, // Weighted 3x — most common
    { width: 1366, height: 768  }, // Common laptop
    { width: 1440, height: 900  }, // MacBook-style
    { width: 1536, height: 864  }, // Common Windows laptop
    { width: 2560, height: 1440 }, // 1440p monitor
    { width: 1280, height: 720  }, // HD
  ];
  const screen = SCREEN_POOL[seed % SCREEN_POOL.length];

  return {
    canvasNoiseSeed: seed / FINGERPRINT_SEED_MAX,
    webglRenderer: pickFromPool(WEBGL_RENDERER_POOL, seed),
    webglVendor: 'Google Inc. (NVIDIA)',
    audioContextNoise: (seed % 1000) / 1_000_000,
    userAgent: pickFromPool(USER_AGENT_POOL, seed + 1),
    screenWidth: screen.width,
    screenHeight: screen.height,
  };
}

/**
 * Loads an existing fingerprint from disk, or generates and saves a new one.
 * Called on every session launch — ensures the same identity is reused.
 *
 * @param userDataDir - The session's isolated profile directory.
 * @returns The loaded or newly generated FingerprintData.
 */
function loadOrCreateFingerprint(userDataDir: string): FingerprintData {
  const fingerprintPath = path.join(userDataDir, FINGERPRINT_FILE);

  if (fs.existsSync(fingerprintPath)) {
    try {
      const raw = fs.readFileSync(fingerprintPath, 'utf-8');
      return JSON.parse(raw) as FingerprintData;
    } catch {
      // Corrupted file — regenerate
      console.warn(`[stealth-browser] Corrupted fingerprint.json at ${fingerprintPath}, regenerating.`);
    }
  }

  // Generate new fingerprint and persist it
  const fingerprint = generateFingerprint();
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(fingerprintPath, JSON.stringify(fingerprint, null, 2), 'utf-8');
  return fingerprint;
}

/**
 * Picks a value from a pool array using a numeric seed for determinism.
 * Same seed always returns the same value from the pool.
 */
function pickFromPool<T>(pool: T[], seed: number): T {
  return pool[seed % pool.length];
}

// ─────────────────────────────────────────────
// FINGERPRINT POOLS
// ─────────────────────────────────────────────

/** Realistic ANGLE WebGL renderer strings for Windows machines. */
const WEBGL_RENDERER_POOL: string[] = [
  'ANGLE (Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)',
  'ANGLE (NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)',
  'ANGLE (NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
  'ANGLE (AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)',
  'ANGLE (Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)',
  'ANGLE (NVIDIA GeForce GTX 1080 Ti Direct3D11 vs_5_0 ps_5_0)',
  'ANGLE (AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0)',
  'ANGLE (Intel(R) HD Graphics 630 Direct3D11 vs_5_0 ps_5_0)',
  'ANGLE (NVIDIA GeForce RTX 2070 Direct3D11 vs_5_0 ps_5_0)',
  'ANGLE (AMD Radeon RX 5700 XT Direct3D11 vs_5_0 ps_5_0)',
];

/** Realistic Chrome User-Agent strings for Windows 10/11. */
const USER_AGENT_POOL: string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

// ─────────────────────────────────────────────
// TIMEZONE / LOCALE MAPPING
// ─────────────────────────────────────────────

/** Maps 2-letter country codes to CDP timezone and locale overrides. */
const COUNTRY_TIMEZONE_MAP: Record<string, { timezoneId: string; locale: string }> = {
  US: { timezoneId: 'America/New_York',      locale: 'en-US' },
  UK: { timezoneId: 'Europe/London',         locale: 'en-GB' },
  GB: { timezoneId: 'Europe/London',         locale: 'en-GB' },
  BD: { timezoneId: 'Asia/Dhaka',            locale: 'bn-BD' },
  IN: { timezoneId: 'Asia/Kolkata',          locale: 'en-IN' },
  PH: { timezoneId: 'Asia/Manila',           locale: 'en-PH' },
  ID: { timezoneId: 'Asia/Jakarta',          locale: 'id-ID' },
  VN: { timezoneId: 'Asia/Ho_Chi_Minh',      locale: 'vi-VN' },
  TH: { timezoneId: 'Asia/Bangkok',          locale: 'th-TH' },
  MY: { timezoneId: 'Asia/Kuala_Lumpur',     locale: 'ms-MY' },
  SG: { timezoneId: 'Asia/Singapore',        locale: 'en-SG' },
  AU: { timezoneId: 'Australia/Sydney',      locale: 'en-AU' },
  CA: { timezoneId: 'America/Toronto',       locale: 'en-CA' },
  DE: { timezoneId: 'Europe/Berlin',         locale: 'de-DE' },
  FR: { timezoneId: 'Europe/Paris',          locale: 'fr-FR' },
  BR: { timezoneId: 'America/Sao_Paulo',     locale: 'pt-BR' },
  NG: { timezoneId: 'Africa/Lagos',          locale: 'en-NG' },
  PK: { timezoneId: 'Asia/Karachi',          locale: 'ur-PK' },
  EG: { timezoneId: 'Africa/Cairo',          locale: 'ar-EG' },
  TR: { timezoneId: 'Europe/Istanbul',       locale: 'tr-TR' },
};

/** Default timezone/locale for unknown country codes. */
const DEFAULT_TIMEZONE = { timezoneId: 'America/New_York', locale: 'en-US' };

/**
 * Returns the CDP timezone and locale settings for a given country code.
 * Falls back to US Eastern if the country is not in the map.
 *
 * @param country - 2-letter ISO country code, e.g. 'BD', 'US', 'PH'.
 */
function getTimezoneLocale(country: string): { timezoneId: string; locale: string } {
  return COUNTRY_TIMEZONE_MAP[country.toUpperCase()] ?? DEFAULT_TIMEZONE;
}

// ─────────────────────────────────────────────
// CDP FINGERPRINT INJECTION
// ─────────────────────────────────────────────

/**
 * Injects all stealth fingerprint overrides into a Playwright page using
 * `addInitScript` (which maps to CDP's `Page.addScriptToEvaluateOnNewDocument`).
 * This runs before any page script executes, making the overrides invisible
 * to bot-detection probes.
 *
 * Overrides applied:
 *  - `navigator.webdriver` → undefined (removes the primary automation signal)
 *  - `window.chrome.runtime` → minimal mock (passes chrome-presence checks)
 *  - Canvas `toDataURL` / `getImageData` → subtle per-session noise
 *  - WebGL `getParameter` → spoofed renderer and vendor strings
 *  - AudioBuffer `getChannelData` → subtle per-session noise
 *
 * @param page        - The Playwright Page to patch.
 * @param fingerprint - The per-session FingerprintData used to seed all noise values.
 *
 * @example
 * await injectStealthScript(page, fingerprint)
 */
async function injectStealthScript(page: Page, fingerprint: FingerprintData): Promise<void> {
  // Serialise only the values the injected script needs — avoids passing the
  // full object and keeps the injected string small.
  const canvasNoise = fingerprint.canvasNoiseSeed;
  const audioNoise  = fingerprint.audioContextNoise;
  const renderer    = fingerprint.webglRenderer;
  const vendor      = fingerprint.webglVendor;

  // The script is a self-invoking function so it does not pollute the global
  // scope with helper variables.
  const script = `
(function () {
  // ── 1. Remove navigator.webdriver ──────────────────────────────────────
  // Facebook checks this property directly. Setting it to undefined via
  // Object.defineProperty prevents the getter from returning true.
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
      configurable: true,
    });
  } catch (_) { /* already defined non-configurable — ignore */ }

  // ── 2. chrome.runtime mock ─────────────────────────────────────────────
  // Many bot-detection scripts check for window.chrome.runtime to confirm
  // the browser is a real Chrome install. Inject a minimal stub.
  try {
    if (!window.chrome) {
      Object.defineProperty(window, 'chrome', {
        value: { runtime: {} },
        writable: false,
        configurable: true,
      });
    } else if (!window.chrome.runtime) {
      window.chrome.runtime = {};
    }
  } catch (_) { /* already defined — ignore */ }

  // ── 3. Canvas noise ────────────────────────────────────────────────────
  // Adds a deterministic but unique per-session noise value to every pixel
  // written to a canvas. The noise is too small to be visible but makes the
  // canvas hash unique, defeating cross-session canvas fingerprinting.
  const CANVAS_NOISE = ${canvasNoise};

  const _toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function toDataURL(
    type?: string,
    quality?: unknown
  ): string {
    const ctx = this.getContext('2d');
    if (ctx) {
      const imageData = ctx.getImageData(0, 0, this.width || 1, this.height || 1);
      for (let i = 0; i < imageData.data.length; i += 4) {
        // Apply noise only to the alpha-visible pixels to avoid blank-canvas
        // detection (a canvas that is all-transparent stays all-transparent).
        if (imageData.data[i + 3] > 0) {
          imageData.data[i]     = Math.min(255, imageData.data[i]     + Math.floor(CANVAS_NOISE * 2));
          imageData.data[i + 1] = Math.min(255, imageData.data[i + 1] + Math.floor(CANVAS_NOISE * 1));
          imageData.data[i + 2] = Math.min(255, imageData.data[i + 2] + Math.floor(CANVAS_NOISE * 3));
        }
      }
      ctx.putImageData(imageData, 0, 0);
    }
    return _toDataURL.call(this, type, quality);
  };

  const _getImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function getImageData(
    sx: number, sy: number, sw: number, sh: number
  ): ImageData {
    const imageData = _getImageData.call(this, sx, sy, sw, sh);
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i + 3] > 0) {
        imageData.data[i]     = Math.min(255, imageData.data[i]     + Math.floor(CANVAS_NOISE * 2));
        imageData.data[i + 1] = Math.min(255, imageData.data[i + 1] + Math.floor(CANVAS_NOISE * 1));
        imageData.data[i + 2] = Math.min(255, imageData.data[i + 2] + Math.floor(CANVAS_NOISE * 3));
      }
    }
    return imageData;
  };

  // ── 4. WebGL renderer / vendor override ───────────────────────────────
  // Facebook and bot-detection libraries call getParameter(RENDERER) and
  // getParameter(VENDOR) to fingerprint the GPU. We return the per-session
  // values from the fingerprint pool.
  const WEBGL_RENDERER = ${JSON.stringify(renderer)};
  const WEBGL_VENDOR   = ${JSON.stringify(vendor)};

  // WebGL constants for the parameters we intercept.
  const GL_RENDERER = 0x1F01;
  const GL_VENDOR   = 0x1F00;

  const _getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function getParameter(
    parameter: number
  ): unknown {
    if (parameter === GL_RENDERER) return WEBGL_RENDERER;
    if (parameter === GL_VENDOR)   return WEBGL_VENDOR;
    return _getParameter.call(this, parameter);
  };

  // Also patch WebGL2 if available.
  if (typeof WebGL2RenderingContext !== 'undefined') {
    const _getParameter2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function getParameter(
      parameter: number
    ): unknown {
      if (parameter === GL_RENDERER) return WEBGL_RENDERER;
      if (parameter === GL_VENDOR)   return WEBGL_VENDOR;
      return _getParameter2.call(this, parameter);
    };
  }

  // ── 5. AudioContext getChannelData noise ───────────────────────────────
  // AudioContext fingerprinting works by rendering a short audio buffer and
  // hashing the output. Adding a tiny per-session offset to every sample
  // makes the hash unique without audible distortion.
  const AUDIO_NOISE = ${audioNoise};

  const _getChannelData = AudioBuffer.prototype.getChannelData;
  AudioBuffer.prototype.getChannelData = function getChannelData(
    channel: number
  ): Float32Array {
    const data = _getChannelData.call(this, channel);
    for (let i = 0; i < data.length; i++) {
      data[i] += AUDIO_NOISE;
    }
    return data;
  };
})();
`;

  await page.addInitScript(script);
}

// ─────────────────────────────────────────────
// BROWSER LAUNCH
// ─────────────────────────────────────────────

/**
 * Launches a stealth browser instance for a session.
 * Uses CloakBrowser for C++ level fingerprint patches.
 * Each session gets its own isolated profile directory and fingerprint seed.
 *
 * @param options - Launch configuration including sessionId, proxy, and settings.
 * @returns A StealthBrowserInstance with browser, context, page, and fingerprint.
 * @throws If CloakBrowser fails to launch.
 *
 * @example
 * const instance = await stealthBrowser.launch({
 *   sessionId: 'abc-123',
 *   proxy: { host: '1.2.3.4', port: 8080, protocol: 'http', ... },
 *   settings: appSettings,
 *   headless: true,
 * })
 */
async function launch(options: LaunchOptions): Promise<StealthBrowserInstance> {
  const { sessionId, proxy, settings, headless = false } = options;

  // Ensure isolated profile directory exists
  const userDataDir = path.join(USER_DATA_BASE, sessionId);
  fs.mkdirSync(userDataDir, { recursive: true });

  // Load or generate per-session fingerprint
  const fingerprint = loadOrCreateFingerprint(userDataDir);

  // Get timezone/locale from session country (via proxy country)
  const { timezoneId, locale } = getTimezoneLocale(
    proxy?.country ?? 'US'
  );

  // Build proxy string for CloakBrowser
  const proxyString = proxy
    ? buildProxyString(proxy)
    : undefined;

  // Extract fingerprint seed from stored data
  const fingerprintSeed = Math.round(
    fingerprint.canvasNoiseSeed * FINGERPRINT_SEED_MAX
  );

  // Screen size must match the fingerprint — inconsistency is a bot signal.
  // Use 1280x720 as the viewport — common laptop resolution, not suspicious.
  // The fingerprint seed picks a matching screen size from the pool.
  const VIEWPORT_WIDTH = 1280;
  const VIEWPORT_HEIGHT = 720;

  // Dynamic import — CloakBrowser is ESM, our project is CJS
  const { launchPersistentContext } = await import('cloakbrowser');

  console.log(`[stealth-browser] Launching with userDataDir: ${userDataDir}`);
  console.log(`[stealth-browser] Viewport: ${VIEWPORT_WIDTH}x${VIEWPORT_HEIGHT}, fingerprint seed: ${fingerprintSeed}`);

  let context;
  try {
    // Cast to unknown first to allow CloakBrowser-specific options (e.g. screen, humanize)
    // that are not present in the base Playwright LaunchPersistentContextOptions type.
    const launchOptions = {
      userDataDir,
      headless,
      proxy: proxyString,
      timezone: timezoneId,
      locale,
      humanize: true,
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      screen: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      args: [
        `--fingerprint=${fingerprintSeed}`,
        `--fingerprint-platform=windows`,
        `--window-size=${VIEWPORT_WIDTH},${VIEWPORT_HEIGHT}`,
        `--force-device-scale-factor=1`,
        ...(proxyString ? ['--fingerprint-webrtc-ip=auto'] : []),
        `--js-flags=--max-old-space-size=${settings?.memoryCapMb ?? 512}`,
      ],
    };
    context = await launchPersistentContext(launchOptions as Parameters<typeof launchPersistentContext>[0]);
  } catch (launchErr: unknown) {
    const msg = launchErr instanceof Error ? launchErr.message : String(launchErr);
    console.error(`[stealth-browser] launchPersistentContext FAILED: ${msg}`);
    throw launchErr;
  }

  // Get the first page or create one
  const pages = context!.pages();
  const page = pages.length > 0 ? pages[0] : await context!.newPage();

  // Set viewport explicitly on the page — ensures consistency
  await page.setViewportSize({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });

  // Apply CDP timezone and locale overrides at the protocol level.
  // CloakBrowser already receives timezone/locale via launchPersistentContext options,
  // but applying them via CDP as well ensures they are enforced even if CloakBrowser's
  // native handling is bypassed by a page-level JS probe.
  // Wrapped in try/catch because CloakBrowser may reject the CDP command if it
  // already owns the override — that is fine, the native setting still applies.
  try {
    const cdpSession = await context!.newCDPSession(page);
    await cdpSession.send('Emulation.setTimezoneOverride', { timezoneId });
    await cdpSession.send('Emulation.setLocaleOverride', { locale });
    console.log(`[stealth-browser] CDP timezone/locale applied: ${timezoneId} / ${locale}`);
  } catch (cdpErr: unknown) {
    // Non-fatal — CloakBrowser may own the override natively.
    const cdpMsg = cdpErr instanceof Error ? cdpErr.message : String(cdpErr);
    console.warn(`[stealth-browser] CDP timezone/locale override skipped (CloakBrowser owns it): ${cdpMsg}`);
  }

  // Inject all CDP fingerprint overrides before any page navigation.
  // This must run after the page exists but before any navigation so that
  // addScriptToEvaluateOnNewDocument fires on the very first load.
  await injectStealthScript(page, fingerprint);

  // Access the underlying Browser object from the context.
  // CloakBrowser's launchPersistentContext returns a BrowserContext directly.
  // context.browser() may return null in some CloakBrowser versions — we create
  // a compatible stub so the rest of the codebase can call browser.process() safely.
  const rawBrowser = context!.browser();
  const browser: Browser = rawBrowser ?? ({
    process: () => null,
    close: async () => { await context!.close(); },
    isConnected: () => true,
    contexts: () => [context!],
    newContext: async () => { throw new Error('Not supported on stub browser'); },
    newPage: async () => context!.newPage(),
    version: () => 'cloakbrowser',
    on: () => {},
    off: () => {},
    once: () => {},
    emit: () => false,
    removeListener: () => {},
    removeAllListeners: () => {},
    listenerCount: () => 0,
    listeners: () => [],
    rawListeners: () => [],
    addListener: () => {},
    prependListener: () => {},
    prependOnceListener: () => {},
    eventNames: () => [],
    getMaxListeners: () => 0,
    setMaxListeners: () => {},
  } as unknown as Browser);

  return { browser, context: context!, page, userDataDir, fingerprint };
}

/**
 * Closes a stealth browser instance cleanly.
 * Closes page → context → browser in order.
 *
 * @param instance - The StealthBrowserInstance to close.
 */
async function close(instance: StealthBrowserInstance): Promise<void> {
  try {
    if (!instance.page.isClosed()) {
      await instance.page.close();
    }
    await instance.context.close();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[stealth-browser] Error closing browser: ${message}`);
  }
}

// ─────────────────────────────────────────────
// COOKIE INJECTION
// ─────────────────────────────────────────────

/**
 * Injects a Facebook cookie string into a browser context.
 * Must be called before navigating to any Facebook URL.
 *
 * Supports both JSON array format and raw cookie string format.
 *
 * @param context    - The Playwright BrowserContext to inject cookies into.
 * @param cookieStr  - The raw cookie string from the session record.
 *
 * @example
 * await stealthBrowser.injectCookies(instance.context, session.cookie)
 */
async function injectCookies(context: BrowserContext, cookieStr: string): Promise<void> {
  if (!cookieStr || cookieStr.trim().length === 0) {
    throw new Error('Cookie string is empty — cannot inject');
  }

  let cookies: Array<{ name: string; value: string; domain: string; path: string }>;

  // Try parsing as JSON array first
  if (cookieStr.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(cookieStr);
      cookies = parsed.map((c: Record<string, unknown>) => ({
        name: String(c['name'] ?? c['key'] ?? ''),
        value: String(c['value'] ?? ''),
        domain: String(c['domain'] ?? '.facebook.com'),
        path: String(c['path'] ?? '/'),
      }));
    } catch {
      throw new Error('Cookie string looks like JSON but failed to parse');
    }
  } else {
    // Parse as raw "key=value; key2=value2" format
    cookies = cookieStr.split(';').map((pair) => {
      const [name, ...rest] = pair.trim().split('=');
      return {
        name: name.trim(),
        value: rest.join('=').trim(),
        domain: '.facebook.com',
        path: '/',
      };
    }).filter((c) => c.name.length > 0);
  }

  await context.addCookies(
    cookies.map((c) => ({
      ...c,
      secure: true,
      httpOnly: false,
      sameSite: 'None' as const,
    }))
  );
}

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────

/**
 * Checks the health of a Facebook session by navigating to facebook.com
 * and inspecting the resulting URL and page content.
 *
 * @param page - The Playwright Page to use for the health check.
 * @returns Health status and a human-readable message.
 *
 * @example
 * const health = await stealthBrowser.checkHealth(instance.page)
 * // → { status: 'live', message: 'Session healthy' }
 */
async function checkHealth(
  page: Page
): Promise<{ status: HealthStatus; message: string }> {
  try {
    await page.goto('https://www.facebook.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    });

    // Wait a moment for JS to render
    await new Promise(r => setTimeout(r, 2000));

    const url = page.url();
    const pageText = await page.textContent('body').catch(() => '');

    // ── Dead: explicit login redirect ─────────────────────────────────
    if (url.includes('/login') || url.includes('login.php')) {
      return { status: 'dead', message: 'Session expired — redirected to login' };
    }

    // ── Dead: password input visible (cookie expired, FB shows profile icon + password prompt) ──
    // This is the key signal: cookie is dead when FB asks for password on facebook.com
    const passwordInput = await page.$('#pass, input[type="password"], input[name="pass"]').catch(() => null);
    const emailInput = await page.$('#email, input[name="email"], input[type="email"]').catch(() => null);
    if (passwordInput || emailInput) {
      return { status: 'dead', message: 'Session expired — password prompt detected' };
    }

    // ── Banned: account permanently disabled ──────────────────────────
    if (
      url.includes('disabled') ||
      url.includes('accountdisabled') ||
      pageText?.includes('Your account has been disabled') ||
      pageText?.includes('permanently disabled') ||
      pageText?.includes('We suspended your account')
    ) {
      return { status: 'banned', message: 'Account permanently disabled' };
    }

    // ── Checkpoint: security verification required ─────────────────────
    if (
      url.includes('checkpoint') ||
      url.includes('identity/') ||
      pageText?.includes('Please confirm your identity') ||
      pageText?.includes('Confirm Your Identity') ||
      pageText?.includes('We need to verify your account') ||
      pageText?.includes('confirm your identity')
    ) {
      return { status: 'checkpoint', message: 'Security checkpoint — identity verification required' };
    }

    // ── 2FA / WhatsApp verify required ────────────────────────────────
    if (
      url.includes('two_step') ||
      url.includes('approvals') ||
      pageText?.includes('Enter the code') ||
      pageText?.includes('Two-Factor Authentication') ||
      pageText?.includes('Enter Login Code') ||
      pageText?.includes('Verify your identity') ||
      pageText?.includes('verify via WhatsApp') ||
      pageText?.includes('WhatsApp') && pageText?.includes('verify') ||
      (pageText?.includes('Check your') && pageText?.includes('authentication app'))
    ) {
      return { status: '2fa_required', message: '2FA/WhatsApp verification required' };
    }

    // ── Restricted: partial action block ──────────────────────────────
    const restrictionBanner = await page.$('[data-testid="restriction_banner"]').catch(() => null);
    if (
      restrictionBanner ||
      pageText?.includes('Your account is restricted') ||
      pageText?.includes('temporarily restricted') ||
      pageText?.includes("You can't use this feature right now")
    ) {
      return { status: 'restricted', message: 'Account action restriction detected' };
    }

    // ── Live: confirmed logged in — feed or nav visible ───────────────
    const homeFeed = await page.$('[role="feed"], [data-pagelet="FeedUnit_0"]').catch(() => null);
    if (homeFeed) {
      const isNewAccount = pageText?.includes('Complete your profile') ||
        (pageText?.includes('Find friends') && pageText?.includes('Get started'));
      if (isNewAccount) {
        return { status: 'warming', message: 'New account — needs warm-up before automation' };
      }
      return { status: 'live', message: 'Session healthy' };
    }

    // ── Live fallback: logged-in navigation present ───────────────────
    const loggedInNav = await page.$('[aria-label="Facebook"][role="navigation"], [data-testid="nav-bar"]').catch(() => null);
    if (loggedInNav && url.includes('facebook.com') && !url.includes('login')) {
      return { status: 'live', message: 'Session appears healthy' };
    }

    // ── Dead fallback: on facebook.com but no logged-in indicators ────
    if (url.includes('facebook.com')) {
      return { status: 'dead', message: 'No feed or navigation found — session likely expired' };
    }

    return { status: 'dead', message: `Unexpected URL: ${url}` };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('net::ERR_') || message.includes('ECONNREFUSED')) {
      return { status: 'dead', message: `Network error — possible proxy issue: ${message}` };
    }

    return { status: 'dead', message };
  }
}

// ─────────────────────────────────────────────
// HUMAN INTERACTION HELPERS
// ─────────────────────────────────────────────

/**
 * Waits for a random duration between min and max milliseconds.
 * Used between automation actions to simulate human timing.
 *
 * @param minMs - Minimum wait time in milliseconds.
 * @param maxMs - Maximum wait time in milliseconds.
 *
 * @example
 * await stealthBrowser.randomDelay(2000, 8000) // waits 2–8 seconds
 */
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

// ─────────────────────────────────────────────
// HUMAN CLICK
// ─────────────────────────────────────────────

/** Minimum coordinate jitter applied to click target (pixels). */
const CLICK_JITTER_PX = 3;

/** Minimum pre-click pause in milliseconds. */
const PRE_CLICK_PAUSE_MIN_MS = 80;

/** Maximum pre-click pause in milliseconds. */
const PRE_CLICK_PAUSE_MAX_MS = 300;

/**
 * Performs a human-like click on a page element.
 *
 * Adds ±3px random jitter to the element's center coordinates so the click
 * never lands on the exact geometric center — a pattern that bot-detection
 * systems flag. Waits 80–300ms before clicking to simulate human reaction time.
 *
 * CloakBrowser's `humanize:true` already handles Bezier mouse curves at the
 * C++ level. This function adds the JS-level coordinate jitter and pre-click
 * pause on top of that.
 *
 * @param page     - The Playwright Page containing the element.
 * @param selector - CSS selector identifying the element to click.
 * @throws If the element is not found or has no bounding box.
 *
 * @example
 * await stealthBrowser.humanClick(page, '[data-testid="post-button"]')
 */
async function humanClick(page: Page, selector: string): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`humanClick: element not found or not visible — selector: ${selector}`);
  }

  // Compute element center then apply ±CLICK_JITTER_PX random offset.
  // Math.random() * 2 - 1 gives a value in [-1, 1]; multiply by jitter range.
  const jitterX = (Math.random() * 2 - 1) * CLICK_JITTER_PX;
  const jitterY = (Math.random() * 2 - 1) * CLICK_JITTER_PX;

  const targetX = box.x + box.width  / 2 + jitterX;
  const targetY = box.y + box.height / 2 + jitterY;

  // Move mouse to the jittered position first — CloakBrowser will trace a
  // Bezier curve from the current position to this target.
  await page.mouse.move(targetX, targetY);

  // Human reaction pause before the actual click.
  await randomDelay(PRE_CLICK_PAUSE_MIN_MS, PRE_CLICK_PAUSE_MAX_MS);

  await page.mouse.click(targetX, targetY);
}

// ─────────────────────────────────────────────
// HUMAN TYPE
// ─────────────────────────────────────────────

/** Minimum per-character typing delay in milliseconds. */
const HUMAN_TYPE_CHAR_MIN_MS = 50;

/** Maximum per-character typing delay in milliseconds. */
const HUMAN_TYPE_CHAR_MAX_MS = 200;

/** Minimum hesitation pause inserted between character bursts (milliseconds). */
const HUMAN_TYPE_HESITATION_MIN_MS = 500;

/** Maximum hesitation pause inserted between character bursts (milliseconds). */
const HUMAN_TYPE_HESITATION_MAX_MS = 1_500;

/**
 * Minimum number of characters typed before a hesitation pause may occur.
 * Hesitation is triggered randomly in the range [MIN, MAX] chars.
 */
const HUMAN_TYPE_HESITATION_BURST_MIN = 5;

/** Maximum burst length before a hesitation pause may occur. */
const HUMAN_TYPE_HESITATION_BURST_MAX = 10;

/**
 * Types text into a page element with human-like timing.
 *
 * Focuses the element first, then types each character individually with a
 * 50–200ms delay. Roughly every 5–10 characters a 500–1500ms hesitation pause
 * is inserted to simulate a human pausing to think.
 *
 * @param page     - The Playwright Page containing the element.
 * @param selector - CSS selector identifying the input element.
 * @param text     - The text string to type.
 *
 * @example
 * await stealthBrowser.humanType(page, '#search-input', 'Hello world')
 */
async function humanType(page: Page, selector: string, text: string): Promise<void> {
  await page.locator(selector).focus();

  // Determine the burst length for the first hesitation window.
  let nextHesitationAt = HUMAN_TYPE_HESITATION_BURST_MIN
    + Math.floor(Math.random() * (HUMAN_TYPE_HESITATION_BURST_MAX - HUMAN_TYPE_HESITATION_BURST_MIN + 1));

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Type the character with a per-character random delay.
    const charDelay = HUMAN_TYPE_CHAR_MIN_MS
      + Math.random() * (HUMAN_TYPE_CHAR_MAX_MS - HUMAN_TYPE_CHAR_MIN_MS);

    await page.keyboard.type(char, { delay: charDelay });

    // Insert a hesitation pause after the burst threshold is reached.
    if (i + 1 >= nextHesitationAt && i < text.length - 1) {
      await randomDelay(HUMAN_TYPE_HESITATION_MIN_MS, HUMAN_TYPE_HESITATION_MAX_MS);

      // Schedule the next hesitation window.
      nextHesitationAt = i + 1 + HUMAN_TYPE_HESITATION_BURST_MIN
        + Math.floor(Math.random() * (HUMAN_TYPE_HESITATION_BURST_MAX - HUMAN_TYPE_HESITATION_BURST_MIN + 1));
    }
  }
}

// ─────────────────────────────────────────────
// HUMAN SCROLL
// ─────────────────────────────────────────────

/** Minimum pixels per scroll increment step. */
const SCROLL_INCREMENT_MIN_PX = 10;

/** Maximum pixels per scroll increment step. */
const SCROLL_INCREMENT_MAX_PX = 30;

/** Minimum delay between scroll steps in milliseconds. */
const SCROLL_STEP_DELAY_MIN_MS = 20;

/** Maximum delay between scroll steps in milliseconds. */
const SCROLL_STEP_DELAY_MAX_MS = 80;

/**
 * Scrolls the page by `deltaY` pixels using smooth, variable-speed increments.
 *
 * The scroll is broken into small steps (10–30px each). A sin curve modulates
 * the step size so the scroll starts slow, accelerates through the middle, and
 * decelerates at the end — matching natural human scroll momentum. A 20–80ms
 * delay is inserted between each step.
 *
 * @param page   - The Playwright Page to scroll.
 * @param deltaY - Total vertical scroll distance in pixels. Positive = down.
 *
 * @example
 * await stealthBrowser.humanScroll(page, 600)   // scroll down 600px
 * await stealthBrowser.humanScroll(page, -300)  // scroll up 300px
 */
async function humanScroll(page: Page, deltaY: number): Promise<void> {
  if (deltaY === 0) return;

  const direction = deltaY > 0 ? 1 : -1;
  const totalDistance = Math.abs(deltaY);

  // Build an array of step sizes using a sin curve for velocity modulation.
  // sin(0..π) produces values in [0, 1] that peak at π/2 (the midpoint).
  // We use this to scale each step between the min and max increment sizes.
  const steps: number[] = [];
  let accumulated = 0;

  // Estimate the number of steps needed at the average increment size.
  const avgIncrement = (SCROLL_INCREMENT_MIN_PX + SCROLL_INCREMENT_MAX_PX) / 2;
  const estimatedStepCount = Math.max(1, Math.round(totalDistance / avgIncrement));

  for (let i = 0; i < estimatedStepCount; i++) {
    // Progress through the scroll: 0 at start, 1 at end.
    const progress = i / Math.max(1, estimatedStepCount - 1);

    // sin(progress * π) peaks at 0.5 progress — slow start, fast middle, slow end.
    const velocityFactor = Math.sin(progress * Math.PI);

    const stepSize = SCROLL_INCREMENT_MIN_PX
      + velocityFactor * (SCROLL_INCREMENT_MAX_PX - SCROLL_INCREMENT_MIN_PX);

    const remaining = totalDistance - accumulated;
    const actualStep = Math.min(stepSize, remaining);

    if (actualStep <= 0) break;

    steps.push(actualStep);
    accumulated += actualStep;

    if (accumulated >= totalDistance) break;
  }

  // If the sin-curve steps didn't cover the full distance, add a final step.
  if (accumulated < totalDistance) {
    steps.push(totalDistance - accumulated);
  }

  // Execute each scroll step with a random inter-step delay.
  for (const step of steps) {
    await page.mouse.wheel(0, direction * step);
    await randomDelay(SCROLL_STEP_DELAY_MIN_MS, SCROLL_STEP_DELAY_MAX_MS);
  }
}

// ─────────────────────────────────────────────
// PROXY STRING BUILDER
// ─────────────────────────────────────────────

/**
 * Builds a proxy URL string from a Proxy record.
 * CloakBrowser accepts: "http://user:pass@host:port" or "socks5://..."
 *
 * @param proxy - The Proxy record from the database.
 * @returns A formatted proxy URL string.
 */
function buildProxyString(proxy: Proxy): string {
  const auth = proxy.username && proxy.password
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
    : '';
  return `${proxy.protocol}://${auth}${proxy.host}:${proxy.port}`;
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The stealth browser module for launching isolated Facebook sessions.
 * Uses CloakBrowser for C++ level anti-detection.
 *
 * @example
 * import { stealthBrowser } from '../automation/stealth-browser'
 *
 * const instance = await stealthBrowser.launch({ sessionId, proxy, settings })
 * await stealthBrowser.injectCookies(instance.context, session.cookie)
 * const health = await stealthBrowser.checkHealth(instance.page)
 * await stealthBrowser.close(instance)
 *
 * // CDP fingerprint injection is called automatically inside launch().
 * // Call it manually only when attaching to an existing page (e.g. after wake).
 * await stealthBrowser.injectStealthScript(page, fingerprint)
 */
export const stealthBrowser = {
  /** Launches a new isolated stealth browser instance. */
  launch,
  /** Closes a browser instance cleanly. */
  close,
  /** Injects Facebook cookies into a browser context. */
  injectCookies,
  /** Checks the health status of a Facebook session. */
  checkHealth,
  /** Waits for a random delay between min and max ms. */
  randomDelay,
  /** Loads or creates a per-session fingerprint. */
  loadOrCreateFingerprint,
  /** Generates a new random fingerprint. */
  generateFingerprint,
  /** Returns timezone/locale for a country code. */
  getTimezoneLocale,
  /** Injects all CDP stealth overrides into a page using the given fingerprint. */
  injectStealthScript,
  /**
   * Clicks an element with ±3px coordinate jitter and an 80–300ms pre-click pause.
   * CloakBrowser handles Bezier mouse curves at C++ level; this adds JS-level humanisation.
   */
  humanClick,
  /**
   * Types text character-by-character with 50–200ms per-char delay and
   * 500–1500ms hesitation pauses roughly every 5–10 characters.
   */
  humanType,
  /**
   * Scrolls the page by deltaY pixels using sin-curve velocity modulation
   * (slow start, fast middle, slow end) with 20–80ms delays between steps.
   */
  humanScroll,
};
