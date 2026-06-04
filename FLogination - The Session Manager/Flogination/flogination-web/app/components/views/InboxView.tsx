'use client';

import { useEffect, useRef, useState } from 'react';
import { useStore, startPolling } from '../../../../../src/store';
import type { InboxConversation, InboxMessage } from '../../../../../src/types';
import { ContentCard } from '../ui/ContentCard';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Interval at which unread counts are refreshed via polling. */
const UNREAD_POLL_INTERVAL_MS = 10_000;

/** Maximum characters shown in the last-message preview column. */
const LAST_MESSAGE_PREVIEW_MAX_CHARS = 40;

// ─────────────────────────────────────────────
// FILTER STATE SHAPE
// ─────────────────────────────────────────────

/** All active filter dimensions for the conversation list. */
export interface InboxFilters {
  search: string;
  tab: 'all' | 'unread';
  /** Empty string means "all sessions". */
  sessionId: string;
  /** Empty string means "all tags". */
  tag: string;
}

// ─────────────────────────────────────────────
// PURE HELPERS
// ─────────────────────────────────────────────

/**
 * Converts a Unix millisecond timestamp to a human-readable relative time string.
 * Returns "Xm ago", "Xh ago", or "Xd ago" depending on elapsed time.
 *
 * @param ts - Unix timestamp in milliseconds
 * @returns Relative time string, e.g. "5m ago", "2h ago", "3d ago"
 *
 * @example
 * formatRelativeTime(Date.now() - 5 * 60 * 1000) // → "5m ago"
 * formatRelativeTime(Date.now() - 3 * 3600 * 1000) // → "3h ago"
 */
export function formatRelativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Truncates a string to at most `maxLen` characters, appending '…' if truncated.
 * Returns the original string unchanged when its length is within the limit.
 *
 * @param text - The string to truncate
 * @param maxLen - Maximum allowed character count (inclusive)
 * @returns Truncated string with '…' suffix, or original string if within limit
 *
 * @example
 * truncatePreview("Hello world", 5) // → "Hello…"
 * truncatePreview("Hi", 5)          // → "Hi"
 */
export function truncatePreview(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '…';
}

/**
 * Filters a conversation list by all active predicates simultaneously (AND logic).
 * Predicates are applied in order: search → tab → sessionId → tag.
 * A predicate is skipped (treated as passing) when its filter value is empty/default.
 *
 * @param conversations - Full list of inbox conversations
 * @param filters - Active filter values
 * @returns Subset of conversations satisfying all active predicates
 *
 * @example
 * filterConversations(convs, { search: 'alice', tab: 'unread', sessionId: '', tag: '' })
 * // → only unread conversations whose contactName contains "alice"
 */
export function filterConversations(
  conversations: InboxConversation[],
  filters: InboxFilters
): InboxConversation[] {
  return conversations.filter((conv) => {
    // 1. Search predicate — case-insensitive contactName match
    if (
      filters.search !== '' &&
      !conv.contactName.toLowerCase().includes(filters.search.toLowerCase())
    ) {
      return false;
    }

    // 2. Tab predicate — unread-only when tab is 'unread'
    if (filters.tab === 'unread' && conv.unread !== true) {
      return false;
    }

    // 3. Session predicate — exact sessionId match
    if (filters.sessionId !== '' && conv.sessionId !== filters.sessionId) {
      return false;
    }

    // 4. Tag predicate — conversation must include the selected tag
    if (filters.tag !== '' && !conv.tags.includes(filters.tag)) {
      return false;
    }

    return true;
  });
}

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────

/**
 * InboxView — Two-panel unified inbox for reading and replying to Facebook
 * conversations across all managed sessions.
 *
 * Left panel: filterable conversation list with search, tab, session, and tag filters.
 * Right panel: full message thread with reply textarea, Send button, and AI Generate button.
 *
 * On mount it fetches conversations and starts polling every UNREAD_POLL_INTERVAL_MS.
 * Polling starts unconditionally regardless of whether the initial fetch succeeds.
 */
export function InboxView() {
  const {
    // ── Conversation list state ───────────────────────────────────────────
    conversations,
    activeConversation,
    fetchConversations,
    fetchThread,
    setActiveConversation,
    // ── Thread panel state ────────────────────────────────────────────────
    activeThread,
    sendReply,
    generateAIReply,
  } = useStore();

  // ── Ref for thread scroll container ────────────────────────────────────
  const threadScrollRef = useRef<HTMLDivElement>(null);

  // ── Local filter state ──────────────────────────────────────────────────
  const [filters, setFilters] = useState<InboxFilters>({
    search: '',
    tab: 'all',
    sessionId: '',
    tag: '',
  });

  // ── Error state ─────────────────────────────────────────────────────────
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Thread panel local state ────────────────────────────────────────────
  /** Current value of the reply textarea. */
  const [replyText, setReplyText] = useState<string>('');
  /** Error message shown near the reply input when sendReply rejects. */
  const [sendError, setSendError] = useState<string | null>(null);
  /** Error message shown near the AI Generate button when generateAIReply rejects. */
  const [aiError, setAiError] = useState<string | null>(null);
  /** True while a sendReply call is in-flight. */
  const [isSending, setIsSending] = useState<boolean>(false);
  /** True while a generateAIReply call is in-flight. */
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // ── Thread auto-scroll effect ───────────────────────────────────────────
  // Fires whenever the thread length changes (new message or initial load).
  useEffect(() => {
    if (threadScrollRef.current) {
      threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight;
    }
  }, [activeThread?.length]);

  // ── Mount effect: fetch + unconditional polling ─────────────────────────
  useEffect(() => {
    // Attempt initial fetch; capture error but do NOT block polling
    fetchConversations().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Failed to load conversations';
      setFetchError(msg);
    });

    // Start polling unconditionally — regardless of fetch success/failure
    const stopPolling = startPolling(fetchConversations, UNREAD_POLL_INTERVAL_MS);
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived data ────────────────────────────────────────────────────────

  /** Unique session IDs across all conversations for the session dropdown. */
  const uniqueSessionIds = Array.from(new Set(conversations.map((c) => c.sessionId)));

  /** Unique tags across all conversations for the tag dropdown. */
  const uniqueTags = Array.from(
    new Set(conversations.flatMap((c) => c.tags))
  ).sort();

  /** Filtered conversation list applied to the rendered rows. */
  const filteredConversations = filterConversations(conversations, filters);

  // ── Handlers ────────────────────────────────────────────────────────────

  /** Handles a conversation row click — sets active conversation and fetches thread. */
  function handleRowClick(conv: InboxConversation): void {
    setActiveConversation(conv);
    void fetchThread(conv.sessionId, conv.contactUid);
  }

  /**
   * Submits the reply textarea value via sendReply.
   * Clears the textarea regardless of success/failure (per Req 2.7/2.8).
   * Sets sendError state if the call rejects.
   */
  async function handleSendReply(): Promise<void> {
    if (!activeConversation) return;
    const trimmed = replyText.trim();
    if (!trimmed) return;

    // Clear textarea immediately (per requirements — regardless of outcome)
    setReplyText('');
    setSendError(null);
    setIsSending(true);

    try {
      await sendReply(activeConversation.sessionId, activeConversation.contactUid, trimmed);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to send reply';
      setSendError(msg);
    } finally {
      setIsSending(false);
    }
  }

  /**
   * Handles keydown events on the reply textarea.
   * Submits on Enter (without Shift) when the value is non-empty after trimming.
   */
  function handleReplyKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendReply();
    }
  }

  /**
   * Calls generateAIReply and populates the reply textarea with the result.
   * Sets aiError state if the call rejects.
   */
  async function handleAIGenerate(): Promise<void> {
    if (!activeConversation) return;
    setAiError(null);
    setIsGenerating(true);

    try {
      const generated = await generateAIReply(
        activeConversation.sessionId,
        activeConversation.contactUid
      );
      setReplyText(generated);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to generate AI reply';
      setAiError(msg);
    } finally {
      setIsGenerating(false);
    }
  }

  // ── Sub-view tab state ─────────────────────────────────────────────────
  /** Active inbox sub-view tab. null = no tab selected (all tabs shown inactive). */
  const [activeInboxTab, setActiveInboxTab] = useState<string | null>(null);

  // ── Render ──────────────────────────────────────────────────────────────

  /** Returns the className for a sub-view tab button based on active state. */
  function getTabClass(tab: string): string {
    return activeInboxTab === tab
      ? 'bg-primary-container text-on-primary rounded-badge px-4 py-1.5 text-label-md font-medium'
      : 'bg-surface-container text-on-surface-variant rounded-badge px-4 py-1.5 text-label-md';
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* ── Sub-view tabs ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-6 pt-4 pb-2">
        <ContentCard padding="sm">
          <div className="flex items-center gap-2">
            <button onClick={() => setActiveInboxTab('messages')} className={getTabClass('messages')}>
              Messages
            </button>
            <button onClick={() => setActiveInboxTab('contacts')} className={getTabClass('contacts')}>
              Contacts
            </button>
            <button onClick={() => setActiveInboxTab('warmup')} className={getTabClass('warmup')}>
              Warm-Up
            </button>
          </div>
        </ContentCard>
      </div>

      {/* ── Contacts placeholder ──────────────────────────────────────── */}
      {activeInboxTab === 'contacts' && (
        <div className="flex-1 overflow-hidden px-6 pb-6 pt-2">
          <ContentCard className="h-full flex items-center justify-center">
            <p className="text-on-surface-variant text-body-md">Coming soon</p>
          </ContentCard>
        </div>
      )}

      {/* ── Warm-Up placeholder ───────────────────────────────────────── */}
      {activeInboxTab === 'warmup' && (
        <div className="flex-1 overflow-hidden px-6 pb-6 pt-2">
          <ContentCard className="h-full flex items-center justify-center">
            <p className="text-on-surface-variant text-body-md">Coming soon</p>
          </ContentCard>
        </div>
      )}

      {/* ── Messages two-panel layout (shown when null or 'messages') ─── */}
      {(activeInboxTab === null || activeInboxTab === 'messages') && (
      <div className="flex flex-1 overflow-hidden">
      {/* ── Left Panel: Conversation List ─────────────────────────────── */}
      <aside className="w-80 flex flex-col border-r border-outline-variant bg-surface-container-lowest shrink-0">

        {/* Search input */}
        <div className="px-3 pt-3 pb-2 shrink-0">
          <div className="flex items-center gap-2 bg-surface-container-high border border-outline-variant rounded px-2 h-9">
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">search</span>
            <input
              type="text"
              placeholder="Search conversations…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
              className="flex-1 bg-transparent text-body-sm font-body-sm text-on-surface placeholder:text-on-surface-variant outline-none border-none"
            />
            {filters.search !== '' && (
              <button
                onClick={() => setFilters((f) => ({ ...f, search: '' }))}
                className="text-on-surface-variant hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>
        </div>

        {/* All / Unread filter tabs */}
        <div className="flex items-center gap-1 px-3 pb-2 shrink-0">
          <button
            onClick={() => setFilters((f) => ({ ...f, tab: 'all' }))}
            className={`flex-1 h-7 rounded text-body-sm font-body-sm font-semibold transition-colors ${
              filters.tab === 'all'
                ? 'bg-surface-container-highest text-on-surface border border-outline-variant'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setFilters((f) => ({ ...f, tab: 'unread' }))}
            className={`flex-1 h-7 rounded text-body-sm font-body-sm font-semibold transition-colors ${
              filters.tab === 'unread'
                ? 'bg-surface-container-highest text-on-surface border border-outline-variant'
                : 'text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            Unread
          </button>
        </div>

        {/* Session dropdown */}
        <div className="px-3 pb-2 shrink-0">
          <div className="flex items-center gap-2 bg-surface-container-high border border-outline-variant rounded px-2 h-8">
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant">account_circle</span>
            <select
              value={filters.sessionId}
              onChange={(e) => setFilters((f) => ({ ...f, sessionId: e.target.value }))}
              className="flex-1 bg-transparent text-body-sm font-body-sm text-on-surface outline-none border-none cursor-pointer"
            >
              <option value="">All Sessions</option>
              {uniqueSessionIds.map((sid) => (
                <option key={sid} value={sid}>
                  {sid.slice(0, 8)}…
                </option>
              ))}
            </select>
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant">expand_more</span>
          </div>
        </div>

        {/* Tag dropdown */}
        <div className="px-3 pb-2 shrink-0">
          <div className="flex items-center gap-2 bg-surface-container-high border border-outline-variant rounded px-2 h-8">
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant">label</span>
            <select
              value={filters.tag}
              onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}
              className="flex-1 bg-transparent text-body-sm font-body-sm text-on-surface outline-none border-none cursor-pointer"
            >
              <option value="">All Tags</option>
              {uniqueTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant">expand_more</span>
          </div>
        </div>

        {/* Error banner */}
        {fetchError !== null && (
          <div className="mx-3 mb-2 px-3 py-2 rounded bg-error-container text-on-error-container text-body-sm font-body-sm flex items-center gap-2 shrink-0">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span className="flex-1 truncate">{fetchError}</span>
            <button
              onClick={() => setFetchError(null)}
              className="shrink-0 hover:opacity-70"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          </div>
        )}

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto scrollbar-hide">
          {/* Empty state */}
          {filteredConversations.length === 0 && (
            <div className="p-6 text-center text-on-surface-variant font-body-sm text-body-sm flex flex-col items-center gap-2">
              <span className="material-symbols-outlined text-[32px] opacity-40">inbox</span>
              {conversations.length === 0
                ? 'No conversations yet. Launch sessions to start polling inbox.'
                : 'No conversations match the current filters.'}
            </div>
          )}

          {/* Conversation rows */}
          {filteredConversations.map((conv) => {
            const isActive =
              activeConversation?.sessionId === conv.sessionId &&
              activeConversation?.contactUid === conv.contactUid;

            return (
              <button
                key={`${conv.sessionId}-${conv.contactUid}`}
                onClick={() => handleRowClick(conv)}
                className={`w-full px-3 py-3 border-b border-outline-variant cursor-pointer flex gap-3 hover:bg-surface-container-high transition-colors text-left ${
                  isActive
                    ? 'bg-primary/5 border-l-2 border-l-primary'
                    : 'border-l-2 border-l-transparent'
                }`}
              >
                {/* Avatar circle */}
                <div className="w-9 h-9 rounded-full bg-surface-container-highest border border-outline-variant flex items-center justify-center font-bold text-on-surface shrink-0 text-sm">
                  {conv.contactName.charAt(0).toUpperCase()}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {/* Unread blue dot */}
                      {conv.unread && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      )}
                      <span
                        className={`font-body-md text-body-md font-semibold truncate ${
                          conv.unread ? 'text-primary' : 'text-on-surface'
                        }`}
                      >
                        {conv.contactName}
                      </span>
                    </div>
                    {/* Relative time */}
                    <span className="font-data-mono text-[10px] text-on-surface-variant shrink-0">
                      {formatRelativeTime(conv.lastMessageTime)}
                    </span>
                  </div>

                  {/* Last message preview */}
                  <p className="font-body-sm text-body-sm text-on-surface-variant truncate">
                    {truncatePreview(conv.lastMessage, LAST_MESSAGE_PREVIEW_MAX_CHARS)}
                  </p>

                  {/* Tags */}
                  {conv.tags.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-0.5">
                      {conv.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[9px] px-1 py-0.5 rounded bg-tertiary/10 text-tertiary border border-tertiary/20 font-bold uppercase"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── Right Panel: Thread ───────────────────────────────────────── */}
      <section className="flex-1 flex flex-col bg-surface-container-lowest min-w-0">

        {/* ── State: No conversation selected ─────────────────────────── */}
        {activeConversation === null && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-on-surface-variant">
            <span className="material-symbols-outlined text-[48px] opacity-30">forum</span>
            <p className="text-body-md font-body-md">Select a conversation to view messages</p>
          </div>
        )}

        {/* ── State: Conversation selected, thread loading ─────────────── */}
        {activeConversation !== null && activeThread === null && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-on-surface-variant">
            <span className="material-symbols-outlined text-[32px] animate-spin opacity-60">progress_activity</span>
            <p className="text-body-sm font-body-sm">Loading messages…</p>
          </div>
        )}

        {/* ── State: Thread loaded ─────────────────────────────────────── */}
        {activeConversation !== null && activeThread !== null && (
          <>
            {/* Thread header */}
            <header className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant bg-surface-container-low shrink-0">
              {/* Avatar */}
              <div className="w-9 h-9 rounded-full bg-surface-container-highest border border-outline-variant flex items-center justify-center font-bold text-on-surface shrink-0 text-sm">
                {activeConversation.contactName.charAt(0).toUpperCase()}
              </div>
              {/* Contact info */}
              <div className="flex flex-col min-w-0">
                <span className="text-body-md font-body-md font-semibold text-on-surface truncate">
                  {activeConversation.contactName}
                </span>
                <span className="text-body-sm font-body-sm text-on-surface-variant font-mono">
                  Session: {activeConversation.sessionId.slice(0, 8)}
                </span>
              </div>
              {/* Unread badge */}
              {activeConversation.unread && (
                <span className="ml-auto shrink-0 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase border border-primary/20">
                  Unread
                </span>
              )}
            </header>

            {/* Message bubbles */}
            <div
              ref={threadScrollRef}
              className="flex-1 overflow-y-auto scrollbar-hide px-4 py-4 flex flex-col gap-3"
            >
              {activeThread.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-on-surface-variant py-12">
                  <span className="material-symbols-outlined text-[32px] opacity-30">chat_bubble</span>
                  <p className="text-body-sm font-body-sm">No messages yet</p>
                </div>
              )}

              {activeThread.map((msg: InboxMessage) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.direction === 'sent' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] px-3 py-2 rounded-2xl text-body-sm font-body-sm ${
                      msg.direction === 'sent'
                        ? 'bg-primary-container text-on-primary-container rounded-br-sm'
                        : 'bg-surface-container-low text-on-surface border border-outline-variant rounded-bl-sm'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                    <p className={`text-[10px] mt-1 ${
                      msg.direction === 'sent' ? 'text-on-primary-container/60 text-right' : 'text-on-surface-variant text-left'
                    }`}>
                      {formatRelativeTime(msg.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Reply bar */}
            <div className="shrink-0 border-t border-outline-variant bg-surface-container-low px-4 py-3 flex flex-col gap-2">

              {/* Send error */}
              {sendError !== null && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-error-container text-on-error-container text-body-sm font-body-sm">
                  <span className="material-symbols-outlined text-[14px]">error</span>
                  <span className="flex-1 truncate">{sendError}</span>
                  <button
                    onClick={() => setSendError(null)}
                    className="shrink-0 hover:opacity-70"
                  >
                    <span className="material-symbols-outlined text-[12px]">close</span>
                  </button>
                </div>
              )}

              {/* Textarea row */}
              <div className="flex items-end gap-2">
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={handleReplyKeyDown}
                  disabled={isSending}
                  placeholder="Type a reply… (Enter to send, Shift+Enter for newline)"
                  rows={2}
                  className="flex-1 resize-none bg-surface-container-high border border-outline-variant rounded px-3 py-2 text-body-sm font-body-sm text-on-surface placeholder:text-on-surface-variant outline-none focus:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed scrollbar-hide"
                />

                {/* Send button */}
                <button
                  onClick={() => void handleSendReply()}
                  disabled={isSending || replyText.trim() === ''}
                  className="h-10 px-4 rounded bg-primary text-on-primary text-body-sm font-body-sm font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {isSending ? (
                    <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                  ) : (
                    <span className="material-symbols-outlined text-[16px]">send</span>
                  )}
                  {isSending ? 'Sending…' : 'Send'}
                </button>
              </div>

              {/* AI Generate row */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleAIGenerate()}
                  disabled={isGenerating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-outline-variant bg-surface-container-high text-on-surface-variant text-body-sm font-body-sm hover:bg-surface-container-highest hover:text-on-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <>
                      <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
                      Generating…
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                      AI Generate
                    </>
                  )}
                </button>

                {/* AI error */}
                {aiError !== null && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-error-container text-on-error-container text-body-sm font-body-sm flex-1 min-w-0">
                    <span className="material-symbols-outlined text-[12px] shrink-0">error</span>
                    <span className="truncate">{aiError}</span>
                    <button
                      onClick={() => setAiError(null)}
                      className="shrink-0 hover:opacity-70 ml-auto"
                    >
                      <span className="material-symbols-outlined text-[12px]">close</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
      </div>
      )}
    </div>
  );
}
