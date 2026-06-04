/**
 * Flogination V5 — Optional MongoDB Client
 *
 * Provides an optional MongoDB layer for high-volume writes that would
 * bottleneck SQLite during mass automation runs (1000+ sessions, bulk campaigns).
 *
 * Architecture:
 *  - SQLite remains the source of truth for sessions, settings, and campaigns.
 *  - MongoDB handles high-volume append-only data: activity logs and campaign results.
 *  - If MongoDB is not configured (mongoUri is empty), all writes fall back to SQLite.
 *  - If a MongoDB write fails, it falls back to SQLite and logs a warning.
 *
 * Configuration:
 *  Set `mongoUri` in app settings, e.g.:
 *  "mongodb://localhost:27017/flogination"
 *  "mongodb+srv://user:pass@cluster.mongodb.net/flogination"
 *
 * Collections:
 *  - activity_logs    → high-frequency session event logs
 *  - campaign_results → per-task outcomes, scraped UIDs, comment deliveries
 */

import mongoose, { Schema, Document, Model } from 'mongoose';
import { db_ } from '../database';
import type { ActivityLog } from '../../types';

// ─────────────────────────────────────────────
// CONNECTION STATE
// ─────────────────────────────────────────────

/** Tracks whether a MongoDB connection is currently active. */
let connected = false;

/** Tracks whether a connection attempt is in progress (prevents duplicate attempts). */
let connecting = false;

// ─────────────────────────────────────────────
// MONGOOSE SCHEMAS
// ─────────────────────────────────────────────

/** MongoDB document shape for activity log entries. */
interface ActivityLogDocument extends Document {
  sessionId: string;
  action: string;
  details: string;
  campaignId?: string;
  timestamp: Date;
}

const activityLogSchema = new Schema<ActivityLogDocument>(
  {
    sessionId:  { type: String, required: true, index: true },
    action:     { type: String, required: true },
    details:    { type: String, default: '' },
    campaignId: { type: String, default: null },
    timestamp:  { type: Date,   required: true, index: true },
  },
  {
    // Disable Mongoose's default __v version key — we don't need it
    versionKey: false,
    // Use the collection name explicitly to avoid pluralisation surprises
    collection: 'activity_logs',
  }
);

/** MongoDB document shape for campaign result entries. */
interface CampaignResultDocument extends Document {
  campaignId: string;
  taskId: string;
  sessionId: string;
  action: string;
  outcome: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

const campaignResultSchema = new Schema<CampaignResultDocument>(
  {
    campaignId: { type: String, required: true, index: true },
    taskId:     { type: String, required: true },
    sessionId:  { type: String, required: true, index: true },
    action:     { type: String, required: true },
    outcome:    { type: String, required: true },
    data:       { type: Schema.Types.Mixed, default: {} },
    timestamp:  { type: Date, required: true, index: true },
  },
  {
    versionKey: false,
    collection: 'campaign_results',
  }
);

// Lazy model references — only created after connection is established
let ActivityLogModel: Model<ActivityLogDocument> | null = null;
let CampaignResultModel: Model<CampaignResultDocument> | null = null;

// ─────────────────────────────────────────────
// CONNECTION MANAGEMENT
// ─────────────────────────────────────────────

/**
 * Establishes a MongoDB connection using the URI from app settings.
 * Safe to call multiple times — skips if already connected or connecting.
 * Silently skips if `mongoUri` is not configured.
 *
 * @example
 * await mongoClient.connect()
 * // Logs: "[mongo-client] Connected to MongoDB"
 */
async function connect(): Promise<void> {
  if (connected || connecting) return;

  const settings = db_.getSettings();
  const uri = settings.mongoUri?.trim();

  if (!uri) {
    // MongoDB not configured — SQLite handles everything
    return;
  }

  connecting = true;

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 10_000,
    });

    // Register models after connection
    ActivityLogModel = mongoose.model<ActivityLogDocument>('ActivityLog', activityLogSchema);
    CampaignResultModel = mongoose.model<CampaignResultDocument>('CampaignResult', campaignResultSchema);

    connected = true;
    console.log('[mongo-client] Connected to MongoDB');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[mongo-client] Failed to connect to MongoDB: ${message}. Falling back to SQLite.`);
    connected = false;
  } finally {
    connecting = false;
  }
}

/**
 * Closes the MongoDB connection gracefully.
 * Called on application shutdown.
 */
async function disconnect(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
  ActivityLogModel = null;
  CampaignResultModel = null;
  console.log('[mongo-client] Disconnected from MongoDB');
}

/**
 * Returns true if MongoDB is currently connected and ready for writes.
 */
function isConnected(): boolean {
  return connected && mongoose.connection.readyState === 1;
}

// ─────────────────────────────────────────────
// WRITE OPERATIONS
// ─────────────────────────────────────────────

/**
 * Writes an activity log entry to MongoDB.
 * Falls back to SQLite if MongoDB is not connected or if the write fails.
 *
 * @param sessionId  - The session this event belongs to (null for system events).
 * @param action     - Short action identifier, e.g. 'session_launched'.
 * @param details    - Human-readable description of the event.
 * @param campaignId - Optional campaign this event is associated with.
 *
 * @example
 * await mongoClient.logActivity('session-uuid', 'comment_posted', 'Posted on post XYZ', 'campaign-uuid')
 */
async function logActivity(
  sessionId: string | null,
  action: string,
  details: string,
  campaignId?: string
): Promise<void> {
  if (!isConnected() || !ActivityLogModel) {
    // MongoDB not available — use SQLite
    db_.logActivity(sessionId, action, details, campaignId);
    return;
  }

  try {
    await ActivityLogModel.create({
      sessionId: sessionId ?? '',
      action,
      details,
      campaignId: campaignId ?? null,
      timestamp: new Date(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[mongo-client] MongoDB write failed, falling back to SQLite: ${message}`);
    db_.logActivity(sessionId, action, details, campaignId);
  }
}

/**
 * Writes a campaign result entry to MongoDB.
 * Falls back to SQLite activity log if MongoDB is not connected or write fails.
 *
 * @param entry - The campaign result data to persist.
 *
 * @example
 * await mongoClient.writeCampaignResult({
 *   campaignId: 'campaign-uuid',
 *   taskId: 'task-uuid',
 *   sessionId: 'session-uuid',
 *   action: 'comment_posted',
 *   outcome: 'success',
 *   data: { postUrl: 'https://...', commentText: 'Check this out!' },
 * })
 */
async function writeCampaignResult(entry: {
  campaignId: string;
  taskId: string;
  sessionId: string;
  action: string;
  outcome: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  if (!isConnected() || !CampaignResultModel) {
    // MongoDB not available — log to SQLite as activity entry
    db_.logActivity(
      entry.sessionId,
      `campaign_result_${entry.action}`,
      JSON.stringify({ outcome: entry.outcome, ...entry.data }),
      entry.campaignId
    );
    return;
  }

  try {
    await CampaignResultModel.create({
      ...entry,
      data: entry.data ?? {},
      timestamp: new Date(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[mongo-client] MongoDB campaign result write failed, falling back to SQLite: ${message}`);
    db_.logActivity(
      entry.sessionId,
      `campaign_result_${entry.action}`,
      JSON.stringify({ outcome: entry.outcome, ...entry.data }),
      entry.campaignId
    );
  }
}

// ─────────────────────────────────────────────
// READ OPERATIONS
// ─────────────────────────────────────────────

/**
 * Reads activity logs from MongoDB (if connected) or SQLite (fallback).
 * Supports the same sessionId filter and limit as the SQLite version.
 *
 * @param sessionId - Optional session ID to filter by.
 * @param limit     - Maximum number of entries to return (default: 100).
 * @returns Array of ActivityLog entries, ordered newest-first.
 */
async function getActivityLogs(
  sessionId?: string,
  limit = 100
): Promise<ActivityLog[]> {
  if (!isConnected() || !ActivityLogModel) {
    return db_.getActivityLogs(sessionId, limit);
  }

  try {
    const query = sessionId ? { sessionId } : {};
    const docs = await ActivityLogModel
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    return docs.map((doc) => ({
      id: doc._id.toString(),
      sessionId: doc.sessionId,
      action: doc.action,
      details: doc.details,
      campaignId: doc.campaignId ?? undefined,
      timestamp: new Date(doc.timestamp).getTime(),
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[mongo-client] MongoDB read failed, falling back to SQLite: ${message}`);
    return db_.getActivityLogs(sessionId, limit);
  }
}

// ─────────────────────────────────────────────
// CONNECTION TEST
// ─────────────────────────────────────────────

/**
 * Tests a MongoDB URI without persisting the connection.
 * Used by the Settings page "Test Connection" button.
 *
 * @param uri - The MongoDB connection URI to test.
 * @returns Success with server info, or failure with error message.
 *
 * @example
 * const result = await mongoClient.testConnection('mongodb://localhost:27017/flogination')
 * // → { success: true }  or  { success: false, error: 'Connection refused' }
 */
async function testConnection(uri: string): Promise<{ success: boolean; error?: string }> {
  const testConn = mongoose.createConnection();

  try {
    await testConn.openUri(uri.trim(), {
      serverSelectionTimeoutMS: 5_000,
      connectTimeoutMS: 5_000,
    });
    await testConn.close();
    return { success: true };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The optional MongoDB client for high-volume data persistence.
 * All methods fall back to SQLite gracefully when MongoDB is unavailable.
 *
 * @example
 * import { mongoClient } from '../utils/mongo-client'
 *
 * // On server startup:
 * await mongoClient.connect()
 *
 * // Writing logs (auto-falls back to SQLite if not connected):
 * await mongoClient.logActivity(sessionId, 'comment_posted', 'Posted on viral post')
 */
export const mongoClient = {
  /** Connects to MongoDB using the URI from app settings. No-op if not configured. */
  connect,
  /** Disconnects from MongoDB. Call on server shutdown. */
  disconnect,
  /** Returns true if MongoDB is connected and ready. */
  isConnected,
  /** Writes an activity log entry. Falls back to SQLite on failure. */
  logActivity,
  /** Writes a campaign result entry. Falls back to SQLite on failure. */
  writeCampaignResult,
  /** Reads activity logs from MongoDB or SQLite. */
  getActivityLogs,
  /** Tests a MongoDB URI without persisting the connection. */
  testConnection,
};
