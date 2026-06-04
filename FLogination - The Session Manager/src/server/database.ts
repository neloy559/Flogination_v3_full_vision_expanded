/**
 * Flogination V5 — Database Layer
 *
 * Single source of truth for all SQLite operations.
 * All DB access goes through the exported `db_` object — never write raw SQL elsewhere.
 *
 * On startup:
 *  1. WAL mode is enabled for concurrent reads during mass scraping.
 *  2. Foreign key enforcement is enabled.
 *  3. Migration runs — new columns and tables are added if missing.
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import type {
  Session,
  Proxy,
  AppSettings,
  ActivityLog,
  Campaign,
  CampaignTask,
  ParkedAsset,
  SelectorCache,
  Contact,
  ContactInteraction,
  WarmUpJob,
  CountrySessionStats,
  BulkImportResult,
  RecordedWorkflow,
} from '../types';

// ─────────────────────────────────────────────
// DATABASE INITIALISATION
// ─────────────────────────────────────────────

// In portable Electron mode, DB_PATH is set by the main process to a path
// next to the .exe file. Falls back to process.cwd() for dev/server-only mode.
const DB_PATH = process.env.DB_PATH ?? path.resolve(process.cwd(), 'flogination.db');
const db = new Database(DB_PATH);

// Enable WAL mode — allows concurrent readers while a writer is active.
// Critical during mass scraping: multiple scrapers write while the UI reads.
db.pragma('journal_mode = WAL');

// Enforce foreign key constraints — SQLite disables this by default.
db.pragma('foreign_keys = ON');

// ─────────────────────────────────────────────
// SCHEMA — BASE TABLES
// ─────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id                   TEXT PRIMARY KEY,
    uid                  TEXT UNIQUE NOT NULL,
    fbName               TEXT NOT NULL,
    profileUrl           TEXT,
    password             TEXT,
    cookie               TEXT NOT NULL,
    twoFactorSecret      TEXT,
    country              TEXT DEFAULT 'Unknown',
    phoneNumber          TEXT,
    email                TEXT,
    dateOfBirth          TEXT,
    gender               TEXT,
    creationDate         TEXT,
    bmCount              INTEGER DEFAULT 0,
    bmRoles              TEXT NOT NULL DEFAULT '[]',
    bmRestrictionStatus  TEXT DEFAULT 'Live',
    ownedPages           TEXT NOT NULL DEFAULT '[]',
    pagesFollowingCount  INTEGER DEFAULT 0,
    groupsJoinedCount    INTEGER DEFAULT 0,
    groupRoles           TEXT NOT NULL DEFAULT '[]',
    adAccountId          TEXT,
    currency             TEXT,
    timezone             TEXT,
    spendingLimit        REAL,
    currentThreshold     REAL,
    accountBalance       REAL,
    totalSpent           REAL,
    billingDate          TEXT,
    paymentMethod        TEXT,
    friendsCount         INTEGER DEFAULT 0,
    healthStatus         TEXT DEFAULT 'live',
    proxyId              TEXT,
    lastCheck            INTEGER,
    createdAt            INTEGER NOT NULL,
    updatedAt            INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS proxies (
    id        TEXT PRIMARY KEY,
    host      TEXT NOT NULL,
    port      INTEGER NOT NULL,
    username  TEXT,
    password  TEXT,
    protocol  TEXT DEFAULT 'http',
    country   TEXT DEFAULT 'Unknown',
    isActive  INTEGER DEFAULT 1,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id         TEXT PRIMARY KEY,
    sessionId  TEXT,
    action     TEXT NOT NULL,
    details    TEXT,
    campaignId TEXT,
    timestamp  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_health   ON sessions(healthStatus);
  CREATE INDEX IF NOT EXISTS idx_sessions_proxy    ON sessions(proxyId);
  CREATE INDEX IF NOT EXISTS idx_logs_session      ON activity_logs(sessionId);
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp    ON activity_logs(timestamp);
`);

// ─────────────────────────────────────────────
// MIGRATION — Add V5 columns to existing tables
// Uses PRAGMA table_info to check before ALTER TABLE
// so re-running on an existing DB is safe.
// ─────────────────────────────────────────────

type ColumnInfo = { name: string };

/**
 * Adds a column to a table only if it does not already exist.
 * Safe to call on every startup — idempotent.
 */
function addColumnIfMissing(
  table: string,
  column: string,
  definition: string
): void {
  const existing = db
    .prepare(`PRAGMA table_info(${table})`)
    .all() as ColumnInfo[];
  const exists = existing.some((col) => col.name === column);
  if (!exists) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}

// V5 session columns
addColumnIfMissing('sessions', 'bmData',           "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('sessions', 'ownedPagesData',   "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('sessions', 'joinedGroupsData', "TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing('sessions', 'professionalMode', 'INTEGER DEFAULT 0');
addColumnIfMissing('sessions', 'monetizationStatus', 'INTEGER DEFAULT 0');
addColumnIfMissing('sessions', 'scrapingStatus',   "TEXT DEFAULT 'pending'");
addColumnIfMissing('sessions', 'scrapedAt',        'INTEGER');

// ─────────────────────────────────────────────
// MIGRATION — Fix activity_logs FK constraint
// SQLite doesn't support DROP CONSTRAINT, so we recreate the table
// if it has the old FOREIGN KEY on sessionId.
// ─────────────────────────────────────────────

const activityLogsFKCheck = db
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='activity_logs'")
  .get() as { sql: string } | undefined;

if (activityLogsFKCheck?.sql?.includes('FOREIGN KEY (sessionId)')) {
  // Recreate without FK
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_logs_new (
      id         TEXT PRIMARY KEY,
      sessionId  TEXT,
      action     TEXT NOT NULL,
      details    TEXT,
      campaignId TEXT,
      timestamp  INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO activity_logs_new SELECT id, sessionId, action, details, campaignId, timestamp FROM activity_logs;
    DROP TABLE activity_logs;
    ALTER TABLE activity_logs_new RENAME TO activity_logs;
    CREATE INDEX IF NOT EXISTS idx_logs_session   ON activity_logs(sessionId);
    CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON activity_logs(timestamp);
  `);
  console.log('[database] Migrated activity_logs — removed FK constraint');
}

// ─────────────────────────────────────────────
// SCHEMA — V5 NEW TABLES
// ─────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    type        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    config      TEXT NOT NULL DEFAULT '{}',
    createdAt   INTEGER NOT NULL,
    updatedAt   INTEGER NOT NULL,
    completedAt INTEGER
  );

  CREATE TABLE IF NOT EXISTS campaign_tasks (
    id          TEXT PRIMARY KEY,
    campaignId  TEXT NOT NULL,
    sessionId   TEXT NOT NULL,
    action      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    result      TEXT,
    error       TEXT,
    startedAt   INTEGER,
    completedAt INTEGER,
    FOREIGN KEY (campaignId) REFERENCES campaigns(id),
    FOREIGN KEY (sessionId)  REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS parked_assets (
    id               TEXT PRIMARY KEY,
    type             TEXT NOT NULL,
    assetId          TEXT NOT NULL,
    assetName        TEXT NOT NULL,
    creatorSessionId TEXT NOT NULL,
    parkingSessionId TEXT NOT NULL,
    transferStatus   TEXT NOT NULL DEFAULT 'pending',
    createdAt        INTEGER NOT NULL,
    transferredAt    INTEGER,
    FOREIGN KEY (creatorSessionId) REFERENCES sessions(id),
    FOREIGN KEY (parkingSessionId) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS selector_cache (
    id           TEXT PRIMARY KEY,
    elementKey   TEXT UNIQUE NOT NULL,
    cssSelector  TEXT NOT NULL,
    lastVerified INTEGER NOT NULL,
    healCount    INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id            TEXT PRIMARY KEY,
    fbUid         TEXT UNIQUE NOT NULL,
    fbName        TEXT,
    profileUrl    TEXT,
    tags          TEXT NOT NULL DEFAULT '[]',
    notes         TEXT DEFAULT '',
    firstSeenVia  TEXT,
    lastInteraction INTEGER,
    createdAt     INTEGER NOT NULL,
    updatedAt     INTEGER NOT NULL,
    FOREIGN KEY (firstSeenVia) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS contact_interactions (
    id        TEXT PRIMARY KEY,
    contactId TEXT NOT NULL,
    sessionId TEXT,
    type      TEXT NOT NULL,
    content   TEXT,
    direction TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (contactId) REFERENCES contacts(id),
    FOREIGN KEY (sessionId) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS warmup_jobs (
    id         TEXT PRIMARY KEY,
    mode       TEXT NOT NULL,
    sessionIds TEXT NOT NULL DEFAULT '[]',
    config     TEXT NOT NULL DEFAULT '{}',
    status     TEXT NOT NULL DEFAULT 'running',
    createdAt  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_campaigns_status       ON campaigns(status);
  CREATE INDEX IF NOT EXISTS idx_campaigns_type         ON campaigns(type);
  CREATE INDEX IF NOT EXISTS idx_tasks_campaign         ON campaign_tasks(campaignId);
  CREATE INDEX IF NOT EXISTS idx_tasks_session          ON campaign_tasks(sessionId);
  CREATE INDEX IF NOT EXISTS idx_tasks_status           ON campaign_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_parked_parking         ON parked_assets(parkingSessionId);
  CREATE INDEX IF NOT EXISTS idx_parked_type            ON parked_assets(type);
  CREATE INDEX IF NOT EXISTS idx_contacts_uid           ON contacts(fbUid);
  CREATE INDEX IF NOT EXISTS idx_contacts_last          ON contacts(lastInteraction);
  CREATE INDEX IF NOT EXISTS idx_interactions_contact   ON contact_interactions(contactId);
  CREATE INDEX IF NOT EXISTS idx_interactions_session   ON contact_interactions(sessionId);
  CREATE INDEX IF NOT EXISTS idx_sessions_scraping      ON sessions(scrapingStatus);

  CREATE TABLE IF NOT EXISTS recorded_workflows (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    sessionId TEXT NOT NULL,
    steps     TEXT NOT NULL DEFAULT '[]',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (sessionId) REFERENCES sessions(id)
  );

  CREATE INDEX IF NOT EXISTS idx_workflows_session ON recorded_workflows(sessionId);
`);

// ─────────────────────────────────────────────
// DEFAULT SETTINGS
// ─────────────────────────────────────────────

const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    provider: 'openrouter',
    apiKey: '',
    model: 'openai/gpt-3.5-turbo',
    freeModel: 'openrouter/auto',
    enabled: false,
  },
  agentBridge: {
    enabled: false,
    port: 3002,
    apiKey: '',
    allowedOrigins: ['*'],
  },
  stealthMode: true,
  gridLayout: { cols: 3, rows: 4 },
  memoryCapMb: 512,
  hibernationEnabled: true,
  webRTCBlocked: true,
  mongoUri: '',
  n8nBaseUrl: '',
  proxyKillSwitch: true,
  maxScrapeParallel: 3,
  inboxPollIntervalMs: 60_000,
};

// ─────────────────────────────────────────────
// SETTINGS CRUD
// ─────────────────────────────────────────────

/**
 * Reads app settings from the database, merged with defaults.
 * Always returns a complete AppSettings object even if DB is empty.
 */
function getSettings(): AppSettings {
  const row = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('app_settings') as { value: string } | undefined;

  if (row) {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
  }
  return DEFAULT_SETTINGS;
}

/**
 * Persists app settings to the database.
 * Merges with defaults before saving to ensure no fields are lost.
 */
function saveSettings(settings: AppSettings): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    'app_settings',
    JSON.stringify(settings)
  );
}

// ─────────────────────────────────────────────
// SESSION CRUD
// ─────────────────────────────────────────────

/**
 * Creates a new session record in the database.
 * Assigns a UUID, sets createdAt/updatedAt to now.
 */
function createSession(
  session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>
): Session {
  const id = uuidv4();
  const now = Date.now();
  const newSession: Session = { ...session, id, createdAt: now, updatedAt: now };

  db.prepare(`
    INSERT INTO sessions (
      id, uid, fbName, profileUrl, password, cookie, twoFactorSecret,
      country, phoneNumber, email, dateOfBirth, gender, creationDate,
      bmCount, bmRoles, bmRestrictionStatus, ownedPages, pagesFollowingCount,
      groupsJoinedCount, groupRoles, bmData, ownedPagesData, joinedGroupsData,
      adAccountId, currency, timezone, spendingLimit, currentThreshold,
      accountBalance, totalSpent, billingDate, paymentMethod,
      friendsCount, professionalMode, monetizationStatus,
      healthStatus, scrapingStatus, scrapedAt,
      proxyId, lastCheck, createdAt, updatedAt
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    )
  `).run(
    newSession.id, newSession.uid, newSession.fbName, newSession.profileUrl ?? null,
    newSession.password ?? null, newSession.cookie, newSession.twoFactorSecret ?? null,
    newSession.country, newSession.phoneNumber ?? null, newSession.email ?? null,
    newSession.dateOfBirth ?? null, newSession.gender ?? null, newSession.creationDate ?? null,
    newSession.bmCount, newSession.bmRoles, newSession.bmRestrictionStatus,
    newSession.ownedPages, newSession.pagesFollowingCount,
    newSession.groupsJoinedCount, newSession.groupRoles,
    newSession.bmData ?? '[]', newSession.ownedPagesData ?? '[]', newSession.joinedGroupsData ?? '[]',
    newSession.adAccountId ?? null, newSession.currency ?? null, newSession.timezone ?? null,
    newSession.spendingLimit ?? null, newSession.currentThreshold ?? null,
    newSession.accountBalance ?? null, newSession.totalSpent ?? null,
    newSession.billingDate ?? null, newSession.paymentMethod ?? null,
    newSession.friendsCount,
    newSession.professionalMode ? 1 : 0,
    newSession.monetizationStatus ? 1 : 0,
    newSession.healthStatus, newSession.scrapingStatus ?? 'pending', newSession.scrapedAt ?? null,
    newSession.proxyId ?? null, newSession.lastCheck, newSession.createdAt, newSession.updatedAt
  );

  return newSession;
}

/** Returns all sessions ordered by creation date descending. */
function getSessions(): Session[] {
  const rows = db
    .prepare('SELECT * FROM sessions ORDER BY createdAt DESC')
    .all() as Record<string, unknown>[];
  return rows.map(deserializeSession);
}

/** Returns a single session by ID, or undefined if not found. */
function getSessionById(id: string): Session | undefined {
  const row = db
    .prepare('SELECT * FROM sessions WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined;
  return row ? deserializeSession(row) : undefined;
}

/** Returns a single session by Facebook UID, or undefined if not found. */
function getSessionByUid(uid: string): Session | undefined {
  const row = db
    .prepare('SELECT * FROM sessions WHERE uid = ?')
    .get(uid) as Record<string, unknown> | undefined;
  return row ? deserializeSession(row) : undefined;
}

/**
 * Updates specified fields on a session.
 * Always updates `updatedAt` to now.
 *
 * Country lock: when `proxyId` is provided and non-null, the session's `country`
 * is automatically set to match the proxy's country. This keeps the session's
 * geographic identity in sync with its network exit point.
 *
 * @param id      - The session ID to update.
 * @param updates - Partial session fields to apply.
 * @returns The updated Session object, or undefined if not found.
 *
 * @example
 * db_.updateSession(session.id, { healthStatus: 'checkpoint' })
 * db_.updateSession(session.id, { proxyId: proxy.id }) // also updates country
 */
function updateSession(
  id: string,
  updates: Partial<Session>
): Session | undefined {
  const session = getSessionById(id);
  if (!session) return undefined;

  // Country lock: when a new proxy is assigned, inherit its country automatically.
  // This ensures the session's country always reflects its network exit point.
  const resolvedUpdates: Partial<Session> = { ...updates };
  if ('proxyId' in updates && updates.proxyId != null) {
    const proxy = db
      .prepare('SELECT country FROM proxies WHERE id = ?')
      .get(updates.proxyId) as { country: string } | undefined;
    if (proxy) {
      resolvedUpdates.country = proxy.country;
    }
  }

  const updated: Session = { ...session, ...resolvedUpdates, updatedAt: Date.now() };

  // Exclude runtime-only fields and immutable fields from the UPDATE
  const excluded = new Set(['id', 'createdAt', 'state', 'isRunning', 'warmUpScore']);
  const fields = Object.keys(resolvedUpdates).filter((k) => !excluded.has(k));

  if (fields.length === 0) return updated;

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => {
    const val = (updated as unknown as Record<string, unknown>)[f];
    // SQLite stores booleans as integers
    if (typeof val === 'boolean') return val ? 1 : 0;
    return val ?? null;
  });

  db.prepare(`UPDATE sessions SET ${setClause}, updatedAt = ? WHERE id = ?`).run(
    ...values,
    updated.updatedAt,
    id
  );

  return updated;
}

/**
 * Deletes a session by ID.
 * Returns true if a row was deleted, false if not found.
 */
function deleteSession(id: string): boolean {
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Returns aggregated session counts grouped by country.
 * Used by the Dashboard Session Bank widget.
 */
function getSessionsByCountry(): CountrySessionStats[] {
  const rows = db.prepare(`
    SELECT
      country,
      COUNT(*) as total,
      SUM(CASE WHEN healthStatus = 'live'        THEN 1 ELSE 0 END) as live,
      SUM(CASE WHEN healthStatus = 'checkpoint'  THEN 1 ELSE 0 END) as checkpoint,
      SUM(CASE WHEN healthStatus = 'restricted'  THEN 1 ELSE 0 END) as restricted,
      SUM(CASE WHEN healthStatus = 'dead'        THEN 1 ELSE 0 END) as dead
    FROM sessions
    GROUP BY country
    ORDER BY total DESC
  `).all() as Array<{
    country: string;
    total: number;
    live: number;
    checkpoint: number;
    restricted: number;
    dead: number;
  }>;

  return rows.map((row) => ({
    ...row,
    flag: countryCodeToFlag(row.country),
  }));
}

/**
 * Converts a 2-letter ISO country code to a Unicode flag emoji.
 * Falls back to 🌐 for unknown codes.
 */
function countryCodeToFlag(countryCode: string): string {
  const code = countryCode.toUpperCase();
  if (code.length !== 2) return '🌐';
  const codePoints = [...code].map(
    (char) => 127397 + char.charCodeAt(0)
  );
  return String.fromCodePoint(...codePoints);
}

/**
 * Converts a raw SQLite row to a typed Session object.
 * Handles boolean coercion (SQLite stores 0/1 for booleans).
 */
function deserializeSession(row: Record<string, unknown>): Session {
  return {
    ...(row as unknown as Session),
    professionalMode: row['professionalMode'] === 1,
    monetizationStatus: row['monetizationStatus'] === 1,
    bmData: (row['bmData'] as string) ?? '[]',
    ownedPagesData: (row['ownedPagesData'] as string) ?? '[]',
    joinedGroupsData: (row['joinedGroupsData'] as string) ?? '[]',
  };
}

// ─────────────────────────────────────────────
// PROXY CRUD
// ─────────────────────────────────────────────

/** Creates a new proxy record. */
function createProxy(proxy: Omit<Proxy, 'id' | 'createdAt'>): Proxy {
  const id = uuidv4();
  const newProxy: Proxy = { ...proxy, id, createdAt: Date.now() };

  db.prepare(`
    INSERT INTO proxies (id, host, port, username, password, protocol, country, isActive, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newProxy.id, newProxy.host, newProxy.port,
    newProxy.username ?? null, newProxy.password ?? null,
    newProxy.protocol, newProxy.country,
    newProxy.isActive ? 1 : 0, newProxy.createdAt
  );

  return newProxy;
}

/** Returns all active proxies. */
function getProxies(): Proxy[] {
  return db
    .prepare('SELECT * FROM proxies WHERE isActive = 1')
    .all() as Proxy[];
}

/**
 * Returns all active proxies for a specific country.
 *
 * @param country - ISO country code to filter by (e.g. 'US', 'GB').
 * @returns Array of active Proxy records matching the given country.
 *
 * @example
 * const usProxies = db_.getProxiesByCountry('US') // → Proxy[]
 */
function getProxiesByCountry(country: string): Proxy[] {
  return db
    .prepare('SELECT * FROM proxies WHERE isActive = 1 AND country = ?')
    .all(country) as Proxy[];
}

/**
 * Returns active proxies for a country that are not currently assigned to any session.
 * Used for round-robin bulk assignment — ensures each proxy is only given to one session.
 *
 * @param country - ISO country code to filter by (e.g. 'US', 'GB').
 * @returns Array of unassigned active Proxy records for the given country.
 *
 * @example
 * const freeProxies = db_.getAvailableProxiesByCountry('US') // → Proxy[]
 */
function getAvailableProxiesByCountry(country: string): Proxy[] {
  return db.prepare(`
    SELECT p.* FROM proxies p
    WHERE p.isActive = 1
      AND p.country = ?
      AND p.id NOT IN (SELECT proxyId FROM sessions WHERE proxyId IS NOT NULL)
  `).all(country) as Proxy[];
}

/**
 * Updates specified fields on a proxy record.
 * Returns the updated proxy, or undefined if not found.
 *
 * @param id      - The proxy ID to update.
 * @param updates - Partial proxy fields to apply.
 * @returns The updated Proxy object, or undefined if not found.
 *
 * @example
 * db_.updateProxy(proxy.id, { country: 'US' })
 */
function updateProxy(id: string, updates: Partial<Omit<Proxy, 'id' | 'createdAt'>>): Proxy | undefined {
  const existing = db
    .prepare('SELECT * FROM proxies WHERE id = ?')
    .get(id) as Proxy | undefined;
  if (!existing) return undefined;

  const updated: Proxy = { ...existing, ...updates };
  const fields = Object.keys(updates) as Array<keyof typeof updates>;
  if (fields.length === 0) return updated;

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => {
    const val = updated[f];
    if (typeof val === 'boolean') return val ? 1 : 0;
    return val ?? null;
  });

  db.prepare(`UPDATE proxies SET ${setClause} WHERE id = ?`).run(...values, id);
  return updated;
}

/**
 * Deletes a proxy and sets proxyId to NULL on all sessions that used it.
 * Returns true if the proxy was found and deleted.
 */
function deleteProxy(id: string): boolean {
  // Null out sessions that reference this proxy
  db.prepare("UPDATE sessions SET proxyId = NULL WHERE proxyId = ?").run(id);
  const result = db.prepare('DELETE FROM proxies WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────
// ACTIVITY LOG CRUD
// ─────────────────────────────────────────────

/**
 * Inserts an activity log entry.
 * Pass null for sessionId for system-level events.
 */
function logActivity(
  sessionId: string | null,
  action: string,
  details: string,
  campaignId?: string
): ActivityLog {
  const log: ActivityLog = {
    id: uuidv4(),
    sessionId: sessionId ?? '',
    action,
    details,
    campaignId,
    timestamp: Date.now(),
  };

  db.prepare(
    'INSERT INTO activity_logs (id, sessionId, action, details, campaignId, timestamp) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(log.id, log.sessionId, log.action, log.details, log.campaignId ?? null, log.timestamp);

  return log;
}

/**
 * Returns activity logs, optionally filtered by session.
 * Results are ordered newest-first.
 */
function getActivityLogs(sessionId?: string, limit = 100): ActivityLog[] {
  if (sessionId) {
    return db
      .prepare('SELECT * FROM activity_logs WHERE sessionId = ? ORDER BY timestamp DESC LIMIT ?')
      .all(sessionId, limit) as ActivityLog[];
  }
  return db
    .prepare('SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?')
    .all(limit) as ActivityLog[];
}

// ─────────────────────────────────────────────
// CAMPAIGN CRUD
// ─────────────────────────────────────────────

/** Creates a new campaign record with status 'pending'. */
function createCampaign(
  campaign: Omit<Campaign, 'id' | 'createdAt' | 'updatedAt'>
): Campaign {
  const id = uuidv4();
  const now = Date.now();
  const newCampaign: Campaign = { ...campaign, id, createdAt: now, updatedAt: now };

  db.prepare(`
    INSERT INTO campaigns (id, name, type, status, config, createdAt, updatedAt, completedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newCampaign.id, newCampaign.name, newCampaign.type,
    newCampaign.status, newCampaign.config,
    newCampaign.createdAt, newCampaign.updatedAt,
    newCampaign.completedAt ?? null
  );

  return newCampaign;
}

/**
 * Returns the total count of campaigns matching the given filters.
 * Used alongside getCampaigns for pagination metadata.
 *
 * @param filters - Optional status and type filters.
 * @returns Total number of matching campaigns.
 *
 * @example
 * const total = getCampaignsCount({ status: 'running' }) // → 3
 */
function getCampaignsCount(filters?: { status?: string; type?: string }): number {
  let query = 'SELECT COUNT(*) as count FROM campaigns WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters?.type) {
    query += ' AND type = ?';
    params.push(filters.type);
  }

  const row = db.prepare(query).get(...params) as { count: number };
  return row.count;
}

/** Returns all campaigns, optionally filtered by status and/or type. */
function getCampaigns(filters?: {
  status?: string;
  type?: string;
  page?: number;
  limit?: number;
}): Campaign[] {
  const page = filters?.page ?? 1;
  const limit = filters?.limit ?? 50;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM campaigns WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.status) {
    query += ' AND status = ?';
    params.push(filters.status);
  }
  if (filters?.type) {
    query += ' AND type = ?';
    params.push(filters.type);
  }

  query += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  return db.prepare(query).all(...params) as Campaign[];
}

/** Returns a single campaign by ID, or undefined if not found. */
function getCampaignById(id: string): Campaign | undefined {
  return db
    .prepare('SELECT * FROM campaigns WHERE id = ?')
    .get(id) as Campaign | undefined;
}

/** Updates campaign fields. Always updates updatedAt. */
function updateCampaign(id: string, updates: Partial<Campaign>): Campaign | undefined {
  const campaign = getCampaignById(id);
  if (!campaign) return undefined;

  const updated: Campaign = { ...campaign, ...updates, updatedAt: Date.now() };
  const excluded = new Set(['id', 'createdAt']);
  const fields = Object.keys(updates).filter((k) => !excluded.has(k));

  if (fields.length === 0) return updated;

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (updated as unknown as Record<string, unknown>)[f] ?? null);

  db.prepare(`UPDATE campaigns SET ${setClause}, updatedAt = ? WHERE id = ?`).run(
    ...values, updated.updatedAt, id
  );

  return updated;
}

/** Deletes a campaign and all its tasks. */
function deleteCampaign(id: string): boolean {
  db.prepare('DELETE FROM campaign_tasks WHERE campaignId = ?').run(id);
  const result = db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────
// CAMPAIGN TASK CRUD
// ─────────────────────────────────────────────

/** Creates a new campaign task with status 'pending'. */
function createCampaignTask(
  task: Omit<CampaignTask, 'id'>
): CampaignTask {
  const id = uuidv4();
  const newTask: CampaignTask = { ...task, id };

  db.prepare(`
    INSERT INTO campaign_tasks (id, campaignId, sessionId, action, status, result, error, startedAt, completedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newTask.id, newTask.campaignId, newTask.sessionId, newTask.action,
    newTask.status, newTask.result ?? null, newTask.error ?? null,
    newTask.startedAt ?? null, newTask.completedAt ?? null
  );

  return newTask;
}

/** Returns all tasks for a campaign. */
function getCampaignTasks(campaignId: string): CampaignTask[] {
  return db
    .prepare('SELECT * FROM campaign_tasks WHERE campaignId = ? ORDER BY rowid ASC')
    .all(campaignId) as CampaignTask[];
}

/** Updates a campaign task's status and optional result/error fields. */
function updateCampaignTask(
  id: string,
  updates: Partial<CampaignTask>
): CampaignTask | undefined {
  const task = db
    .prepare('SELECT * FROM campaign_tasks WHERE id = ?')
    .get(id) as CampaignTask | undefined;
  if (!task) return undefined;

  const updated: CampaignTask = { ...task, ...updates };
  const excluded = new Set(['id', 'campaignId', 'sessionId']);
  const fields = Object.keys(updates).filter((k) => !excluded.has(k));

  if (fields.length === 0) return updated;

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (updated as unknown as Record<string, unknown>)[f] ?? null);

  db.prepare(`UPDATE campaign_tasks SET ${setClause} WHERE id = ?`).run(...values, id);
  return updated;
}

// ─────────────────────────────────────────────
// PARKED ASSETS CRUD
// ─────────────────────────────────────────────

/** Creates a new parked asset record. */
function createParkedAsset(
  asset: Omit<ParkedAsset, 'id' | 'createdAt'>
): ParkedAsset {
  const id = uuidv4();
  const newAsset: ParkedAsset = { ...asset, id, createdAt: Date.now() };

  db.prepare(`
    INSERT INTO parked_assets (id, type, assetId, assetName, creatorSessionId, parkingSessionId, transferStatus, createdAt, transferredAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newAsset.id, newAsset.type, newAsset.assetId, newAsset.assetName,
    newAsset.creatorSessionId, newAsset.parkingSessionId,
    newAsset.transferStatus, newAsset.createdAt, newAsset.transferredAt ?? null
  );

  return newAsset;
}

/** Returns parked assets, optionally filtered by type. */
function getParkedAssets(type?: 'page' | 'bm'): ParkedAsset[] {
  if (type) {
    return db
      .prepare('SELECT * FROM parked_assets WHERE type = ? ORDER BY createdAt DESC')
      .all(type) as ParkedAsset[];
  }
  return db
    .prepare('SELECT * FROM parked_assets ORDER BY createdAt DESC')
    .all() as ParkedAsset[];
}

/** Updates a parked asset's transfer status. */
function updateParkedAsset(
  id: string,
  updates: Partial<ParkedAsset>
): ParkedAsset | undefined {
  const asset = db
    .prepare('SELECT * FROM parked_assets WHERE id = ?')
    .get(id) as ParkedAsset | undefined;
  if (!asset) return undefined;

  const updated: ParkedAsset = { ...asset, ...updates };
  const excluded = new Set(['id', 'createdAt']);
  const fields = Object.keys(updates).filter((k) => !excluded.has(k));

  if (fields.length === 0) return updated;

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (updated as unknown as Record<string, unknown>)[f] ?? null);

  db.prepare(`UPDATE parked_assets SET ${setClause} WHERE id = ?`).run(...values, id);
  return updated;
}

/** Deletes a parked asset record. */
function deleteParkedAsset(id: string): boolean {
  const result = db.prepare('DELETE FROM parked_assets WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────
// SELECTOR CACHE CRUD
// ─────────────────────────────────────────────

/**
 * Inserts or updates a selector cache entry.
 * If the elementKey already exists, updates the selector and increments healCount.
 */
function upsertSelectorCache(
  elementKey: string,
  cssSelector: string
): SelectorCache {
  const existing = db
    .prepare('SELECT * FROM selector_cache WHERE elementKey = ?')
    .get(elementKey) as SelectorCache | undefined;

  const now = Date.now();

  if (existing) {
    db.prepare(`
      UPDATE selector_cache
      SET cssSelector = ?, lastVerified = ?, healCount = healCount + 1
      WHERE elementKey = ?
    `).run(cssSelector, now, elementKey);

    return { ...existing, cssSelector, lastVerified: now, healCount: existing.healCount + 1 };
  }

  const id = uuidv4();
  const entry: SelectorCache = { id, elementKey, cssSelector, lastVerified: now, healCount: 0 };

  db.prepare(`
    INSERT INTO selector_cache (id, elementKey, cssSelector, lastVerified, healCount)
    VALUES (?, ?, ?, ?, ?)
  `).run(entry.id, entry.elementKey, entry.cssSelector, entry.lastVerified, entry.healCount);

  return entry;
}

/** Returns all selector cache entries. */
function getSelectorCache(): SelectorCache[] {
  return db
    .prepare('SELECT * FROM selector_cache ORDER BY lastVerified DESC')
    .all() as SelectorCache[];
}

/**
 * Returns a fresh selector cache entry for an element key.
 * Returns undefined if no entry exists or if the entry is stale (> 24 hours old).
 */
function getFreshSelector(elementKey: string): SelectorCache | undefined {
  const SELECTOR_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
  const entry = db
    .prepare('SELECT * FROM selector_cache WHERE elementKey = ?')
    .get(elementKey) as SelectorCache | undefined;

  if (!entry) return undefined;
  if (Date.now() - entry.lastVerified > SELECTOR_CACHE_TTL_MS) return undefined;
  return entry;
}

/** Deletes a selector cache entry by ID. */
function deleteSelectorCacheEntry(id: string): boolean {
  const result = db.prepare('DELETE FROM selector_cache WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────
// CONTACT CRUD
// ─────────────────────────────────────────────

/**
 * Inserts or updates a contact by Facebook UID.
 * If the contact already exists, updates fbName, profileUrl, and lastInteraction.
 * Returns the contact record.
 */
function upsertContact(
  fbUid: string,
  data: Partial<Omit<Contact, 'id' | 'fbUid' | 'createdAt'>> & { firstSeenVia?: string }
): Contact {
  const existing = db
    .prepare('SELECT * FROM contacts WHERE fbUid = ?')
    .get(fbUid) as Contact | undefined;

  const now = Date.now();

  if (existing) {
    const updated: Contact = {
      ...existing,
      fbName: data.fbName ?? existing.fbName,
      profileUrl: data.profileUrl ?? existing.profileUrl,
      lastInteraction: now,
      updatedAt: now,
    };

    db.prepare(`
      UPDATE contacts SET fbName = ?, profileUrl = ?, lastInteraction = ?, updatedAt = ?
      WHERE fbUid = ?
    `).run(updated.fbName ?? null, updated.profileUrl ?? null, now, now, fbUid);

    return updated;
  }

  const id = uuidv4();
  const newContact: Contact = {
    id,
    fbUid,
    fbName: data.fbName,
    profileUrl: data.profileUrl,
    tags: data.tags ?? '[]',
    notes: data.notes ?? '',
    firstSeenVia: data.firstSeenVia,
    lastInteraction: now,
    createdAt: now,
    updatedAt: now,
  };

  db.prepare(`
    INSERT INTO contacts (id, fbUid, fbName, profileUrl, tags, notes, firstSeenVia, lastInteraction, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    newContact.id, newContact.fbUid, newContact.fbName ?? null,
    newContact.profileUrl ?? null, newContact.tags, newContact.notes,
    newContact.firstSeenVia ?? null, newContact.lastInteraction,
    newContact.createdAt, newContact.updatedAt
  );

  return newContact;
}

/** Returns contacts with optional filters. */
function getContacts(filters?: {
  tag?: string;
  sessionId?: string;
  recencyDays?: number;
}): Contact[] {
  let query = 'SELECT * FROM contacts WHERE 1=1';
  const params: unknown[] = [];

  if (filters?.tag) {
    // JSON array contains check
    query += " AND tags LIKE ?";
    params.push(`%"${filters.tag}"%`);
  }
  if (filters?.recencyDays) {
    const cutoff = Date.now() - filters.recencyDays * 24 * 60 * 60 * 1_000;
    query += ' AND lastInteraction >= ?';
    params.push(cutoff);
  }

  query += ' ORDER BY lastInteraction DESC';
  return db.prepare(query).all(...params) as Contact[];
}

/** Returns a single contact by ID, or undefined if not found. */
function getContactById(id: string): Contact | undefined {
  return db
    .prepare('SELECT * FROM contacts WHERE id = ?')
    .get(id) as Contact | undefined;
}

/** Updates contact tags and/or notes. */
function updateContact(id: string, updates: Pick<Contact, 'tags' | 'notes'>): Contact | undefined {
  const contact = getContactById(id);
  if (!contact) return undefined;

  const updated: Contact = { ...contact, ...updates, updatedAt: Date.now() };
  db.prepare('UPDATE contacts SET tags = ?, notes = ?, updatedAt = ? WHERE id = ?').run(
    updated.tags, updated.notes, updated.updatedAt, id
  );
  return updated;
}

/** Deletes a contact and all their interaction records. */
function deleteContact(id: string): boolean {
  db.prepare('DELETE FROM contact_interactions WHERE contactId = ?').run(id);
  const result = db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────
// CONTACT INTERACTION CRUD
// ─────────────────────────────────────────────

/** Records a new interaction with a contact. */
function insertContactInteraction(
  interaction: Omit<ContactInteraction, 'id'>
): ContactInteraction {
  const id = uuidv4();
  const newInteraction: ContactInteraction = { ...interaction, id };

  db.prepare(`
    INSERT INTO contact_interactions (id, contactId, sessionId, type, content, direction, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    newInteraction.id, newInteraction.contactId, newInteraction.sessionId,
    newInteraction.type, newInteraction.content ?? null,
    newInteraction.direction, newInteraction.timestamp
  );

  return newInteraction;
}

/** Returns all interactions for a contact, ordered newest-first. */
function getContactInteractions(contactId: string): ContactInteraction[] {
  return db
    .prepare('SELECT * FROM contact_interactions WHERE contactId = ? ORDER BY timestamp DESC')
    .all(contactId) as ContactInteraction[];
}

// ─────────────────────────────────────────────
// WARM-UP JOB CRUD
// ─────────────────────────────────────────────

/** Creates a new warm-up job. */
function createWarmUpJob(
  job: Omit<WarmUpJob, 'id' | 'createdAt'>
): WarmUpJob {
  const id = uuidv4();
  const newJob: WarmUpJob = { ...job, id, createdAt: Date.now() };

  db.prepare(`
    INSERT INTO warmup_jobs (id, mode, sessionIds, config, status, createdAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    newJob.id, newJob.mode, newJob.sessionIds,
    newJob.config, newJob.status, newJob.createdAt
  );

  return newJob;
}

/** Returns all warm-up jobs ordered by creation date descending. */
function getWarmUpJobs(): WarmUpJob[] {
  return db
    .prepare('SELECT * FROM warmup_jobs ORDER BY createdAt DESC')
    .all() as WarmUpJob[];
}

/**
 * Returns a single warm-up job by ID.
 *
 * @param id - The warm-up job UUID.
 * @returns The WarmUpJob record, or undefined if not found.
 *
 * @example
 * const job = db_.getWarmUpJobById('some-uuid')
 */
function getWarmUpJobById(id: string): WarmUpJob | undefined {
  return db
    .prepare('SELECT * FROM warmup_jobs WHERE id = ?')
    .get(id) as WarmUpJob | undefined;
}

/** Updates a warm-up job's status. */
function updateWarmUpJob(
  id: string,
  updates: Partial<Pick<WarmUpJob, 'status' | 'sessionIds' | 'config'>>
): WarmUpJob | undefined {
  const job = db
    .prepare('SELECT * FROM warmup_jobs WHERE id = ?')
    .get(id) as WarmUpJob | undefined;
  if (!job) return undefined;

  const updated: WarmUpJob = { ...job, ...updates };
  const fields = Object.keys(updates);
  if (fields.length === 0) return updated;

  const setClause = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => (updated as unknown as Record<string, unknown>)[f]);

  db.prepare(`UPDATE warmup_jobs SET ${setClause} WHERE id = ?`).run(...values, id);
  return updated;
}

/** Deletes a warm-up job. */
function deleteWarmUpJob(id: string): boolean {
  const result = db.prepare('DELETE FROM warmup_jobs WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────
// RECORDED WORKFLOW CRUD
// ─────────────────────────────────────────────

/**
 * Creates a new recorded workflow in the database.
 * Assigns a UUID and sets createdAt/updatedAt to now.
 *
 * @param workflow - Workflow data without id, createdAt, updatedAt.
 * @returns The newly created RecordedWorkflow record.
 *
 * @example
 * const wf = db_.createRecordedWorkflow({ name: 'Login Flow', sessionId: 'abc', steps: '[]' })
 */
function createRecordedWorkflow(
  workflow: Omit<RecordedWorkflow, 'id' | 'createdAt' | 'updatedAt'>
): RecordedWorkflow {
  const id = uuidv4();
  const now = Date.now();
  const newWorkflow: RecordedWorkflow = { ...workflow, id, createdAt: now, updatedAt: now };

  db.prepare(`
    INSERT INTO recorded_workflows (id, name, sessionId, steps, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    newWorkflow.id,
    newWorkflow.name,
    newWorkflow.sessionId,
    newWorkflow.steps,
    newWorkflow.createdAt,
    newWorkflow.updatedAt
  );

  return newWorkflow;
}

/**
 * Returns all recorded workflows ordered by creation date descending.
 *
 * @returns Array of RecordedWorkflow records.
 *
 * @example
 * const workflows = db_.getRecordedWorkflows()
 */
function getRecordedWorkflows(): RecordedWorkflow[] {
  return db
    .prepare('SELECT * FROM recorded_workflows ORDER BY createdAt DESC')
    .all() as RecordedWorkflow[];
}

/**
 * Returns a single recorded workflow by ID.
 *
 * @param id - The workflow UUID.
 * @returns The RecordedWorkflow record, or undefined if not found.
 *
 * @example
 * const wf = db_.getRecordedWorkflowById('some-uuid')
 */
function getRecordedWorkflowById(id: string): RecordedWorkflow | undefined {
  return db
    .prepare('SELECT * FROM recorded_workflows WHERE id = ?')
    .get(id) as RecordedWorkflow | undefined;
}

/**
 * Deletes a recorded workflow by ID.
 *
 * @param id - The workflow UUID to delete.
 * @returns True if a row was deleted, false if not found.
 *
 * @example
 * const deleted = db_.deleteRecordedWorkflow('some-uuid')
 */
function deleteRecordedWorkflow(id: string): boolean {
  const result = db.prepare('DELETE FROM recorded_workflows WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The single database access object for the entire application.
 * Import this in server modules — never use the raw `db` instance outside this file.
 */
export const db_ = {
  // Settings
  getSettings,
  saveSettings,

  // Sessions
  createSession,
  getSessions,
  getSessionById,
  getSessionByUid,
  updateSession,
  deleteSession,
  getSessionsByCountry,

  // Proxies
  createProxy,
  getProxies,
  getProxiesByCountry,
  getAvailableProxiesByCountry,
  updateProxy,
  deleteProxy,

  // Activity logs
  logActivity,
  getActivityLogs,

  // Campaigns
  createCampaign,
  getCampaigns,
  getCampaignsCount,
  getCampaignById,
  updateCampaign,
  deleteCampaign,

  // Campaign tasks
  createCampaignTask,
  getCampaignTasks,
  updateCampaignTask,

  // Parked assets
  createParkedAsset,
  getParkedAssets,
  updateParkedAsset,
  deleteParkedAsset,

  // Selector cache
  upsertSelectorCache,
  getSelectorCache,
  getFreshSelector,
  deleteSelectorCacheEntry,

  // Contacts
  upsertContact,
  getContacts,
  getContactById,
  updateContact,
  deleteContact,

  // Contact interactions
  insertContactInteraction,
  getContactInteractions,

  // Warm-up jobs
  createWarmUpJob,
  getWarmUpJobs,
  getWarmUpJobById,
  updateWarmUpJob,
  deleteWarmUpJob,

  // Recorded workflows
  createRecordedWorkflow,
  getRecordedWorkflows,
  getRecordedWorkflowById,
  deleteRecordedWorkflow,
};
