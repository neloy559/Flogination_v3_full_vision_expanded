/**
 * Flogination V5 — Shared TypeScript Interfaces
 *
 * All types used across server and client live here.
 * Import from this file only — never define types inline in modules.
 */

// ─────────────────────────────────────────────
// ENUMS & UNION TYPES
// ─────────────────────────────────────────────

/** Real-time health state of a Facebook account session. */
export type HealthStatus =
  | 'live'          // Fully functional — automation ready
  | 'warming'       // New/untrusted account — needs warm-up before automation
  | 'checkpoint'    // Security checkpoint — phone/email verify required
  | '2fa_required'  // 2FA prompt blocking — needs TOTP or manual resolve
  | 'restricted'    // Partial block — some actions disabled (posting, ads, etc.)
  | 'banned'        // Permanently disabled — appeal possible but account unusable
  | 'dead';         // Session expired — cookie invalid, login required

/** Lifecycle state of the background auto-scraper for a session. */
export type ScrapingStatus = 'pending' | 'scraping' | 'done' | 'failed';

/** Lifecycle state of a browser instance in the session manager. */
export type SessionState = 'idle' | 'launching' | 'active' | 'hibernating' | 'closing';

/** Type of automation campaign. */
export type CampaignType =
  | 'group_hunter'
  | 'comment_engine'
  | 'page_factory'
  | 'bm_factory'
  | 'content_amplifier';

/** Lifecycle state of a campaign job. */
export type CampaignStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/** Lifecycle state of a single task within a campaign. */
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** Transfer state of a parked Facebook asset (page or BM). */
export type TransferStatus = 'pending' | 'transferred' | 'failed';

/** Type of Facebook asset that has been parked. */
export type AssetType = 'page' | 'bm';

/** Direction of a contact interaction message. */
export type InteractionDirection = 'sent' | 'received';

/** Type of interaction with a contact. */
export type InteractionType = 'dm' | 'comment' | 'group_post_reply' | 'friend_request';

/** Warm-up engine operating mode. */
export type WarmUpMode = 'internal' | 'external';

/** Comment Marketing Engine stance. */
export type CommentStance = 'url_promotion' | 'reels_commenting' | 'page_review';

/** Content Amplifier operating mode. */
export type AmplifierMode = 'post_seeder' | 'video_watch_farm';

// ─────────────────────────────────────────────
// RICH ASSET DATA RECORDS
// Stored as JSON strings in SQLite, parsed on read.
// ─────────────────────────────────────────────

/** A Facebook Business Manager record scraped from an account. */
export interface BMRecord {
  name: string;
  id: string;
  role: string;
  adAccountCount: number;
  restrictionStatus: string;
}

/** A Facebook Page owned by an account. */
export interface PageRecord {
  name: string;
  id: string;
  url: string;
  category: string;
  likes: number;
}

/** A Facebook Group the account has joined. */
export interface GroupRecord {
  name: string;
  url: string;
  memberCount: number;
  /** The account's role in this group: member, moderator, admin. */
  role: string;
}

/** Per-session browser fingerprint stored in userDataDir/fingerprint.json. */
export interface FingerprintData {
  canvasNoiseSeed: number;
  webglRenderer: string;
  webglVendor: string;
  audioContextNoise: number;
  userAgent: string;
  screenWidth: number;
  screenHeight: number;
}

// ─────────────────────────────────────────────
// CORE ENTITIES
// ─────────────────────────────────────────────

/**
 * A Facebook account session managed by Flogination.
 * Stored in the `sessions` SQLite table.
 * Array fields (bmData, ownedPagesData, joinedGroupsData) are JSON strings in DB.
 */
export interface Session {
  id: string;
  uid: string;
  fbName: string;
  profileUrl: string;
  password?: string;
  cookie: string;
  twoFactorSecret?: string;

  // Personal metadata
  country: string;
  phoneNumber?: string;
  email?: string;
  dateOfBirth?: string;
  gender?: string;
  creationDate?: string;

  // Legacy asset counts (kept for backward compatibility)
  bmCount: number;
  bmRoles: string;
  bmRestrictionStatus: string;
  ownedPages: string;
  pagesFollowingCount: number;
  groupsJoinedCount: number;
  groupRoles: string;

  // V5 rich asset data (JSON strings — parse with JSON.parse before use)
  bmData: string;           // BMRecord[]
  ownedPagesData: string;   // PageRecord[]
  joinedGroupsData: string; // GroupRecord[]

  // Ad account intelligence
  adAccountId?: string;
  currency?: string;
  timezone?: string;
  spendingLimit?: number;
  currentThreshold?: number;
  accountBalance?: number;
  totalSpent?: number;
  billingDate?: string;
  paymentMethod?: string;

  // Social & status
  friendsCount: number;
  professionalMode: boolean;
  monetizationStatus: boolean;
  healthStatus: HealthStatus;
  scrapingStatus: ScrapingStatus;
  scrapedAt?: number;

  // Proxy & timing
  proxyId?: string;
  lastCheck: number;
  createdAt: number;
  updatedAt: number;

  // Runtime-only fields (not persisted — populated by session-manager)
  state?: SessionState;
  isRunning?: boolean;
  warmUpScore?: number;
}

/** A proxy server entry used to isolate session network traffic. */
export interface Proxy {
  id: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  protocol: 'http' | 'https' | 'socks5';
  country: string;
  isActive: boolean;
  createdAt: number;
}

/** An activity log entry recording what happened to a session. */
export interface ActivityLog {
  id: string;
  sessionId: string;
  action: string;
  details: string;
  timestamp: number;
  campaignId?: string;
}

// ─────────────────────────────────────────────
// CAMPAIGN SYSTEM
// ─────────────────────────────────────────────

/**
 * A named automation job (Group Hunter, Comment Engine, etc.).
 * Stored in the `campaigns` SQLite table.
 * `config` is a JSON string — parse before use.
 */
export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  config: string; // JSON blob of campaign-specific parameters
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/**
 * A single unit of work within a campaign.
 * One session performing one action.
 * Stored in the `campaign_tasks` SQLite table.
 */
export interface CampaignTask {
  id: string;
  campaignId: string;
  sessionId: string;
  action: string;
  status: TaskStatus;
  result?: string; // JSON string — parse before use
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

/** Progress summary for a running campaign. */
export interface CampaignProgress {
  total: number;
  done: number;
  failed: number;
  skipped: number;
  percent: number;
}

// ─────────────────────────────────────────────
// ASSET PARKING
// ─────────────────────────────────────────────

/**
 * A Facebook Page or Business Manager that has been transferred
 * from a worker account to a parking account for safekeeping.
 */
export interface ParkedAsset {
  id: string;
  type: AssetType;
  /** The Facebook-assigned ID of the page or BM. */
  assetId: string;
  assetName: string;
  creatorSessionId: string;
  parkingSessionId: string;
  transferStatus: TransferStatus;
  createdAt: number;
  transferredAt?: number;
}

// ─────────────────────────────────────────────
// SELF-HEALING SELECTOR CACHE
// ─────────────────────────────────────────────

/**
 * A cached CSS selector entry used by the self-healing engine.
 * When Facebook updates its DOM, the engine replaces broken selectors
 * via AI and stores the fix here for reuse.
 */
export interface SelectorCache {
  id: string;
  /** Logical name for the element, e.g. "fb_comment_button". */
  elementKey: string;
  cssSelector: string;
  lastVerified: number;
  /** How many times this selector has been healed by AI. */
  healCount: number;
}

// ─────────────────────────────────────────────
// CONTACT CRM
// ─────────────────────────────────────────────

/**
 * A person the operator has interacted with across any session.
 * Acts as a lightweight CRM record for buyers, sellers, and leads.
 * `tags` is a JSON string — parse before use.
 */
export interface Contact {
  id: string;
  fbUid: string;
  fbName?: string;
  profileUrl?: string;
  /** JSON string: string[] — e.g. '["buyer","warm-lead"]' */
  tags: string;
  notes: string;
  /** The session that first encountered this contact. */
  firstSeenVia?: string;
  lastInteraction?: number;
  createdAt: number;
  updatedAt: number;
}

/** A single message or action exchanged with a contact. */
export interface ContactInteraction {
  id: string;
  contactId: string;
  sessionId: string;
  type: InteractionType;
  content?: string;
  direction: InteractionDirection;
  timestamp: number;
}

// ─────────────────────────────────────────────
// INBOX
// ─────────────────────────────────────────────

/** A conversation entry in the unified inbox, aggregated across sessions. */
export interface InboxConversation {
  sessionId: string;
  contactUid: string;
  contactName: string;
  /** Truncated preview of the last message (max 80 chars). */
  lastMessage: string;
  lastMessageTime: number;
  unread: boolean;
  /** Contact tags for filtering — parsed from Contact.tags. */
  tags: string[];
}

/** A single message within a conversation thread. */
export interface InboxMessage {
  id: string;
  text: string;
  direction: InteractionDirection;
  timestamp: number;
}

// ─────────────────────────────────────────────
// WARM-UP ENGINE
// ─────────────────────────────────────────────

/**
 * A warm-up job that builds inbox activity for selected sessions.
 * `sessionIds` and `config` are JSON strings — parse before use.
 */
export interface WarmUpJob {
  id: string;
  mode: WarmUpMode;
  /** JSON string: string[] of session IDs participating in this job. */
  sessionIds: string;
  /** JSON string: WarmUpConfig object. */
  config: string;
  status: 'running' | 'paused' | 'completed';
  createdAt: number;
}

/** Configuration parameters for a warm-up job. */
export interface WarmUpConfig {
  messagesPerDay: number;       // 1–20
  durationDays: number;         // 1–30
  responseDelayMinMs: number;   // for external mode
  responseDelayMaxMs: number;
  messageTemplates: string[];   // spin syntax supported
}

// ─────────────────────────────────────────────
// COUNTRY SESSION BANK
// ─────────────────────────────────────────────

/** Aggregated session counts per country for the Dashboard widget. */
export interface CountrySessionStats {
  country: string;
  /** Unicode flag emoji derived from country code. */
  flag: string;
  total: number;
  live: number;
  checkpoint: number;
  restricted: number;
  dead: number;
}

// ─────────────────────────────────────────────
// SETTINGS
// ─────────────────────────────────────────────

/** Configuration for the AI content generation gateway. */
export interface AISettings {
  provider: 'openrouter' | 'deepseek' | 'openai' | 'glm';
  apiKey: string;
  model: string;
  enabled: boolean;
  /**
   * Free-tier model used exclusively for self-healing selector calls.
   * Keeps costs near zero for maintenance tasks.
   * Default: 'openrouter/auto'
   */
  freeModel: string;
}

/** Configuration for the optional Agent Bridge external API. */
export interface AgentBridgeSettings {
  enabled: boolean;
  port: number;
  apiKey: string;
  allowedOrigins: string[];
}

/** Full application settings stored as a single JSON blob in SQLite. */
export interface AppSettings {
  ai: AISettings;
  agentBridge: AgentBridgeSettings;
  stealthMode: boolean;
  gridLayout: { cols: number; rows: number };
  memoryCapMb: number;
  hibernationEnabled: boolean;
  webRTCBlocked: boolean;

  // V5 additions
  /** MongoDB connection URI. Empty string = use SQLite only. */
  mongoUri: string;
  /** n8n webhook base URL. Empty string = skip all webhook calls. */
  n8nBaseUrl: string;
  /** Kill browser immediately when proxy disconnects. Default: true. */
  proxyKillSwitch: boolean;
  /** Max concurrent auto-scrape sessions. Default: 3. */
  maxScrapeParallel: number;
  /** Inbox polling interval in milliseconds. Default: 60000. */
  inboxPollIntervalMs: number;
}

// ─────────────────────────────────────────────
// API RESPONSE HELPERS
// ─────────────────────────────────────────────

/** Standard success response shape for all API endpoints. */
export interface ApiSuccess<T = undefined> {
  success: true;
  data?: T;
}

/** Standard error response shape for all API endpoints. */
export interface ApiError {
  success: false;
  error: string;
}

/** Union type for all API responses. */
export type ApiResponse<T = undefined> = ApiSuccess<T> | ApiError;

/** Result of a bulk session import operation. */
export interface BulkImportResult {
  imported: number;
  failed: number;
  errors: Array<{ row: number; reason: string }>;
}

// ─────────────────────────────────────────────
// BROWSER RECORDER
// ─────────────────────────────────────────────

/** Type of action recorded by the Browser Recorder. */
export type RecordedActionType = 'click' | 'type' | 'navigate';

/**
 * A single operator interaction captured by the Browser Recorder.
 * Stored in-memory during a recording session.
 */
export interface RecordedAction {
  /** Step index within the current recording session (1-based). */
  step: number;
  actionType: RecordedActionType;
  /** CSS selector computed for the clicked element. Empty for navigate actions. */
  selector: string;
  /** innerText of the element, truncated to 100 chars. Empty for navigate/type. */
  elementText: string;
  /** HTML tag name of the element, e.g. 'button', 'a'. */
  elementTag: string;
  /** Viewport X coordinate of the click. 0 for type/navigate. */
  x: number;
  /** Viewport Y coordinate of the click. 0 for type/navigate. */
  y: number;
  /** Text value for 'type' actions. Undefined for click/navigate. */
  value?: string;
  /** Target URL for 'navigate' actions. Undefined for click/type. */
  url?: string;
  timestamp: number;
}

/**
 * A single AI-generated automation step derived from recorded actions.
 * Part of a RecordedWorkflow.
 */
export interface WorkflowStep {
  stepName: string;
  selector: string;
  actionType: RecordedActionType;
  /** Value to type, if actionType is 'type'. */
  value?: string;
  /** Human-readable description of what this step does. */
  description: string;
}

/**
 * A named, persisted automation workflow generated from a Browser Recorder session.
 * Stored in the `recorded_workflows` SQLite table.
 * `steps` is a JSON string — parse before use.
 */
export interface RecordedWorkflow {
  id: string;
  name: string;
  sessionId: string;
  /** JSON string: WorkflowStep[] */
  steps: string;
  createdAt: number;
  updatedAt: number;
}
