'use client';

/**
 * Flogination V5 — Zustand Store (V5 Slice Architecture)
 *
 * Global client-side state for the Next.js dashboard.
 * All state flows through this store — no direct DB or Playwright access from the UI.
 * Every action proxies to the Express API via fetch to http://localhost:3001/api/...
 *
 * Slices:
 *  - sessionSlice   — account list, scraping status, health, country bank
 *  - campaignSlice  — automation job list and lifecycle actions
 *  - inboxSlice     — conversations, threads, unread count
 *  - contactSlice   — CRM contact list
 *  - warmUpSlice    — warm-up job list and lifecycle actions
 *  - uiSlice        — sidebar state, active view, modals
 *  - settingsSlice  — app configuration
 *  - proxySlice     — proxy management
 */

import { create, type StateCreator } from 'zustand';
import type {
  Session,
  Proxy,
  Campaign,
  CampaignTask,
  ParkedAsset,
  Contact,
  WarmUpJob,
  InboxConversation,
  InboxMessage,
  AppSettings,
  CountrySessionStats,
  BulkImportResult,
  ActivityLog,
} from '../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Base URL for all API calls — proxies to the Express server on port 3001. */
const API_BASE = 'http://localhost:3001/api';

const DEFAULT_LOG_LIMIT = 100;

const SIDEBAR_STORAGE_KEY = 'flog_sidebar_collapsed';

// ─────────────────────────────────────────────
// TYPE ALIASES
// ─────────────────────────────────────────────

/** Country breakdown alias — CountrySessionStats is the canonical type. */
export type CountryBreakdown = CountrySessionStats;

// ─────────────────────────────────────────────
// VIEW TYPES
// ─────────────────────────────────────────────

export type MainView =
  | 'dashboard'
  | 'accounts'
  | 'inbox'
  | 'inbox-contacts'
  | 'inbox-warmup'
  | 'tools-page-factory'
  | 'tools-bm-factory'
  | 'tools-group-hunter'
  | 'tools-comment-marketing'
  | 'tools-content-amplifier'
  | 'tools-browser-recorder'
  | 'grid'
  | 'campaigns'
  | 'proxies'
  | 'settings'
  | 'logs';

export type ToolView =
  | 'page-factory'
  | 'bm-factory'
  | 'group-hunter'
  | 'comment-marketing'
  | 'content-amplifier'
  | 'browser-recorder';

export type InboxView = 'messages' | 'contacts' | 'warmup';

// ─────────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────────

/**
 * Typed fetch wrapper for all API calls.
 * Uses absolute http://localhost:3001/api paths.
 * Throws on non-2xx responses with the server's error message.
 *
 * @param path - API path relative to /api (e.g. '/sessions')
 * @param options - Standard RequestInit options
 * @returns Parsed JSON response typed as T
 *
 * @example
 * const data = await apiFetch<{ sessions: Session[] }>('/sessions')
 */
async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(err.error ?? `API error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────
// SLICE INTERFACES
// ─────────────────────────────────────────────

interface SessionSlice {
  // State
  sessions: Session[];
  sessionsByCountry: CountryBreakdown[];
  selectedSessionId: string | null;
  isLoading: boolean;

  // Derived (computed on read via selector)
  // scrapingCount is exposed via the exported useScrapingCount selector

  // Actions
  fetchSessions: () => Promise<void>;
  fetchByCountry: () => Promise<CountryBreakdown[]>;
  bulkImport: (formData: FormData) => Promise<BulkImportResult>;
  scrapeSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  updateSession: (id: string, data: Partial<Session>) => Promise<void>;

  // Extended actions (preserved from V4)
  addSession: (data: Partial<Session>) => Promise<{ success: boolean; session?: Session; error?: string }>;
  scrapeAll: () => Promise<{ success: boolean; error?: string }>;
  cancelScrapeAll: () => Promise<{ success: boolean; error?: string }>;
  launchSession: (id: string) => Promise<{ success: boolean; error?: string }>;
  closeSession: (id: string) => Promise<{ success: boolean; error?: string }>;
  checkHealth: (id: string) => Promise<{ success: boolean; error?: string }>;
  hibernateSession: (id: string) => Promise<{ success: boolean; error?: string }>;
  wakeSession: (id: string) => Promise<{ success: boolean; error?: string }>;
  setSelectedSession: (id: string | null) => void;
}

interface CampaignSlice {
  // State
  campaigns: Campaign[];
  activeCampaign: Campaign | null;
  campaignTasks: CampaignTask[];
  selectedCampaignId: string | null;

  // Actions
  fetchCampaigns: () => Promise<void>;
  pauseCampaign: (id: string) => Promise<void>;
  resumeCampaign: (id: string) => Promise<void>;
  cancelCampaign: (id: string) => Promise<void>;
  deleteCampaign: (id: string) => Promise<void>;

  // Extended actions (preserved from V4)
  fetchCampaignTasks: (campaignId: string) => Promise<{ success: boolean; error?: string }>;
  createCampaign: (data: Partial<Campaign>) => Promise<{ success: boolean; campaign?: Campaign; error?: string }>;
  setActiveCampaign: (campaign: Campaign | null) => void;
  setSelectedCampaign: (id: string | null) => void;
}

interface InboxSlice {
  // State
  conversations: InboxConversation[];
  activeConversation: InboxConversation | null;
  activeThread: InboxMessage[] | null;
  unreadCount: number;

  // Actions
  fetchConversations: () => Promise<void>;
  fetchThread: (sessionId: string, contactUid: string) => Promise<void>;
  sendReply: (sessionId: string, contactUid: string, message: string) => Promise<void>;
  generateAIReply: (sessionId: string, contactUid: string) => Promise<string>;

  // Extended actions (preserved from V4)
  setActiveConversation: (conv: InboxConversation | null) => void;
}

interface ContactSlice {
  // State
  contacts: Contact[];
  contactStats: { total: number; buyers: number; sellers: number; leads: number; warm: number };
  selectedContactId: string | null;

  // Actions
  fetchContacts: (filters?: { tag?: string; sessionId?: string }) => Promise<void>;
  updateContactTags: (id: string, tags: string[]) => Promise<void>;
  updateContactNotes: (id: string, notes: string) => Promise<void>;

  // Extended actions (preserved from V4)
  upsertContact: (data: Partial<Contact>) => Promise<{ success: boolean; error?: string }>;
  deleteContact: (id: string) => Promise<{ success: boolean; error?: string }>;
  setSelectedContact: (id: string | null) => void;
}

interface WarmUpSlice {
  // State
  warmUpJobs: WarmUpJob[];

  // Actions
  fetchWarmUpJobs: () => Promise<void>;
  createWarmUpJob: (config: Partial<WarmUpJob>) => Promise<void>;
  startWarmUpJob: (id: string) => Promise<void>;
  pauseWarmUpJob: (id: string) => Promise<void>;
  deleteWarmUpJob: (id: string) => Promise<void>;
}

/** Typed modal state — avoids stringly-typed Record<string, boolean>. */
interface ModalState {
  addSession: boolean;
  sessionDetail: string | null;
}

interface UISlice {
  // State
  currentView: string;
  sidebarCollapsed: boolean;
  activeToolView: string;
  activeInboxView: string;
  modals: ModalState;

  // Actions
  setView: (view: string) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActiveToolView: (view: string) => void;
  setActiveInboxView: (view: string) => void;
  openAddSessionModal: () => void;
  closeAddSessionModal: () => void;
  openSessionDetail: (id: string) => void;
  closeSessionDetail: () => void;

  // Extended actions (preserved from V4)
  toggleSidebar: () => void;
}

interface SettingsSlice {
  // State
  settings: AppSettings | null;
  gridLayout: { cols: number; rows: number };

  // Actions
  fetchSettings: () => Promise<void>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<void>;

  // Extended actions (preserved from V4)
  testMongoConnection: (uri: string) => Promise<{ success: boolean; error?: string }>;
  testN8nWebhook: (url: string) => Promise<{ success: boolean; error?: string }>;
}

interface ProxySlice {
  // State
  proxies: Proxy[];

  // Actions
  fetchProxies: () => Promise<void>;
  addProxy: (proxyString: string) => Promise<void>;
  bulkAddProxies: (proxyStrings: string) => Promise<void>;
  testProxy: (id: string) => Promise<{ success: boolean; country?: string; latency?: number }>;
  deleteProxy: (id: string) => Promise<void>;
  assignProxy: (sessionId: string, proxyId: string) => Promise<void>;
  bulkAssignProxies: (country: string) => Promise<void>;
}

// ─────────────────────────────────────────────
// LEGACY SLICES (kept for backward compatibility)
// ─────────────────────────────────────────────

interface ParkedAssetSlice {
  parkedAssets: ParkedAsset[];
  fetchParkedAssets: (type?: 'page' | 'bm') => Promise<{ success: boolean; error?: string }>;
  deleteParkedAsset: (id: string) => Promise<{ success: boolean; error?: string }>;
}

interface LogSlice {
  logs: ActivityLog[];
  fetchLogs: (sessionId?: string, limit?: number) => Promise<{ success: boolean; error?: string }>;
}

// ─────────────────────────────────────────────
// FULL STORE TYPE
// ─────────────────────────────────────────────

type StoreState =
  & SessionSlice
  & CampaignSlice
  & InboxSlice
  & ContactSlice
  & WarmUpSlice
  & UISlice
  & SettingsSlice
  & ProxySlice
  & ParkedAssetSlice
  & LogSlice;

// Convenience alias for StateCreator with full store type
type Slice<T> = StateCreator<StoreState, [], [], T>;

// ─────────────────────────────────────────────
// SESSION SLICE
// ─────────────────────────────────────────────

/**
 * Manages all Facebook account session state and API interactions.
 * scrapingCount is derived — use the useScrapingCount selector.
 */
const createSessionSlice: Slice<SessionSlice> = (set, get) => ({
  sessions: [],
  sessionsByCountry: [],
  selectedSessionId: null,
  isLoading: false,

  fetchSessions: async () => {
    set({ isLoading: true });
    try {
      const data = await apiFetch<{ sessions: Session[] }>('/sessions');
      set({ sessions: data.sessions });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('fetchSessions failed:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  fetchByCountry: async () => {
    try {
      const data = await apiFetch<{ stats: CountryBreakdown[] }>('/sessions/by-country');
      set({ sessionsByCountry: data.stats });
      return data.stats;
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('fetchByCountry failed:', error);
      return [];
    }
  },

  bulkImport: async (formData) => {
    // Multipart upload — no Content-Type header (browser sets boundary automatically)
    const res = await fetch(`${API_BASE}/sessions/bulk-import`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json() as BulkImportResult;
    await get().fetchSessions();
    return data;
  },

  scrapeSession: async (id) => {
    try {
      await apiFetch(`/sessions/${id}/scrape`, { method: 'POST' });
      await get().fetchSessions();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`scrapeSession(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  deleteSession: async (id) => {
    try {
      await apiFetch(`/sessions/${id}`, { method: 'DELETE' });
      await get().fetchSessions();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`deleteSession(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  updateSession: async (id, sessionData) => {
    try {
      await apiFetch(`/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(sessionData),
      });
      await get().fetchSessions();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`updateSession(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  addSession: async (sessionData) => {
    try {
      const data = await apiFetch<{ success: boolean; session: Session }>('/sessions', {
        method: 'POST',
        body: JSON.stringify(sessionData),
      });
      await get().fetchSessions();
      return { success: true, session: data.session };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  scrapeAll: async () => {
    try {
      const sessions = get().sessions;
      const toScrape = sessions.filter((s) => s.scrapingStatus !== 'scraping');
      await Promise.all(
        toScrape.map((s) =>
          apiFetch(`/sessions/${s.id}/scrape`, { method: 'POST' }).catch(() => {})
        )
      );
      await get().fetchSessions();
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  cancelScrapeAll: async () => {
    try {
      await apiFetch('/sessions/scrape/cancel-all', { method: 'POST' });
      await get().fetchSessions();
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  launchSession: async (id) => {
    try {
      await apiFetch(`/sessions/${id}/launch`, { method: 'POST' });
      await get().fetchSessions();
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  closeSession: async (id) => {
    try {
      await apiFetch(`/sessions/${id}/close`, { method: 'POST' });
      await get().fetchSessions();
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  checkHealth: async (id) => {
    try {
      await apiFetch(`/sessions/${id}/check-health`, { method: 'POST' });
      await get().fetchSessions();
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  hibernateSession: async (id) => {
    try {
      await apiFetch(`/sessions/${id}/hibernate`, { method: 'POST' });
      await get().fetchSessions();
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  wakeSession: async (id) => {
    try {
      await apiFetch(`/sessions/${id}/wake`, { method: 'POST' });
      await get().fetchSessions();
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  setSelectedSession: (id) => set({ selectedSessionId: id }),
});

// ─────────────────────────────────────────────
// CAMPAIGN SLICE
// ─────────────────────────────────────────────

/**
 * Manages automation campaign state and lifecycle actions.
 */
const createCampaignSlice: Slice<CampaignSlice> = (set, get) => ({
  campaigns: [],
  activeCampaign: null,
  campaignTasks: [],
  selectedCampaignId: null,

  fetchCampaigns: async () => {
    try {
      const data = await apiFetch<{ campaigns: Campaign[] }>('/campaigns');
      set({ campaigns: data.campaigns });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('fetchCampaigns failed:', error);
    }
  },

  pauseCampaign: async (id) => {
    try {
      await apiFetch(`/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'pause' }),
      });
      await get().fetchCampaigns();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`pauseCampaign(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  resumeCampaign: async (id) => {
    try {
      await apiFetch(`/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'resume' }),
      });
      await get().fetchCampaigns();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`resumeCampaign(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  cancelCampaign: async (id) => {
    try {
      await apiFetch(`/campaigns/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'cancel' }),
      });
      await get().fetchCampaigns();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`cancelCampaign(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  deleteCampaign: async (id) => {
    try {
      await apiFetch(`/campaigns/${id}`, { method: 'DELETE' });
      await get().fetchCampaigns();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`deleteCampaign(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  fetchCampaignTasks: async (campaignId) => {
    try {
      const data = await apiFetch<{ tasks: CampaignTask[] }>(`/campaigns/${campaignId}/tasks`);
      set({ campaignTasks: data.tasks, selectedCampaignId: campaignId });
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  createCampaign: async (campaignData) => {
    try {
      const data = await apiFetch<{ success: boolean; campaign: Campaign }>('/campaigns', {
        method: 'POST',
        body: JSON.stringify(campaignData),
      });
      await get().fetchCampaigns();
      return { success: true, campaign: data.campaign };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  setActiveCampaign: (campaign) => set({ activeCampaign: campaign }),
  setSelectedCampaign: (id) => set({ selectedCampaignId: id }),
});

// ─────────────────────────────────────────────
// INBOX SLICE
// ─────────────────────────────────────────────

/**
 * Manages unified inbox state — conversations, threads, and AI reply generation.
 */
const createInboxSlice: Slice<InboxSlice> = (set, get) => ({
  conversations: [],
  activeConversation: null,
  activeThread: null,
  unreadCount: 0,

  fetchConversations: async () => {
    try {
      const data = await apiFetch<{ conversations: InboxConversation[]; unreadCount: number }>(
        '/inbox/conversations'
      );
      set({ conversations: data.conversations, unreadCount: data.unreadCount });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('fetchConversations failed:', error);
    }
  },

  fetchThread: async (sessionId, contactUid) => {
    try {
      const data = await apiFetch<{ thread: InboxMessage[] }>(
        `/inbox/conversations/${sessionId}/${contactUid}`
      );
      set({ activeThread: data.thread });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`fetchThread(${sessionId}, ${contactUid}) failed:`, error);
      throw new Error(error);
    }
  },

  sendReply: async (sessionId, contactUid, message) => {
    try {
      await apiFetch(
        `/inbox/conversations/${sessionId}/${contactUid}/reply`,
        { method: 'POST', body: JSON.stringify({ text: message }) }
      );
      await get().fetchConversations();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`sendReply(${sessionId}, ${contactUid}) failed:`, error);
      throw new Error(error);
    }
  },

  generateAIReply: async (sessionId, contactUid) => {
    try {
      const data = await apiFetch<{ success: boolean; content?: string }>(
        `/inbox/conversations/${sessionId}/${contactUid}/ai-reply`,
        { method: 'POST' }
      );
      return data.content ?? '';
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`generateAIReply(${sessionId}, ${contactUid}) failed:`, error);
      throw new Error(error);
    }
  },

  setActiveConversation: (conv) => set({ activeConversation: conv }),
});

// ─────────────────────────────────────────────
// CONTACT SLICE
// ─────────────────────────────────────────────

/**
 * Manages CRM contact list and tag/notes updates.
 */
const createContactSlice: Slice<ContactSlice> = (set, get) => ({
  contacts: [],
  contactStats: { total: 0, buyers: 0, sellers: 0, leads: 0, warm: 0 },
  selectedContactId: null,

  fetchContacts: async (filters) => {
    try {
      const params = new URLSearchParams();
      if (filters?.tag) params.set('tag', filters.tag);
      if (filters?.sessionId) params.set('sessionId', filters.sessionId);
      const query = params.toString() ? `?${params.toString()}` : '';
      const data = await apiFetch<{
        contacts: Contact[];
        stats: { total: number; buyers: number; sellers: number; leads: number; warm: number };
      }>(`/contacts${query}`);
      set({ contacts: data.contacts, contactStats: data.stats });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('fetchContacts failed:', error);
    }
  },

  updateContactTags: async (id, tags) => {
    try {
      await apiFetch(`/contacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ tags }),
      });
      await get().fetchContacts();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`updateContactTags(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  updateContactNotes: async (id, notes) => {
    try {
      await apiFetch(`/contacts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ notes }),
      });
      await get().fetchContacts();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`updateContactNotes(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  upsertContact: async (contactData) => {
    try {
      await apiFetch('/contacts', {
        method: 'POST',
        body: JSON.stringify(contactData),
      });
      await get().fetchContacts();
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  deleteContact: async (id) => {
    try {
      await apiFetch(`/contacts/${id}`, { method: 'DELETE' });
      await get().fetchContacts();
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  setSelectedContact: (id) => set({ selectedContactId: id }),
});

// ─────────────────────────────────────────────
// WARM-UP SLICE
// ─────────────────────────────────────────────

/**
 * Manages warm-up job lifecycle — create, start, pause, delete.
 */
const createWarmUpSlice: Slice<WarmUpSlice> = (set, get) => ({
  warmUpJobs: [],

  fetchWarmUpJobs: async () => {
    try {
      const data = await apiFetch<{ jobs: WarmUpJob[] }>('/warmup/jobs');
      set({ warmUpJobs: data.jobs });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('fetchWarmUpJobs failed:', error);
    }
  },

  createWarmUpJob: async (config) => {
    try {
      await apiFetch('/warmup/jobs', {
        method: 'POST',
        body: JSON.stringify(config),
      });
      await get().fetchWarmUpJobs();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('createWarmUpJob failed:', error);
      throw new Error(error);
    }
  },

  startWarmUpJob: async (id) => {
    try {
      await apiFetch(`/warmup/jobs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'start' }),
      });
      await get().fetchWarmUpJobs();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`startWarmUpJob(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  pauseWarmUpJob: async (id) => {
    try {
      await apiFetch(`/warmup/jobs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'pause' }),
      });
      await get().fetchWarmUpJobs();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`pauseWarmUpJob(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  deleteWarmUpJob: async (id) => {
    try {
      await apiFetch(`/warmup/jobs/${id}`, { method: 'DELETE' });
      await get().fetchWarmUpJobs();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`deleteWarmUpJob(${id}) failed:`, error);
      throw new Error(error);
    }
  },
});

// ─────────────────────────────────────────────
// UI SLICE
// ─────────────────────────────────────────────

/**
 * Manages navigation state, sidebar, tool/inbox sub-views, and modals.
 * sidebarCollapsed is persisted to localStorage on every change.
 */
const createUISlice: Slice<UISlice> = (set, get) => ({
  // Read sidebarCollapsed from localStorage on first render (SSR-safe)
  currentView: 'dashboard',
  sidebarCollapsed:
    typeof window !== 'undefined'
      ? localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true'
      : false,
  activeToolView: 'page-factory',
  activeInboxView: 'messages',
  modals: {
    addSession: false,
    sessionDetail: null,
  },

  setView: (view) => set({ currentView: view }),

  setSidebarCollapsed: (collapsed) => {
    // Persist sidebar state to localStorage for UX continuity across reloads
    if (typeof window !== 'undefined') {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    }
    set({ sidebarCollapsed: collapsed });
  },

  setActiveToolView: (view) => set({ activeToolView: view }),

  setActiveInboxView: (view) => set({ activeInboxView: view }),

  openAddSessionModal: () =>
    set((state) => ({ modals: { ...state.modals, addSession: true } })),

  closeAddSessionModal: () =>
    set((state) => ({ modals: { ...state.modals, addSession: false } })),

  openSessionDetail: (id) =>
    set((state) => ({ modals: { ...state.modals, sessionDetail: id } })),

  closeSessionDetail: () =>
    set((state) => ({ modals: { ...state.modals, sessionDetail: null } })),

  toggleSidebar: () => {
    const collapsed = !get().sidebarCollapsed;
    if (typeof window !== 'undefined') {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
    }
    set({ sidebarCollapsed: collapsed });
  },
});

// ─────────────────────────────────────────────
// SETTINGS SLICE
// ─────────────────────────────────────────────

/**
 * Manages application settings — fetch, save, and connection tests.
 */
const createSettingsSlice: Slice<SettingsSlice> = (set, get) => ({
  settings: null,
  gridLayout: { cols: 3, rows: 4 },

  fetchSettings: async () => {
    try {
      const data = await apiFetch<{ settings: AppSettings }>('/settings');
      set({ settings: data.settings, gridLayout: data.settings.gridLayout });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('fetchSettings failed:', error);
    }
  },

  saveSettings: async (settingsData) => {
    try {
      await apiFetch('/settings', {
        method: 'POST',
        body: JSON.stringify(settingsData),
      });
      await get().fetchSettings();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('saveSettings failed:', error);
      throw new Error(error);
    }
  },

  testMongoConnection: async (uri) => {
    try {
      return await apiFetch<{ success: boolean; error?: string }>('/mongodb/test', {
        method: 'POST',
        body: JSON.stringify({ mongoUri: uri }),
      });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  testN8nWebhook: async (url) => {
    try {
      return await apiFetch<{ success: boolean; error?: string }>('/webhooks/test', {
        method: 'POST',
        body: JSON.stringify({ n8nBaseUrl: url }),
      });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },
});

// ─────────────────────────────────────────────
// PROXY SLICE
// ─────────────────────────────────────────────

/**
 * Manages proxy entries — add, bulk-add, test, delete, and assignment.
 */
const createProxySlice: Slice<ProxySlice> = (set, get) => ({
  proxies: [],

  fetchProxies: async () => {
    try {
      const data = await apiFetch<{ proxies: Proxy[] }>('/proxies');
      set({ proxies: data.proxies });
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('fetchProxies failed:', error);
    }
  },

  addProxy: async (proxyString) => {
    try {
      await apiFetch('/proxies', {
        method: 'POST',
        body: JSON.stringify({ proxy: proxyString }),
      });
      await get().fetchProxies();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('addProxy failed:', error);
      throw new Error(error);
    }
  },

  bulkAddProxies: async (proxyStrings) => {
    try {
      await apiFetch('/proxies/bulk', {
        method: 'POST',
        body: JSON.stringify({ proxies: proxyStrings }),
      });
      await get().fetchProxies();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error('bulkAddProxies failed:', error);
      throw new Error(error);
    }
  },

  testProxy: async (id) => {
    try {
      return await apiFetch<{ success: boolean; country?: string; latency?: number }>(
        `/proxies/${id}/test`,
        { method: 'POST' }
      );
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`testProxy(${id}) failed:`, error);
      return { success: false };
    }
  },

  deleteProxy: async (id) => {
    try {
      await apiFetch(`/proxies/${id}`, { method: 'DELETE' });
      await get().fetchProxies();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`deleteProxy(${id}) failed:`, error);
      throw new Error(error);
    }
  },

  assignProxy: async (sessionId, proxyId) => {
    try {
      await apiFetch(`/sessions/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ proxyId }),
      });
      await get().fetchProxies();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`assignProxy(${sessionId}, ${proxyId}) failed:`, error);
      throw new Error(error);
    }
  },

  bulkAssignProxies: async (country) => {
    try {
      await apiFetch('/proxies/bulk-assign', {
        method: 'POST',
        body: JSON.stringify({ country }),
      });
      await get().fetchProxies();
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      console.error(`bulkAssignProxies(${country}) failed:`, error);
      throw new Error(error);
    }
  },
});

// ─────────────────────────────────────────────
// LEGACY SLICES
// ─────────────────────────────────────────────

/**
 * Parked asset slice — kept for backward compatibility with V4 components.
 */
const createParkedAssetSlice: Slice<ParkedAssetSlice> = (set, get) => ({
  parkedAssets: [],

  fetchParkedAssets: async (type) => {
    try {
      const query = type ? `?type=${type}` : '';
      const data = await apiFetch<{ assets: ParkedAsset[] }>(`/parked-assets${query}`);
      set({ parkedAssets: data.assets });
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },

  deleteParkedAsset: async (id) => {
    try {
      await apiFetch(`/parked-assets/${id}`, { method: 'DELETE' });
      await get().fetchParkedAssets();
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },
});

/**
 * Activity log slice — kept for backward compatibility with V4 components.
 */
const createLogSlice: Slice<LogSlice> = (set) => ({
  logs: [],

  fetchLogs: async (sessionId, limit = DEFAULT_LOG_LIMIT) => {
    try {
      const params = new URLSearchParams();
      if (sessionId) params.set('sessionId', sessionId);
      params.set('limit', String(limit));
      const data = await apiFetch<{ logs: ActivityLog[] }>(`/logs?${params.toString()}`);
      set({ logs: data.logs });
      return { success: true };
    } catch (e: unknown) {
      const error = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error };
    }
  },
});

// ─────────────────────────────────────────────
// STORE COMPOSITION
// ─────────────────────────────────────────────

/**
 * Primary Zustand store for the Flogination V5 dashboard.
 * Composed from independent slice creators for clean separation of concerns.
 *
 * Use the exported selector hooks for component subscriptions to avoid
 * unnecessary re-renders.
 *
 * @example
 * const sessions = useStore((s) => s.sessions)
 * const fetchSessions = useStore((s) => s.fetchSessions)
 * const scrapingCount = useScrapingCount()
 */
export const useStore = create<StoreState>()((...args) => ({
  ...createSessionSlice(...args),
  ...createCampaignSlice(...args),
  ...createInboxSlice(...args),
  ...createContactSlice(...args),
  ...createWarmUpSlice(...args),
  ...createUISlice(...args),
  ...createSettingsSlice(...args),
  ...createProxySlice(...args),
  ...createParkedAssetSlice(...args),
  ...createLogSlice(...args),
}));

// ─────────────────────────────────────────────
// DERIVED SELECTORS
// ─────────────────────────────────────────────

/**
 * Returns the count of sessions currently in 'scraping' state.
 * Derived from sessions array — no extra state needed.
 *
 * @example
 * const scrapingCount = useScrapingCount()
 */
export const useScrapingCount = () =>
  useStore((s) => s.sessions.filter((session) => session.scrapingStatus === 'scraping').length);

/**
 * Returns all live sessions (healthStatus === 'live').
 *
 * @example
 * const liveSessions = useLiveSessions()
 */
export const useLiveSessions = () =>
  useStore((s) => s.sessions.filter((session) => session.healthStatus === 'live'));

/**
 * Returns the count of unread inbox conversations.
 *
 * @example
 * const unread = useUnreadCount()
 */
export const useUnreadCount = () => useStore((s) => s.unreadCount);

/**
 * Returns the currently active modal state.
 *
 * @example
 * const modals = useModals()
 * if (modals.addSession) { ... }
 */
export const useModals = () => useStore((s) => s.modals);

/**
 * Returns the current navigation view.
 *
 * @example
 * const view = useCurrentView()
 */
export const useCurrentView = () => useStore((s) => s.currentView);

/**
 * Returns sessions grouped by country for the dashboard widget.
 *
 * @example
 * const countryStats = useSessionsByCountry()
 */
export const useSessionsByCountry = () => useStore((s) => s.sessionsByCountry);

// ─────────────────────────────────────────────
// POLLING UTILITY
// ─────────────────────────────────────────────

/**
 * Starts a polling interval that calls `fn` every `intervalMs` milliseconds.
 * Returns a cleanup function that stops the interval — use as a useEffect return.
 *
 * @param fn - Async function to call on each tick
 * @param intervalMs - Polling interval in milliseconds
 * @returns Cleanup function that clears the interval
 *
 * @example
 * useEffect(() => {
 *   return startPolling(() => useStore.getState().fetchSessions(), 3000)
 * }, [])
 */
export function startPolling(fn: () => Promise<void>, intervalMs: number): () => void {
  const id = setInterval(() => { void fn(); }, intervalMs);
  return () => clearInterval(id);
}
