import { chromium, Browser, BrowserContext, Page, CDPSession } from 'playwright';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { Proxy, AppSettings, FingerprintData } from '../types';

interface StealthBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
}

// ─────────────────────────────────────────────
// FINGERPRINT POOLS
// Realistic values sampled from real Windows Chrome installs.
// Keeping pools small-but-varied avoids both uniqueness and obvious repetition.
// ─────────────────────────────────────────────

/** 10 realistic ANGLE renderer strings covering common NVIDIA, AMD, and Intel GPUs. */
export const WEBGL_RENDERER_POOL: readonly string[] = [
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Super Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (AMD, AMD Radeon RX 6600 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (AMD, AMD Radeon RX 6700 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
  'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
] as const;

/** 8 Chrome 120-124 Windows user-agent strings covering common minor versions. */
export const USER_AGENT_POOL: readonly string[] = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.130 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.160 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.122 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
] as const;

/** Realistic screen resolutions used by Windows desktop users. */
const SCREEN_RESOLUTIONS: readonly { width: number; height: number }[] = [
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
] as const;

/** WebGL vendor strings that pair with the WEBGL_RENDERER_POOL entries. */
const WEBGL_VENDOR_POOL: readonly string[] = [
  'Google Inc. (NVIDIA)',
  'Google Inc. (AMD)',
  'Google Inc. (Intel)',
] as const;

// ─────────────────────────────────────────────
// FINGERPRINT GENERATION
// ─────────────────────────────────────────────

/**
 * Generates a fresh randomised browser fingerprint for a session.
 *
 * Uses `crypto.randomBytes()` for the noise seeds so values are
 * cryptographically random and not predictable from `Math.random()`.
 * Renderer, vendor, user-agent, and screen resolution are picked from
 * curated pools of realistic values.
 *
 * @returns A fully populated `FingerprintData` object ready to persist.
 *
 * @example
 * const fp = generateFingerprint();
 * // fp.canvasNoiseSeed → e.g. 0.7341...
 * // fp.userAgent      → e.g. "Mozilla/5.0 (Windows NT 10.0; Win64; x64)..."
 */
export function generateFingerprint(): FingerprintData {
  // 4 random bytes → 32-bit unsigned int → normalise to [0, 1)
  const canvasNoiseSeed = crypto.randomBytes(4).readUInt32BE(0) / 0xffffffff;
  const audioContextNoise = crypto.randomBytes(4).readUInt32BE(0) / 0xffffffff;

  // Pick random entries from each pool using a single random byte (pools are ≤256 entries)
  const rendererIndex = crypto.randomBytes(1)[0] % WEBGL_RENDERER_POOL.length;
  const webglRenderer = WEBGL_RENDERER_POOL[rendererIndex];

  // Derive vendor from renderer prefix so they stay consistent
  let webglVendor = WEBGL_VENDOR_POOL[2]; // default: Intel
  if (webglRenderer.includes('NVIDIA')) webglVendor = WEBGL_VENDOR_POOL[0];
  else if (webglRenderer.includes('AMD')) webglVendor = WEBGL_VENDOR_POOL[1];

  const uaIndex = crypto.randomBytes(1)[0] % USER_AGENT_POOL.length;
  const userAgent = USER_AGENT_POOL[uaIndex];

  const resIndex = crypto.randomBytes(1)[0] % SCREEN_RESOLUTIONS.length;
  const { width: screenWidth, height: screenHeight } = SCREEN_RESOLUTIONS[resIndex];

  return {
    canvasNoiseSeed,
    webglRenderer,
    webglVendor,
    audioContextNoise,
    userAgent,
    screenWidth,
    screenHeight,
  };
}

/**
 * Loads an existing fingerprint from `{userDataDir}/fingerprint.json` or
 * creates and persists a new one if the file does not exist.
 *
 * Persisting the fingerprint ensures the same session always presents the
 * same Canvas/WebGL/AudioContext values across browser restarts, which is
 * critical for avoiding fingerprint-change detection by Facebook.
 *
 * @param userDataDir - Absolute path to the session's isolated browser profile directory.
 * @returns The loaded or newly generated `FingerprintData`.
 *
 * @example
 * const fp = loadOrCreateFingerprint('/app/user-data/abc-123');
 * // Reads from /app/user-data/abc-123/fingerprint.json if it exists,
 * // otherwise generates a new fingerprint and writes it there.
 */
export function loadOrCreateFingerprint(userDataDir: string): FingerprintData {
  const fingerprintPath = path.join(userDataDir, 'fingerprint.json');

  if (fs.existsSync(fingerprintPath)) {
    const raw = fs.readFileSync(fingerprintPath, 'utf-8');
    return JSON.parse(raw) as FingerprintData;
  }

  const fingerprint = generateFingerprint();

  // Ensure the profile directory exists before writing
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(fingerprintPath, JSON.stringify(fingerprint, null, 2), 'utf-8');

  return fingerprint;
}

const DEFAULT_STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-dev-shm-usage',
  '--disable-setuid-sandbox',
  '--no-sandbox',
  '--disable-web-security',
  '--disable-features=IsolateOrigins,site-per-process',
  '--allow-running-insecure-content',
  '--disable-gpu',
  '--no-zygote',
];

const injectStealthScript = (page: Page): void => {
  page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    (window as any).chrome = { runtime: {} };
    
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters: any) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission } as PermissionStatus)
        : originalQuery(parameters);
  });
};

const patchCDP = async (cdp: CDPSession): Promise<void> => {
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  
  await cdp.send('Runtime.addBinding', { name: 'captureKeystroke' });
  
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
  await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' });
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  });
};

const blockWebRTC = async (page: Page): Promise<void> => {
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.url().includes('webrtc') || request.url().includes('stun:')) {
      route.abort();
    } else {
      route.continue();
    }
  });
  
  await page.addInitScript(() => {
    (window as any).RTCPeerConnection = class RTCPeerConnection {
      constructor() {}
      createOffer() { return Promise.resolve({ type: 'offer', sdp: '' }); }
      setLocalDescription() { return Promise.resolve(); }
      close() {}
    };
  });
};

const bezierMouseMove = async (page: Page, targetX: number, targetY: number): Promise<void> => {
  const pageBoundingBox = await page.evaluate(() => {
    const el = document.documentElement;
    return { width: el.clientWidth, height: el.clientHeight };
  });
  
  const startX = Math.random() * pageBoundingBox.width;
  const startY = Math.random() * pageBoundingBox.height;
  
  const controlPoints = [
    { x: startX + (targetX - startX) * 0.33 + (Math.random() - 0.5) * 100, y: startY + (targetY - startY) * 0.33 + (Math.random() - 0.5) * 100 },
    { x: startX + (targetX - startX) * 0.66 + (Math.random() - 0.5) * 100, y: startY + (targetY - startY) * 0.66 + (Math.random() - 0.5) * 100 },
  ];
  
  const steps = 20 + Math.floor(Math.random() * 15);
  
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.pow(1-t, 3) * startX + 3 * Math.pow(1-t, 2) * t * controlPoints[0].x + 3 * (1-t) * Math.pow(t, 2) * controlPoints[1].x + Math.pow(t, 3) * targetX;
    const y = Math.pow(1-t, 3) * startY + 3 * Math.pow(1-t, 2) * t * controlPoints[0].y + 3 * (1-t) * Math.pow(t, 2) * controlPoints[1].y + Math.pow(t, 3) * targetY;
    
    await page.mouse.move(x, y);
    await page.waitForTimeout(10 + Math.random() * 20);
  }
};

const humanLikeClick = async (page: Page, selector: string): Promise<void> => {
  const element = await page.$(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);
  
  const box = await element.boundingBox();
  if (!box) throw new Error(`Element not visible: ${selector}`);
  
  const targetX = box.x + box.width / 2;
  const targetY = box.y + box.height / 2;
  
  await bezierMouseMove(page, targetX, targetY);
  await page.waitForTimeout(100 + Math.random() * 200);
  await page.mouse.down();
  await page.waitForTimeout(50 + Math.random() * 100);
  await page.mouse.up();
};

const randomDelay = (minMs: number, maxMs: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
};

const launchStealthBrowser = async (
  proxy?: Proxy,
  settings?: AppSettings,
  userDataDir?: string
): Promise<StealthBrowser> => {
  const args = [...DEFAULT_STEALTH_ARGS];
  
  if (settings?.webRTCBlocked) {
    args.push('--disable-extensions');
    args.push('--disable-features=WebRTC');
  }
  
  const launchOptions: any = {
    headless: false,
    args,
    ignoreDefaultArgs: ['--enable-automation'],
  };
  
  if (proxy) {
    launchOptions.proxy = {
      server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
      username: proxy.username,
      password: proxy.password,
    };
  }
  
  if (userDataDir) {
    launchOptions.userDataDir = userDataDir;
  }
  
  const browser = await chromium.launch(launchOptions);
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    locale: 'en-US',
    timezoneId: 'America/New_York',
    permissions: ['notifications'],
  });
  
  const page = await context.newPage();
  
  injectStealthScript(page);
  
  if (settings?.webRTCBlocked) {
    await blockWebRTC(page);
  }
  
  const cdp = await page.context().newCDPSession(page);
  await patchCDP(cdp);
  
  return { browser, context, page, cdp };
};

const closeStealthBrowser = async (sb: StealthBrowser): Promise<void> => {
  try {
    await sb.page.close();
    await sb.context.close();
    await sb.browser.close();
  } catch (e) {
    console.error('Error closing browser:', e);
  }
};

const checkFacebookHealth = async (sb: StealthBrowser): Promise<{ status: 'live' | 'checkpoint' | 'restricted' | 'dead'; message: string }> => {
  try {
    await sb.page.goto('https://www.facebook.com/', { waitUntil: 'networkidle', timeout: 15000 });
    
    const currentUrl = sb.page.url();
    
    if (currentUrl.includes('checkpoint')) {
      return { status: 'checkpoint', message: 'Checkpoint detected' };
    }
    if (currentUrl.includes('login')) {
      return { status: 'dead', message: 'Session expired - login required' };
    }
    
    const restrictedElement = await sb.page.$('[data-testid="royal_login_form"]');
    if (restrictedElement) {
      const text = await restrictedElement.textContent();
      if (text?.includes('restricted')) {
        return { status: 'restricted', message: 'Account restricted' };
      }
    }
    
    return { status: 'live', message: 'Session healthy' };
  } catch (e: any) {
    if (e.message?.includes('net::ERR_')) {
      return { status: 'dead', message: 'Network error - possible proxy issue' };
    }
    return { status: 'dead', message: e.message };
  }
};

export const stealthBrowser = {
  launch: launchStealthBrowser,
  close: closeStealthBrowser,
  checkHealth: checkFacebookHealth,
  humanClick: humanLikeClick,
  mouseMove: bezierMouseMove,
  randomDelay,
  injectStealthScript,
  generateFingerprint,
  loadOrCreateFingerprint,
};
