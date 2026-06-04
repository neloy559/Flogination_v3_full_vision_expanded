/**
 * Flogination V5 — Express API Server
 *
 * Entry point for the backend API server.
 * Runs on port 3001 (configurable via PORT env var).
 *
 * All business logic lives in dedicated modules.
 * This file only wires routes to those modules.
 *
 * On startup:
 *  1. Database migrations run (WAL mode, new tables/columns).
 *  2. Auto-scraper queue starts (picks up pending sessions).
 *  3. MongoDB connects if configured.
 *  4. Agent Bridge starts if enabled in settings.
 *  5. Express listens on PORT.
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import multer from 'multer';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import axios from 'axios';

import { db_ } from './database';
import { v4 as uuidv4 } from 'uuid';
import { sessionManager } from './automation/session-manager';
import { autoScraper } from './automation/auto-scraper';
import { importParser } from './utils/import-parser';
import { mongoClient } from './utils/mongo-client';
import { webhookService } from './utils/webhook-service';
import { proxyMonitor } from './automation/proxy-monitor';
import { inboxManager } from './inbox/inbox-manager';
import { contactManager } from './inbox/contact-manager';
import { warmupEngine } from './inbox/warmup-engine';
import { browserRecorder } from './tools/browser-recorder';
import { campaignEngine } from './campaigns/campaign-engine';
import { pageFactory } from './tools/page-factory';
import { bmFactory } from './tools/bm-factory';
import { groupHunter } from './tools/group-hunter';
import { commentEngine } from './tools/comment-engine';
import type { WorkflowStep } from '../types';
import os from 'os';
import fs from 'fs';

dotenv.config();

// ─────────────────────────────────────────────
// APP SETUP
// ─────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT ?? 3001;

// Multer for file uploads (bulk import)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Rate Limiting ─────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS   = 60_000;
const GENERAL_RATE_LIMIT_MAX = 300;
const STRICT_RATE_LIMIT_MAX  = 10;

const generalLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: GENERAL_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
  // Skip rate limiting for session import and health endpoints
  skip: (req) => req.path === '/api/sessions' && req.method === 'POST' ||
                 req.path === '/api/health',
});

/** Applied to bulk-import and all /api/tools/* routes — heavy operations. */
const strictLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: STRICT_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded for this operation.' },
});

app.use(cors({ origin: process.env.NODE_ENV === 'production' ? 'http://localhost:3000' : '*' }));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(generalLimiter);

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Wraps an async route handler and forwards errors to Express error middleware. */
function asyncRoute(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    version: '5.0.0',
    activeSessions: sessionManager.getActive().length,
    proxyMonitors: proxyMonitor.activeCount(),
  });
});

// ─────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────

app.get('/api/settings', (_req, res) => {
  const settings = db_.getSettings();
  // Mask API keys in response
  res.json({
    settings: {
      ...settings,
      ai: { ...settings.ai, apiKey: settings.ai.apiKey ? '***' : '' },
      agentBridge: { ...settings.agentBridge, apiKey: settings.agentBridge.apiKey ? '***' : '' },
    },
  });
});

app.post('/api/settings', asyncRoute(async (req, res) => {
  const body = req.body;

  // Validate the shape before saving — this controls auth config,
  // so we must not allow arbitrary overwrites.
  if (typeof body !== 'object' || body === null) {
    return res.status(400).json({ success: false, error: 'Invalid settings payload' });
  }

  // Fetch current settings and do a shallow merge so unknown keys are stripped.
  const current = db_.getSettings();
  const merged = {
    ...current,
    // Only allow known top-level keys
    ...(body.ai !== undefined && typeof body.ai === 'object' ? {
      ai: { ...current.ai, ...body.ai },
    } : {}),
    ...(body.agentBridge !== undefined && typeof body.agentBridge === 'object' ? {
      agentBridge: { ...current.agentBridge, ...body.agentBridge },
    } : {}),
    ...(body.stealthMode !== undefined ? { stealthMode: Boolean(body.stealthMode) } : {}),
    ...(body.gridLayout !== undefined && typeof body.gridLayout === 'object' ? { gridLayout: body.gridLayout } : {}),
    ...(body.memoryCapMb !== undefined ? { memoryCapMb: Number(body.memoryCapMb) } : {}),
    ...(body.hibernationEnabled !== undefined ? { hibernationEnabled: Boolean(body.hibernationEnabled) } : {}),
    ...(body.webRTCBlocked !== undefined ? { webRTCBlocked: Boolean(body.webRTCBlocked) } : {}),
    ...(body.mongoUri !== undefined ? { mongoUri: String(body.mongoUri) } : {}),
    ...(body.n8nBaseUrl !== undefined ? { n8nBaseUrl: String(body.n8nBaseUrl) } : {}),
    ...(body.proxyKillSwitch !== undefined ? { proxyKillSwitch: Boolean(body.proxyKillSwitch) } : {}),
    ...(body.maxScrapeParallel !== undefined ? { maxScrapeParallel: Number(body.maxScrapeParallel) } : {}),
    ...(body.inboxPollIntervalMs !== undefined ? { inboxPollIntervalMs: Number(body.inboxPollIntervalMs) } : {}),
  };

  db_.saveSettings(merged);

  // Reconnect MongoDB if URI changed
  if (body.mongoUri !== undefined) {
    await mongoClient.connect();
  }

  res.json({ success: true });
}));

// ─────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────

app.get('/api/sessions', (_req, res) => {
  const sessions = db_.getSessions();
  const active = sessionManager.getActive();

  const enriched = sessions.map((s) => ({
    ...s,
    state: sessionManager.getState(s.id),
    isRunning: active.some((a) => a.session.id === s.id),
  }));

  res.json({ sessions: enriched });
});

app.get('/api/sessions/by-country', (_req, res) => {
  const stats = db_.getSessionsByCountry();
  res.json({ stats });
});

app.get('/api/sessions/:id', (req, res) => {
  const session = db_.getSessionById(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

  res.json({
    session: {
      ...session,
      state: sessionManager.getState(session.id),
      isRunning: sessionManager.getActive().some((a) => a.session.id === session.id),
    },
  });
});

app.post('/api/sessions', asyncRoute(async (req, res) => {
  const { cookie, uid, password, twoFactorSecret, email, phoneNumber, country } = req.body;

  if (!cookie || cookie.trim().length === 0) {
    return res.status(400).json({ success: false, error: 'cookie is required' });
  }

  if (!importParser.isValidCookie(cookie)) {
    return res.status(400).json({ success: false, error: 'cookie does not appear to be a valid Facebook cookie' });
  }

  // Auto-extract UID from c_user cookie value if not provided
  let resolvedUid = uid?.trim() ?? '';
  if (!resolvedUid) {
    // Try standard c_user= format
    const cUserMatch = cookie.match(/c_user[=:]\s*["']?(\d+)["']?/i);
    if (cUserMatch) {
      resolvedUid = cUserMatch[1];
    }
    // Try URL-encoded format: c_user%3D123456 or c_user%3d123456
    if (!resolvedUid) {
      const encodedMatch = cookie.match(/c_user%3[Dd]\s*["']?(\d+)["']?/i);
      if (encodedMatch) resolvedUid = encodedMatch[1];
    }
  }

  // If still no UID, generate a temporary placeholder so the UNIQUE constraint is satisfied.
  // The auto-scraper will update it with the real UID after scraping the profile.
  if (!resolvedUid) {
    resolvedUid = `pending_${uuidv4().replace(/-/g, '').slice(0, 16)}`;
  }

  // Check for duplicate UID (skip pending_ placeholders — they're always unique)
  if (!resolvedUid.startsWith('pending_')) {
    const existing = db_.getSessionByUid(resolvedUid);
    if (existing) {
      return res.status(400).json({ success: false, error: `A session with UID ${resolvedUid} already exists` });
    }
  }

  // Check for duplicate cookie
  const existingSessions = db_.getSessions();
  if (importParser.isDuplicateCookie(cookie, existingSessions.map((s) => s.cookie))) {
    return res.status(400).json({ success: false, error: 'A session with this cookie already exists' });
  }

  const session = db_.createSession({
    uid: resolvedUid,
    fbName: resolvedUid ? `Account ${resolvedUid}` : 'Importing...',
    profileUrl: '',
    cookie,
    password,
    twoFactorSecret,
    email,
    phoneNumber,
    country: country ?? 'Unknown',
    healthStatus: 'live',
    scrapingStatus: 'pending',
    lastCheck: Date.now(),
    bmCount: 0,
    bmRoles: '[]',
    bmRestrictionStatus: 'Live',
    ownedPages: '[]',
    pagesFollowingCount: 0,
    groupsJoinedCount: 0,
    groupRoles: '[]',
    bmData: '[]',
    ownedPagesData: '[]',
    joinedGroupsData: '[]',
    friendsCount: 0,
    professionalMode: false,
    monetizationStatus: false,
  });

  // Session imported — scraping starts only when user clicks Sync All.
  // Do NOT auto-enqueue here so the user has control over when scraping begins.

  res.json({ success: true, session });
}));

app.post('/api/sessions/bulk-import', strictLimiter, upload.single('file'), asyncRoute(async (req, res) => {
  let parseResult;

  if (req.file) {
    // File upload
    const ext = req.file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx') {
      parseResult = importParser.parseXLSX(req.file.buffer);
    } else if (ext === 'csv') {
      parseResult = importParser.parseCSV(req.file.buffer);
    } else {
      return res.status(400).json({ success: false, error: 'Only .xlsx and .csv files are supported' });
    }
  } else if (req.body.cookies) {
    // Pasted text
    parseResult = importParser.parsePastedCookies(req.body.cookies);
  } else {
    return res.status(400).json({ success: false, error: 'Provide a file upload or cookies text' });
  }

  const existingCookies = db_.getSessions().map((s) => s.cookie);
  const existingUids = new Set(db_.getSessions().map((s) => s.uid).filter(Boolean));
  let imported = 0;
  const errors = [...parseResult.errors];

  for (const row of parseResult.rows) {
    if (importParser.isDuplicateCookie(row.cookie, existingCookies)) {
      errors.push({ row: imported + errors.length + 1, reason: 'Duplicate cookie — already exists' });
      continue;
    }

    try {
      const rawUid = row.uid?.trim() ?? '';
      // Auto-extract UID from c_user if not provided (also handles URL-encoded format)
      const extractedUid = rawUid || (() => {
        const m = row.cookie.match(/c_user[=:]\s*["']?(\d+)["']?/i)
          ?? row.cookie.match(/c_user%3[Dd]\s*["']?(\d+)["']?/i);
        return m ? m[1] : '';
      })();

      // Check for duplicate UID before inserting
      if (extractedUid && existingUids.has(extractedUid)) {
        errors.push({ row: imported + errors.length + 1, reason: `Duplicate UID ${extractedUid} — already exists` });
        continue;
      }

      // If no UID found, generate a unique placeholder — scraper will update it later
      const finalUid = extractedUid || `pending_${uuidv4().replace(/-/g, '').slice(0, 16)}`;

      const session = db_.createSession({
        uid: finalUid,
        fbName: extractedUid ? `Account ${extractedUid}` : 'Importing...',
        profileUrl: '',
        cookie: row.cookie,
        password: row.password,
        twoFactorSecret: row.twoFactorSecret,
        email: row.email,
        phoneNumber: row.phoneNumber,
        country: 'Unknown',
        healthStatus: 'live',
        scrapingStatus: 'pending',
        lastCheck: Date.now(),
        bmCount: 0,
        bmRoles: '[]',
        bmRestrictionStatus: 'Live',
        ownedPages: '[]',
        pagesFollowingCount: 0,
        groupsJoinedCount: 0,
        groupRoles: '[]',
        bmData: '[]',
        ownedPagesData: '[]',
        joinedGroupsData: '[]',
        friendsCount: 0,
        professionalMode: false,
        monetizationStatus: false,
      });

      existingCookies.push(row.cookie);
      if (extractedUid) existingUids.add(extractedUid);
      // Do NOT auto-enqueue — user controls scraping via Sync All button
      imported++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ row: imported + errors.length + 1, reason: message });
    }
  }

  res.json({ success: true, imported, failed: errors.length, errors });
}));

app.patch('/api/sessions/:id', asyncRoute(async (req, res) => {
  // Allowlist: only these fields are permitted via the API.
  // This prevents arbitrary column injection into the DB update.
  const ALLOWED_FIELDS = new Set([
    'fbName', 'profileUrl', 'password', 'twoFactorSecret',
    'country', 'phoneNumber', 'email', 'dateOfBirth', 'gender', 'creationDate',
    'bmCount', 'bmRoles', 'bmRestrictionStatus', 'ownedPages', 'pagesFollowingCount',
    'groupsJoinedCount', 'groupRoles', 'bmData', 'ownedPagesData', 'joinedGroupsData',
    'adAccountId', 'currency', 'timezone', 'spendingLimit', 'currentThreshold',
    'accountBalance', 'totalSpent', 'billingDate', 'paymentMethod',
    'friendsCount', 'professionalMode', 'monetizationStatus',
    'healthStatus', 'scrapingStatus', 'proxyId', 'lastCheck',
  ]);

  const unknown = Object.keys(req.body).filter((k) => !ALLOWED_FIELDS.has(k));
  if (unknown.length > 0) {
    return res.status(400).json({ success: false, error: `Unknown fields: ${unknown.join(', ')}` });
  }

  // Type-check healthStatus if present
  const VALID_HEALTH = new Set(['live', 'checkpoint', 'restricted', 'dead']);
  if (req.body.healthStatus !== undefined && !VALID_HEALTH.has(req.body.healthStatus)) {
    return res.status(400).json({ success: false, error: `Invalid healthStatus: ${req.body.healthStatus}` });
  }

  const updated = db_.updateSession(req.params.id, req.body);
  if (!updated) return res.status(404).json({ success: false, error: 'Session not found' });

  // Double-update for proxyId now handled inside db_.updateSession (country lock).
  // No need to call updateSession again here.

  res.json({ success: true, session: updated });
}));

app.delete('/api/sessions/:id', asyncRoute(async (req, res) => {
  // Close browser if running
  const state = sessionManager.getState(req.params.id);
  if (state !== 'idle') {
    await sessionManager.close(req.params.id);
  }

  const deleted = db_.deleteSession(req.params.id);
  res.json({ success: deleted });
}));

// Session actions
app.post('/api/sessions/:id/launch', asyncRoute(async (req, res) => {
  const result = await sessionManager.launch(req.params.id);
  res.json(result);
}));

app.post('/api/sessions/:id/close', asyncRoute(async (req, res) => {
  const result = await sessionManager.close(req.params.id);
  res.json(result);
}));

app.post('/api/sessions/:id/check-health', asyncRoute(async (req, res) => {
  const result = await sessionManager.checkHealth(req.params.id);
  res.json(result);
}));

app.post('/api/sessions/:id/hibernate', asyncRoute(async (req, res) => {
  const result = await sessionManager.hibernate(req.params.id);
  res.json(result);
}));

app.post('/api/sessions/:id/wake', asyncRoute(async (req, res) => {
  const result = await sessionManager.wake(req.params.id);
  res.json(result);
}));

/**
 * POST /api/sessions/scrape/cancel-all
 * Cancels all pending and in-progress scraping immediately.
 * Must be defined BEFORE /:id/scrape to avoid Express matching 'scrape' as :id.
 */
app.post('/api/sessions/scrape/cancel-all', (_req, res) => {
  autoScraper.cancelAll();
  res.json({ success: true, message: 'All scraping cancelled' });
});

app.post('/api/sessions/:id/scrape', asyncRoute(async (req, res) => {
  const session = db_.getSessionById(req.params.id);
  if (!session) return res.status(404).json({ success: false, error: 'Session not found' });

  db_.updateSession(req.params.id, { scrapingStatus: 'pending' });
  autoScraper.enqueue(req.params.id);
  res.json({ success: true, message: 'Scrape enqueued' });
}));

// ─────────────────────────────────────────────
// PROXIES
// ─────────────────────────────────────────────

app.get('/api/proxies', (_req, res) => {
  const proxies = db_.getProxies();
  res.json({ proxies });
});

app.post('/api/proxies', asyncRoute(async (req, res) => {
  const { host, port, username, password, protocol, country } = req.body;
  if (!host || !port) {
    return res.status(400).json({ success: false, error: 'host and port are required' });
  }

  const proxy = db_.createProxy({
    host, port: parseInt(port, 10),
    username, password,
    protocol: protocol ?? 'http',
    country: country ?? 'Unknown',
    isActive: true,
  });

  res.json({ success: true, proxy });
}));

app.post('/api/proxies/bulk', asyncRoute(async (req, res) => {
  const { proxies: proxyLines } = req.body;
  if (!proxyLines || typeof proxyLines !== 'string') {
    return res.status(400).json({ success: false, error: 'proxies string is required' });
  }

  const lines = proxyLines.split('\n').map((l: string) => l.trim()).filter((l: string) => l.length > 0);
  let imported = 0;
  const errors: string[] = [];

  for (const line of lines) {
    try {
      // Format: protocol://user:pass@host:port or host:port
      const url = line.includes('://') ? new URL(line) : new URL(`http://${line}`);
      db_.createProxy({
        host: url.hostname,
        port: parseInt(url.port || '8080', 10),
        username: url.username ? decodeURIComponent(url.username) : undefined,
        password: url.password ? decodeURIComponent(url.password) : undefined,
        protocol: (url.protocol.replace(':', '') as 'http' | 'https' | 'socks5') ?? 'http',
        country: 'Unknown',
        isActive: true,
      });
      imported++;
    } catch {
      errors.push(`Invalid proxy format: ${line}`);
    }
  }

  res.json({ success: true, imported, errors });
}));

app.post('/api/proxies/test', asyncRoute(async (req, res) => {
  const { host, port, username, password, protocol, proxyId } = req.body as {
    host: string;
    port: number | string;
    username?: string;
    password?: string;
    protocol?: string;
    proxyId?: string;
  };
  if (!host || !port) {
    return res.status(400).json({ success: false, error: 'host and port are required' });
  }

  const PROXY_TEST_TIMEOUT_MS = 10_000;
  const GEO_DETECTION_URL = 'https://ipapi.co/json/';

  const auth = username && password ? `${encodeURIComponent(username)}:${encodeURIComponent(password)}@` : '';
  const proxyString = `${protocol ?? 'http'}://${auth}${host}:${port}`;

  const healthy = await proxyMonitor.checkProxy(proxyString);
  if (!healthy) {
    return res.json({ success: false, error: 'Proxy did not respond within 10 seconds' });
  }

  // Auto-detect country by routing a geo-lookup through the proxy
  let country: string | undefined;
  try {
    const proxyUrl = new URL(proxyString);
    const geoResponse = await axios.get<{ country_code?: string }>(GEO_DETECTION_URL, {
      proxy: {
        protocol: proxyUrl.protocol.replace(':', ''),
        host: proxyUrl.hostname,
        port: parseInt(proxyUrl.port, 10),
        ...(proxyUrl.username && proxyUrl.password
          ? { auth: { username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password) } }
          : {}),
      },
      timeout: PROXY_TEST_TIMEOUT_MS,
    });
    country = geoResponse.data?.country_code ?? undefined;
  } catch {
    // Country detection failed — proxy is still alive, just unknown country
  }

  // Persist detected country back to DB if a proxyId was provided
  if (proxyId && country) {
    db_.updateProxy(proxyId, { country });
  }

  res.json({ success: true, country: country ?? 'Unknown' });
}));

app.delete('/api/proxies/:id', (req, res) => {
  const deleted = db_.deleteProxy(req.params.id);
  res.json({ success: deleted });
});

// ─────────────────────────────────────────────
// PROXY ↔ SESSION ASSIGNMENT
// ─────────────────────────────────────────────

/**
 * Assigns a proxy to a session and syncs the session's country to the proxy's country.
 * Accepts the proxy ID in the request body.
 *
 * PATCH /api/sessions/:id/assign-proxy
 * Body: { proxyId: string }
 */
app.patch('/api/sessions/:id/assign-proxy', asyncRoute(async (req, res) => {
  const { proxyId } = req.body as { proxyId: string };
  if (!proxyId) {
    return res.status(400).json({ success: false, error: 'proxyId is required' });
  }

  const session = db_.getSessionById(req.params.id);
  if (!session) {
    return res.status(404).json({ success: false, error: 'Session not found' });
  }

  const proxy = db_.getProxies().find((p) => p.id === proxyId);
  if (!proxy) {
    return res.status(404).json({ success: false, error: 'Proxy not found' });
  }

  // Assign proxy and sync country in one update
  const updated = db_.updateSession(req.params.id, {
    proxyId: proxy.id,
    country: proxy.country,
  });

  res.json({ success: true, session: updated });
}));

/**
 * Bulk-assigns proxies to sessions using round-robin distribution.
 * Optionally filters proxies by country.
 *
 * POST /api/sessions/bulk-assign-proxies
 * Body: { sessionIds: string[], country?: string }
 *
 * Assignment order: session[0] → proxy[0], session[1] → proxy[1], wrapping round-robin.
 * Each session's country is updated to match its assigned proxy's country.
 */
app.post('/api/sessions/bulk-assign-proxies', asyncRoute(async (req, res) => {
  const { sessionIds, country } = req.body as { sessionIds: string[]; country?: string };

  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    return res.status(400).json({ success: false, error: 'sessionIds array is required and must not be empty' });
  }

  // Get proxies — filtered by country if provided, otherwise all active proxies
  const proxies = country
    ? db_.getAvailableProxiesByCountry(country)
    : db_.getProxies();

  if (proxies.length === 0) {
    return res.status(400).json({
      success: false,
      error: country
        ? `No available proxies found for country: ${country}`
        : 'No active proxies available',
    });
  }

  let assigned = 0;
  const errors: string[] = [];

  for (let i = 0; i < sessionIds.length; i++) {
    const sessionId = sessionIds[i];
    // Round-robin: wrap index back to 0 when we run out of proxies
    const proxy = proxies[i % proxies.length];

    const updated = db_.updateSession(sessionId, {
      proxyId: proxy.id,
      country: proxy.country,
    });

    if (updated) {
      assigned++;
    } else {
      errors.push(`Session not found: ${sessionId}`);
    }
  }

  res.json({ success: true, assigned, failed: errors.length, errors });
}));

// ─────────────────────────────────────────────
// CAMPAIGNS
// ─────────────────────────────────────────────

app.get('/api/campaigns', (req, res) => {
  const { status, type, page, limit } = req.query;
  const campaigns = db_.getCampaigns({
    status: status as string,
    type: type as string,
    page: page ? parseInt(page as string, 10) : 1,
    limit: limit ? parseInt(limit as string, 10) : 50,
  });
  res.json({ campaigns });
});

app.post('/api/campaigns', (req, res) => {
  const { name, type, config } = req.body;
  if (!name || !type) {
    return res.status(400).json({ success: false, error: 'name and type are required' });
  }

  const campaign = db_.createCampaign({
    name,
    type,
    status: 'draft',
    config: typeof config === 'string' ? config : JSON.stringify(config ?? {}),
  });

  res.json({ success: true, campaign });
});

app.get('/api/campaigns/:id', (req, res) => {
  const campaign = db_.getCampaignById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });
  const progress = campaignEngine.getProgress(req.params.id);
  res.json({ campaign, progress });
});

app.patch('/api/campaigns/:id', asyncRoute(async (req, res) => {
  const { action } = req.body;
  const campaign = db_.getCampaignById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

  let result: { success: boolean; error?: string };
  switch (action) {
    case 'pause':
      result = campaignEngine.pause(req.params.id);
      break;
    case 'resume':
      // Resume requires an executor — for API-level resume, just update status
      // The tool that started the campaign must re-register its executor
      result = db_.updateCampaign(req.params.id, { status: 'running' })
        ? { success: true }
        : { success: false, error: 'Campaign not found' };
      break;
    case 'cancel':
      result = await campaignEngine.cancel(req.params.id);
      break;
    default:
      return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  }

  if (!result.success) {
    return res.status(400).json({ success: false, error: result.error });
  }
  res.json({ success: true, campaign: db_.getCampaignById(req.params.id) });
}));

app.delete('/api/campaigns/:id', (req, res) => {
  const campaign = db_.getCampaignById(req.params.id);
  if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found' });

  if (campaign.status === 'running') {
    return res.status(400).json({ success: false, error: 'Cannot delete a running campaign. Pause or cancel it first.' });
  }

  const deleted = db_.deleteCampaign(req.params.id);
  res.json({ success: deleted });
});

app.get('/api/campaigns/:id/tasks', (req, res) => {
  const tasks = db_.getCampaignTasks(req.params.id);
  res.json({ tasks });
});

// ─────────────────────────────────────────────
// PARKED ASSETS
// ─────────────────────────────────────────────

app.get('/api/parked-assets', (req, res) => {
  const { type } = req.query;
  const assets = db_.getParkedAssets(type as 'page' | 'bm' | undefined);
  res.json({ assets });
});

app.delete('/api/parked-assets/:id', (req, res) => {
  const deleted = db_.deleteParkedAsset(req.params.id);
  res.json({ success: deleted });
});

// ─────────────────────────────────────────────
// CONTACTS
// ─────────────────────────────────────────────

app.get('/api/contacts', (req, res) => {
  const { tag, recencyDays } = req.query;
  const contacts = contactManager.getContacts({
    tag: tag as string | undefined,
    recencyDays: recencyDays ? parseInt(recencyDays as string, 10) : undefined,
  });
  res.json({ contacts, stats: contactManager.getStats() });
});

app.get('/api/contacts/:id', (req, res) => {
  const contact = contactManager.getContactWithHistory(req.params.id);
  if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
  res.json({ contact });
});

app.patch('/api/contacts/:id', (req, res) => {
  const { tags, notes } = req.body;
  let updated;
  if (tags !== undefined) {
    updated = contactManager.setTags(req.params.id, Array.isArray(tags) ? tags : JSON.parse(tags));
  }
  if (notes !== undefined) {
    updated = contactManager.updateNotes(req.params.id, notes);
  }
  if (!updated) return res.status(404).json({ success: false, error: 'Contact not found' });
  res.json({ success: true, contact: updated });
});

app.delete('/api/contacts/:id', (req, res) => {
  const deleted = db_.deleteContact(req.params.id);
  res.json({ success: deleted });
});

app.post('/api/contacts/:id/message', asyncRoute(async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ success: false, error: 'sessionId is required' });
  const contact = db_.getContactById(req.params.id);
  if (!contact) return res.status(404).json({ success: false, error: 'Contact not found' });
  res.json({ success: true, sessionId, contactUid: contact.fbUid });
}));

// ─────────────────────────────────────────────
// INBOX
// ─────────────────────────────────────────────

app.get('/api/inbox/conversations', (req, res) => {
  const { sessionId, tag, unread } = req.query;
  const conversations = inboxManager.getConversations({
    sessionId: sessionId as string | undefined,
    tag: tag as string | undefined,
    unreadOnly: unread === 'true',
  });
  res.json({ conversations, unreadCount: inboxManager.getTotalUnreadCount() });
});

app.get('/api/inbox/conversations/:sessionId/:contactUid', asyncRoute(async (req, res) => {
  const { sessionId, contactUid } = req.params;
  const thread = await inboxManager.getThread(sessionId, contactUid);
  res.json({ thread });
}));

app.post('/api/inbox/conversations/:sessionId/:contactUid/reply', asyncRoute(async (req, res) => {
  const { sessionId, contactUid } = req.params;
  const { text } = req.body;
  if (!text) return res.status(400).json({ success: false, error: 'text is required' });
  const result = await inboxManager.sendReply(sessionId, contactUid, text);
  res.json(result);
}));

app.post('/api/inbox/conversations/:sessionId/:contactUid/ai-reply', asyncRoute(async (req, res) => {
  const { sessionId, contactUid } = req.params;
  const settings = db_.getSettings();
  if (!settings.ai.enabled) {
    return res.status(400).json({ success: false, error: 'AI not enabled' });
  }
  const conversations = inboxManager.getConversations({ sessionId });
  const conv = conversations.find((c) => c.contactUid === contactUid);
  const context = conv ? `Message from ${conv.contactName}: "${conv.lastMessage}"` : 'Incoming message';
  const { aiGateway } = await import('./utils/ai-gateway');
  const result = await aiGateway.generateHumanResponse(settings.ai, context, 'message');
  res.json(result);
}));

// ─────────────────────────────────────────────
// SELECTOR CACHE
// ─────────────────────────────────────────────

app.get('/api/selector-cache', (_req, res) => {
  const entries = db_.getSelectorCache();
  res.json({ entries });
});

app.delete('/api/selector-cache/:id', (req, res) => {
  const deleted = db_.deleteSelectorCacheEntry(req.params.id);
  res.json({ success: deleted });
});

// ─────────────────────────────────────────────
// WARM-UP JOBS
// ─────────────────────────────────────────────

app.get('/api/warmup/jobs', (_req, res) => {
  const jobs = db_.getWarmUpJobs();
  res.json({ jobs });
});

app.post('/api/warmup/jobs', asyncRoute(async (req, res) => {
  const { mode, sessionIds, config } = req.body;
  if (!mode || !sessionIds) {
    return res.status(400).json({ success: false, error: 'mode and sessionIds are required' });
  }
  const ids = Array.isArray(sessionIds) ? sessionIds : JSON.parse(sessionIds);
  const cfg = typeof config === 'string' ? JSON.parse(config) : (config ?? {
    messagesPerDay: 5, durationDays: 7,
    responseDelayMinMs: 120000, responseDelayMaxMs: 1800000,
    messageTemplates: ['Hey! How are you?'],
  });
  const job = await warmupEngine.createJob(mode, ids, cfg);
  res.json({ success: true, job });
}));

app.patch('/api/warmup/jobs/:id', asyncRoute(async (req, res) => {
  const { action } = req.body;
  if (action === 'pause') return res.json(warmupEngine.pauseJob(req.params.id));
  if (action === 'resume') return res.json(await warmupEngine.resumeJob(req.params.id));
  return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
}));

app.delete('/api/warmup/jobs/:id', (req, res) => {
  const deleted = warmupEngine.deleteJob(req.params.id);
  res.json({ success: deleted });
});

app.get('/api/warmup/jobs/:id/scores', (req, res) => {
  const scores = warmupEngine.getJobScores(req.params.id);
  res.json({ scores });
});

// ─────────────────────────────────────────────
// LOGS
// ─────────────────────────────────────────────

app.get('/api/logs', asyncRoute(async (req, res) => {
  const { sessionId, limit } = req.query;
  const logs = await mongoClient.getActivityLogs(
    sessionId as string | undefined,
    limit ? parseInt(limit as string, 10) : 100
  );
  res.json({ logs });
}));

app.post('/api/tools/content-amplifier/start', strictLimiter, asyncRoute(async (req, res) => {
  const { mode, sessionIds, targetUrl, actions, commentTemplate, timing, dripHours, watchDurationPercent, scheduleDays } = req.body;
  if (!targetUrl || !sessionIds?.length) {
    return res.status(400).json({ success: false, error: 'targetUrl and sessionIds are required' });
  }
  const { contentAmplifier } = await import('./tools/content-amplifier');
  let campaign;
  if (mode === 'video_watch_farm') {
    campaign = await contentAmplifier.startVideoWatchFarm({ targetUrl, sessionIds, watchDurationPercent: watchDurationPercent ?? 85, scheduleDays });
  } else {
    campaign = await contentAmplifier.startPostSeeder({ targetUrl, sessionIds, actions: actions ?? { like: true }, commentTemplate, timing: timing ?? 'burst', dripHours });
  }
  res.json({ success: true, campaign });
}));
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// TOOLS
// ─────────────────────────────────────────────

app.post('/api/tools/page-factory/start', strictLimiter, asyncRoute(async (req, res) => {
  const { workerIds, parkingId, config } = req.body as {
    workerIds: string[];
    parkingId: string;
    config: Omit<import('./tools/page-factory').PageFactoryConfig, 'workerSessionIds' | 'parkingSessionId'>;
  };
  if (!workerIds?.length || !parkingId) {
    return res.status(400).json({ success: false, error: 'workerIds and parkingId are required' });
  }
  if (!config?.pagesPerWorker || !config?.nameTemplate || !config?.category) {
    return res.status(400).json({ success: false, error: 'config.pagesPerWorker, config.nameTemplate, and config.category are required' });
  }
  try {
    const campaign = await pageFactory.startPageFactoryJob(workerIds, parkingId, config);
    res.json({ success: true, data: { campaign } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: message });
  }
}));

app.post('/api/tools/bm-factory/start', strictLimiter, asyncRoute(async (req, res) => {
  const { workerIds, parkingId, config } = req.body as {
    workerIds: string[];
    parkingId: string;
    config: Omit<import('./tools/bm-factory').BMFactoryConfig, 'workerSessionIds' | 'parkingSessionId'>;
  };
  if (!workerIds?.length || !parkingId) {
    return res.status(400).json({ success: false, error: 'workerIds and parkingId are required' });
  }
  if (!config?.bmsPerWorker || !config?.nameTemplate) {
    return res.status(400).json({ success: false, error: 'config.bmsPerWorker and config.nameTemplate are required' });
  }
  try {
    const campaign = await bmFactory.startBMFactoryJob(workerIds, parkingId, config);
    res.json({ success: true, data: { campaign } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: message });
  }
}));

app.post('/api/tools/group-hunter/start', strictLimiter, asyncRoute(async (req, res) => {
  const { sessionIds, targets, phases } = req.body as {
    sessionIds: string[];
    targets: string[];
    phases: Record<string, unknown>;
  };
  if (!sessionIds?.length || !targets?.length || !phases) {
    return res.status(400).json({ success: false, error: 'sessionIds, targets, and phases are required' });
  }
  try {
    const campaign = await groupHunter.startGroupHunterJob(sessionIds, targets, phases as Parameters<typeof groupHunter.startGroupHunterJob>[2]);
    res.json({ success: true, data: { campaign } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: message });
  }
}));

app.post('/api/tools/comment-engine/start', strictLimiter, asyncRoute(async (req, res) => {
  const { sessionIds, stance, targets, contentTemplate, timing, options } = req.body as {
    sessionIds: string[];
    stance: Parameters<typeof commentEngine.startCommentJob>[1];
    targets: string[];
    contentTemplate: string;
    timing: Parameters<typeof commentEngine.startCommentJob>[4];
    options?: Parameters<typeof commentEngine.startCommentJob>[5];
  };
  if (!sessionIds?.length || !stance || !targets?.length || !contentTemplate || !timing) {
    return res.status(400).json({ success: false, error: 'sessionIds, stance, targets, contentTemplate, and timing are required' });
  }
  try {
    const campaign = await commentEngine.startCommentJob(sessionIds, stance, targets, contentTemplate, timing, options ?? {});
    res.json({ success: true, data: { campaign } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ success: false, error: message });
  }
}));

// ─── Browser Recorder ───────────────────────────────────────────────────────

app.post('/api/tools/browser-recorder/start', strictLimiter, asyncRoute(async (req, res) => {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const result = await browserRecorder.startSession(sessionId);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, data: { debugPort: result.debugPort } });
}));

app.post('/api/tools/browser-recorder/stop', asyncRoute(async (req, res) => {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const result = await browserRecorder.stopSession(sessionId);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true });
}));

app.get('/api/tools/browser-recorder/frame/:sessionId', asyncRoute(async (req, res) => {
  const result = await browserRecorder.captureFrame(req.params.sessionId);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, data: { frame: result.frame, pageUrl: result.pageUrl, pageTitle: result.pageTitle } });
}));

app.post('/api/tools/browser-recorder/click', asyncRoute(async (req, res) => {
  const { sessionId, x, y } = req.body as { sessionId: string; x: number; y: number };
  if (!sessionId || x === undefined || y === undefined)
    return res.status(400).json({ error: 'sessionId, x, y required' });
  const result = await browserRecorder.captureAction(sessionId, x, y);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, data: { action: result.action } });
}));

app.post('/api/tools/browser-recorder/keypress', asyncRoute(async (req, res) => {
  const { sessionId, key, text } = req.body as { sessionId: string; key: string; text: string };
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const result = await browserRecorder.dispatchKeypress(sessionId, key ?? '', text ?? '');
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true });
}));

app.get('/api/tools/browser-recorder/recordings/:sessionId', (req, res) => {
  const result = browserRecorder.getRecordings(req.params.sessionId);
  if (!result.success) return res.status(404).json({ error: result.error });
  res.json({ success: true, data: { recordings: result.recordings } });
});

app.post('/api/tools/browser-recorder/recording/start', (req, res) => {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const result = browserRecorder.startRecording(sessionId);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true });
});

app.post('/api/tools/browser-recorder/recording/stop', (req, res) => {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const result = browserRecorder.stopRecording(sessionId);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true });
});

app.post('/api/tools/browser-recorder/recording/clear', (req, res) => {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const result = browserRecorder.clearRecordings(sessionId);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true });
});

app.post('/api/tools/browser-recorder/analyze', asyncRoute(async (req, res) => {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
  const result = await browserRecorder.analyzeRecording(sessionId);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, data: { steps: result.steps } });
}));

app.post('/api/tools/browser-recorder/save-workflow', asyncRoute(async (req, res) => {
  const { sessionId, name, steps } = req.body as {
    sessionId: string;
    name: string;
    steps: WorkflowStep[];
  };
  if (!sessionId || !name || !steps) return res.status(400).json({ error: 'sessionId, name, steps required' });
  const result = await browserRecorder.saveWorkflow(sessionId, name, steps);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, data: { workflow: result.workflow } });
}));

app.post('/api/tools/browser-recorder/debug', asyncRoute(async (req, res) => {
  const { sessionId, message } = req.body as { sessionId: string; message: string };
  if (!sessionId || !message?.trim()) {
    return res.status(400).json({ error: 'sessionId and message are required' });
  }

  const settings = db_.getSettings();
  if (!settings.ai.enabled || !settings.ai.apiKey) {
    return res.status(400).json({ error: 'AI not configured. Enable it in Settings → AI.' });
  }

  // Get current frame + recent actions for context
  const [frameResult, recordingsResult] = await Promise.all([
    browserRecorder.captureFrame(sessionId),
    Promise.resolve(browserRecorder.getRecordings(sessionId)),
  ]);

  const screenshot = frameResult.success ? (frameResult.frame ?? null) : null;
  const actions = recordingsResult.success ? (recordingsResult.recordings ?? []) : [];

  const { aiGateway } = await import('./utils/ai-gateway');
  const result = await aiGateway.debugSession(settings, message.trim(), screenshot, actions);

  if (!result.success) return res.status(502).json({ error: result.error });
  res.json({ success: true, data: { reply: result.content } });
}));

// ─── Recorded Workflows CRUD ─────────────────────────────────────────────────

app.get('/api/workflows', (_req, res) => {
  const workflows = db_.getRecordedWorkflows();
  res.json({ workflows });
});

app.get('/api/workflows/:id', (req, res) => {
  const workflow = db_.getRecordedWorkflowById(req.params.id);
  if (!workflow) return res.status(404).json({ error: 'Workflow not found' });
  res.json({ workflow });
});

app.delete('/api/workflows/:id', (req, res) => {
  const deleted = db_.deleteRecordedWorkflow(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Workflow not found' });
  res.json({ success: true });
});

app.post('/api/webhooks/test', asyncRoute(async (req, res) => {
  const { n8nBaseUrl } = req.body;
  if (!n8nBaseUrl) {
    return res.status(400).json({ success: false, error: 'n8nBaseUrl is required' });
  }
  const result = await webhookService.fireTest(n8nBaseUrl);
  res.json(result);
}));

// ─────────────────────────────────────────────
// MONGODB TEST
// ─────────────────────────────────────────────

app.post('/api/mongodb/test', asyncRoute(async (req, res) => {
  const { mongoUri } = req.body;
  if (!mongoUri) {
    return res.status(400).json({ success: false, error: 'mongoUri is required' });
  }
  const result = await mongoClient.testConnection(mongoUri);
  res.json(result);
}));

// ─────────────────────────────────────────────
// SYSTEM STATS
// ─────────────────────────────────────────────

/**
 * Returns real-time system memory usage for the Dashboard widget.
 * Polls OS-level memory via the built-in `os` module — no external deps.
 */
app.get('/api/system/stats', (_req, res) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const os = require('os') as typeof import('os');
  const mem = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  res.json({
    systemPct:     Math.round((usedMem / totalMem) * 100),
    systemUsedMb:  Math.round(usedMem / 1024 / 1024),
    systemTotalMb: Math.round(totalMem / 1024 / 1024),
    processMb:     Math.round(mem.rss / 1024 / 1024),
  });
});

// ─────────────────────────────────────────────
// SYSTEM HEALTH — constants
// ─────────────────────────────────────────────

/** RAM reserved for the OS — not counted toward usable capacity. */
const SYSTEM_RAM_RESERVE_MB    = 1_024;
/** Estimated RAM cost per headless browser instance. */
const RAM_PER_HEADLESS_MB      = 175;
/** Estimated RAM cost per headed browser instance. */
const RAM_PER_HEADED_MB        = 350;
/** Normal mode capacity multiplier. */
const CAPACITY_NORMAL_FACTOR   = 0.70;
/** Pressure mode capacity multiplier. */
const CAPACITY_PRESSURE_FACTOR = 0.85;
/** Risk mode capacity multiplier. */
const CAPACITY_RISK_FACTOR     = 0.95;
/** Interval for CPU usage sampling (two snapshots). */
const CPU_SAMPLE_INTERVAL_MS   = 100;

/** Shape returned by GET /api/system/health */
interface SystemHealthResponse {
  cpu: {
    model: string;
    cores: number;
    usagePercent: number;
  };
  ram: {
    totalMB: number;
    usedMB: number;
    freeMB: number;
    usagePercent: number;
  };
  disk: {
    totalGB: number;
    freeGB: number;
    usagePercent: number;
  };
  instances: {
    currentActive: number;
    headlessNormal: number;
    headlessPressure: number;
    headlessRisk: number;
    headedNormal: number;
    headedPressure: number;
    headedRisk: number;
    status: 'healthy' | 'pressure' | 'risk' | 'critical';
  };
}

/**
 * Samples os.cpus() twice with a CPU_SAMPLE_INTERVAL_MS gap and returns
 * the aggregate usage percentage across all logical cores.
 *
 * Returns 0 when totalDiff === 0 (e.g. on first call or idle system).
 *
 * @returns Integer in [0, 100] representing CPU usage percent.
 */
async function getCpuUsage(): Promise<number> {
  function snapshot(): { idle: number; total: number } {
    let idle = 0;
    let total = 0;
    for (const cpu of os.cpus()) {
      idle += cpu.times.idle;
      for (const val of Object.values(cpu.times)) {
        total += val as number;
      }
    }
    return { idle, total };
  }

  const s1 = snapshot();
  await new Promise<void>((r) => setTimeout(r, CPU_SAMPLE_INTERVAL_MS));
  const s2 = snapshot();

  const idleDiff  = s2.idle  - s1.idle;
  const totalDiff = s2.total - s1.total;

  if (totalDiff === 0) return 0;
  return Math.min(100, Math.max(0, Math.round((1 - idleDiff / totalDiff) * 100)));
}

/**
 * Returns comprehensive device metrics for the Dashboard Device Capacity widget.
 * Collects CPU, RAM, Disk, and runnable browser instance counts in one call.
 *
 * CPU usage is measured via a two-sample diff over CPU_SAMPLE_INTERVAL_MS.
 * Disk is read from C:\ on Windows, / on other platforms.
 * Instance counts are derived from usableRAM = freeMB - SYSTEM_RAM_RESERVE_MB.
 *
 * @returns SystemHealthResponse on success (HTTP 200)
 * @returns { success: false, error: string } on failure (HTTP 500)
 */
app.get('/api/system/health', asyncRoute(async (_req, res) => {
  // ── CPU ──────────────────────────────────────────────────────
  const cpus         = os.cpus();
  const cpuModel     = cpus[0]?.model ?? 'Unknown';
  const cpuCores     = cpus.length;
  const usagePercent = await getCpuUsage();

  // ── RAM ──────────────────────────────────────────────────────
  const totalMB     = Math.round(os.totalmem() / 1024 / 1024);
  const freeMB      = Math.round(os.freemem()  / 1024 / 1024);
  const usedMB      = totalMB - freeMB;
  const ramUsagePct = Math.round((usedMB / totalMB) * 100);

  // ── DISK ─────────────────────────────────────────────────────
  const diskPath     = process.platform === 'win32' ? 'C:\\' : '/';
  const stat         = fs.statfsSync(diskPath);
  const totalGB      = Math.round((stat.blocks * stat.bsize) / 1024 / 1024 / 1024 * 10) / 10;
  const freeGB       = Math.round((stat.bfree  * stat.bsize) / 1024 / 1024 / 1024 * 10) / 10;
  const diskUsagePct = totalGB > 0
    ? Math.round(((totalGB - freeGB) / totalGB) * 100)
    : 0;

  // ── INSTANCES ────────────────────────────────────────────────
  const usableRAM = Math.max(0, freeMB - SYSTEM_RAM_RESERVE_MB);

  const headlessNormal   = Math.floor(usableRAM / RAM_PER_HEADLESS_MB * CAPACITY_NORMAL_FACTOR);
  const headlessPressure = Math.floor(usableRAM / RAM_PER_HEADLESS_MB * CAPACITY_PRESSURE_FACTOR);
  const headlessRisk     = Math.floor(usableRAM / RAM_PER_HEADLESS_MB * CAPACITY_RISK_FACTOR);
  const headedNormal     = Math.floor(usableRAM / RAM_PER_HEADED_MB   * CAPACITY_NORMAL_FACTOR);
  const headedPressure   = Math.floor(usableRAM / RAM_PER_HEADED_MB   * CAPACITY_PRESSURE_FACTOR);
  const headedRisk       = Math.floor(usableRAM / RAM_PER_HEADED_MB   * CAPACITY_RISK_FACTOR);

  const currentActive = sessionManager.getActive().length;

  type InstanceStatus = 'healthy' | 'pressure' | 'risk' | 'critical';
  let status: InstanceStatus;
  if (usableRAM <= 0 || currentActive >= headlessRisk) {
    status = 'critical';
  } else if (currentActive >= headlessPressure) {
    status = 'risk';
  } else if (currentActive >= headlessNormal) {
    status = 'pressure';
  } else {
    status = 'healthy';
  }

  const body: SystemHealthResponse = {
    cpu:  { model: cpuModel, cores: cpuCores, usagePercent },
    ram:  { totalMB, usedMB, freeMB, usagePercent: ramUsagePct },
    disk: { totalGB, freeGB, usagePercent: diskUsagePct },
    instances: {
      currentActive,
      headlessNormal,
      headlessPressure,
      headlessRisk,
      headedNormal,
      headedPressure,
      headedRisk,
      status,
    },
  };

  res.json(body);
}));

// ─────────────────────────────────────────────
// ERROR MIDDLEWARE
// ─────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[api] Unhandled error:', err.stack);
  res.status(500).json({ success: false, error: err.message });
});

// ─────────────────────────────────────────────
// STARTUP
// ─────────────────────────────────────────────

async function start(): Promise<void> {
  // Connect to MongoDB if configured
  await mongoClient.connect();

  // Start auto-scraper queue (picks up pending sessions from previous run)
  autoScraper.startQueue();

  // Start Agent Bridge if enabled
  const settings = db_.getSettings();
  if (settings.agentBridge.enabled) {
    const { agentBridge } = await import('./agent-bridge');
    const bridgeApp = agentBridge.create(settings.agentBridge);
    bridgeApp.listen(settings.agentBridge.port, () => {
      console.log(`[agent-bridge] Running on port ${settings.agentBridge.port}`);
    });
  }

  app.listen(PORT, () => {
    console.log(`[api] Flogination V5 API running on port ${PORT}`);
  });
}

start().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('[api] Failed to start:', message);
  process.exit(1);
});

export default app;
