/**
 * Flogination V5 — Inbox Manager
 *
 * Aggregates Facebook Messenger conversations from all active sessions
 * into a unified inbox accessible from the dashboard.
 *
 * How it works:
 *  1. For each active session, a polling loop runs every N seconds (default 60s).
 *  2. The loop navigates to facebook.com/messages and extracts conversation data.
 *  3. Conversations are stored in an in-memory Map keyed by sessionId.
 *  4. The API aggregates all sessions' conversations into a single sorted list.
 *  5. When a reply is sent, the browser navigates to the conversation thread
 *     and types the message using human-like input simulation.
 *
 * Contact integration:
 *  - Every new conversation automatically upserts a Contact record.
 *  - Sent/received messages are logged as ContactInteractions.
 *
 * Memory model:
 *  - Conversations are in-memory only — cleared on server restart.
 *  - The database stores contact records and interaction history persistently.
 */

import { db_ } from '../database';
import { sessionManager } from '../automation/session-manager';
import { selfHealing } from '../automation/self-healing';
import { stealthBrowser } from '../automation/stealth-browser';
import { contactManager } from './contact-manager';
import type { InboxConversation, InboxMessage } from '../../types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Default polling interval in milliseconds. */
const DEFAULT_POLL_INTERVAL_MS = 60_000;

/** Maximum preview length for last message in conversation list. */
const MAX_PREVIEW_LENGTH = 80;

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────

/**
 * In-memory conversation store.
 * Key: sessionId, Value: array of conversations for that session.
 */
const conversationStore = new Map<string, InboxConversation[]>();

/**
 * Active polling intervals keyed by sessionId.
 */
const pollingIntervals = new Map<string, NodeJS.Timeout>();

/**
 * Unread message counts per session.
 */
const unreadCounts = new Map<string, number>();

// ─────────────────────────────────────────────
// POLLING LIFECYCLE
// ─────────────────────────────────────────────

/**
 * Starts inbox polling for a session.
 * Polls every intervalMs milliseconds to fetch new conversations.
 * Safe to call multiple times — stops any existing poll first.
 *
 * @param sessionId  - The session to start polling for.
 * @param intervalMs - Polling interval in milliseconds (default: 60000).
 *
 * @example
 * inboxManager.startPolling('session-uuid')
 */
function startPolling(sessionId: string, intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
  // Stop any existing poll for this session
  stopPolling(sessionId);

  // Run immediately, then on interval
  pollSession(sessionId).catch(() => {});

  const interval = setInterval(() => {
    pollSession(sessionId).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[inbox-manager] Poll error for session ${sessionId}: ${message}`);
    });
  }, intervalMs);

  pollingIntervals.set(sessionId, interval);
}

/**
 * Stops inbox polling for a session.
 * Clears the interval and removes from the polling map.
 *
 * @param sessionId - The session to stop polling for.
 */
function stopPolling(sessionId: string): void {
  const existing = pollingIntervals.get(sessionId);
  if (existing) {
    clearInterval(existing);
    pollingIntervals.delete(sessionId);
  }
}

/**
 * Stops all active polling intervals.
 * Called on server shutdown.
 */
function stopAllPolling(): void {
  for (const [sessionId] of pollingIntervals) {
    stopPolling(sessionId);
  }
}

// ─────────────────────────────────────────────
// POLL EXECUTION
// ─────────────────────────────────────────────

/**
 * Executes one poll cycle for a session.
 * Navigates to facebook.com/messages and extracts conversation data.
 * Updates the in-memory store and upserts contact records.
 */
async function pollSession(sessionId: string): Promise<void> {
  const page = sessionManager.getPage(sessionId);
  if (!page) return; // Session not active — skip

  try {
    await page.goto('https://www.facebook.com/messages', {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });

    await sleep(2000);

    // Extract conversation list
    const conversations = await extractConversations(page, sessionId);

    // Update in-memory store
    conversationStore.set(sessionId, conversations);

    // Count unread
    const unread = conversations.filter((c) => c.unread).length;
    unreadCounts.set(sessionId, unread);

    // Upsert contacts for all conversations
    for (const conv of conversations) {
      contactManager.upsert(conv.contactUid, {
        fbName: conv.contactName,
        firstSeenVia: sessionId,
      });
    }
  } catch {
    // Poll failure is non-fatal — keep the existing store data
  }
}

/**
 * Extracts conversation data from the Facebook Messages page.
 * Returns an array of InboxConversation objects.
 */
async function extractConversations(
  page: import('playwright-core').Page,
  sessionId: string
): Promise<InboxConversation[]> {
  const conversations: InboxConversation[] = [];

  try {
    // Find conversation list items
    const convElements = await page.$$('[data-testid="mwthreadlist-item"], [role="row"]');

    for (const el of convElements.slice(0, 50)) { // cap at 50 conversations
      try {
        const nameEl = await el.$('[data-testid="mwthreadlist-item-name"], span[dir="auto"]');
        const name = await nameEl?.textContent() ?? '';

        const previewEl = await el.$('[data-testid="mwthreadlist-item-preview"], span[dir="ltr"]');
        const preview = await previewEl?.textContent() ?? '';

        const linkEl = await el.$('a[href*="/messages/t/"]');
        const href = await linkEl?.getAttribute('href') ?? '';

        // Extract contact UID from messenger URL
        const uidMatch = href.match(/\/messages\/t\/(\d+)/) ?? href.match(/\/messages\/t\/([^/?]+)/);
        const contactUid = uidMatch ? uidMatch[1] : '';

        if (!contactUid || !name.trim()) continue;

        // Check for unread indicator
        const unreadEl = await el.$('[aria-label*="unread"], [data-testid="unread-indicator"]');
        const isUnread = unreadEl !== null;

        // Get contact tags from CRM
        const contact = contactManager.getByFbUid(contactUid);
        const tags = contact ? contactManager.parseTags(contact) : [];

        conversations.push({
          sessionId,
          contactUid,
          contactName: name.trim(),
          lastMessage: preview.trim().slice(0, MAX_PREVIEW_LENGTH),
          lastMessageTime: Date.now(), // approximate — FB doesn't always show exact time
          unread: isUnread,
          tags,
        });
      } catch {
        // Skip malformed conversation elements
      }
    }
  } catch {
    // Extraction failure — return empty array
  }

  return conversations;
}

// ─────────────────────────────────────────────
// CONVERSATION QUERIES
// ─────────────────────────────────────────────

/**
 * Returns all conversations aggregated across all active sessions.
 * Sorted by lastMessageTime descending (most recent first).
 *
 * @param filters - Optional filters: sessionId, tag, unreadOnly.
 * @returns Array of InboxConversation objects.
 *
 * @example
 * const all = inboxManager.getConversations()
 * const unread = inboxManager.getConversations({ unreadOnly: true })
 * const buyers = inboxManager.getConversations({ tag: 'buyer' })
 */
function getConversations(filters?: {
  sessionId?: string;
  tag?: string;
  unreadOnly?: boolean;
}): InboxConversation[] {
  let all: InboxConversation[] = [];

  if (filters?.sessionId) {
    all = conversationStore.get(filters.sessionId) ?? [];
  } else {
    for (const convs of conversationStore.values()) {
      all.push(...convs);
    }
  }

  // Apply filters
  if (filters?.unreadOnly) {
    all = all.filter((c) => c.unread);
  }
  if (filters?.tag) {
    all = all.filter((c) => c.tags.includes(filters.tag!));
  }

  // Sort by most recent first
  return all.sort((a, b) => b.lastMessageTime - a.lastMessageTime);
}

/**
 * Returns the total unread message count across all sessions.
 * Used by the sidebar badge.
 */
function getTotalUnreadCount(): number {
  let total = 0;
  for (const count of unreadCounts.values()) {
    total += count;
  }
  return total;
}

/**
 * Alias for getTotalUnreadCount.
 * Returns the total unread message count across all sessions.
 *
 * @returns Total number of unread conversations across all polled sessions.
 *
 * @example
 * const unread = inboxManager.getUnreadCount() // → 5
 */
function getUnreadCount(): number {
  return getTotalUnreadCount();
}

// ─────────────────────────────────────────────
// MESSAGE THREAD
// ─────────────────────────────────────────────

/**
 * Fetches the full message thread for a specific conversation.
 * Navigates to the conversation in the session's browser and extracts messages.
 *
 * @param sessionId  - The session that owns this conversation.
 * @param contactUid - The Facebook UID of the contact.
 * @returns Array of InboxMessage objects, ordered oldest-first.
 *
 * @example
 * const thread = await inboxManager.getThread('session-uuid', '123456789')
 */
async function getThread(
  sessionId: string,
  contactUid: string
): Promise<InboxMessage[]> {
  const page = sessionManager.getPage(sessionId);
  if (!page) return [];

  const messages: InboxMessage[] = [];

  try {
    await page.goto(`https://www.facebook.com/messages/t/${contactUid}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    await sleep(2000);

    // Extract message bubbles
    const messageEls = await page.$$('[data-testid="message-container"], [role="row"]');

    for (const el of messageEls) {
      try {
        const textEl = await el.$('[data-testid="message-text"], span[dir="auto"]');
        const text = await textEl?.textContent() ?? '';
        if (!text.trim()) continue;

        // Determine direction: sent messages have a different class/position
        const isSent = await el.evaluate((node) => {
          return node.classList.contains('sent') ||
            node.getAttribute('data-direction') === 'sent' ||
            node.querySelector('[aria-label*="You"]') !== null;
        });

        messages.push({
          id: `msg-${Date.now()}-${Math.random()}`,
          text: text.trim(),
          direction: isSent ? 'sent' : 'received',
          timestamp: Date.now(),
        });
      } catch {
        // Skip malformed message elements
      }
    }
  } catch {
    // Thread fetch failure — return empty array
  }

  return messages;
}

// ─────────────────────────────────────────────
// SEND REPLY
// ─────────────────────────────────────────────

/**
 * Sends a reply message in a conversation.
 * Uses human-like typing simulation via the session's browser.
 *
 * @param sessionId  - The session to send from.
 * @param contactUid - The Facebook UID of the recipient.
 * @param text       - The message text to send.
 * @returns Success or failure with an error message.
 *
 * @example
 * const result = await inboxManager.sendReply('session-uuid', '123456789', 'Hello!')
 */
async function sendReply(
  sessionId: string,
  contactUid: string,
  text: string
): Promise<{ success: boolean; error?: string }> {
  const page = sessionManager.getPage(sessionId);
  if (!page) {
    return { success: false, error: 'Session not running' };
  }

  try {
    await page.goto(`https://www.facebook.com/messages/t/${contactUid}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15_000,
    });
    await sleep(1500);

    // Find message input and type using human-like simulation
    const inputResult = await selfHealing.withHealing(
      page, 'fb_messenger_reply_input',
      '[contenteditable="true"][aria-label*="message"], [data-testid="message-input"], [role="textbox"]',
      async (sel) => {
        await page.click(sel);
        await sleep(300);
        // Use stealthBrowser.humanType for realistic keystroke timing and hesitation pauses
        await stealthBrowser.humanType(page, sel, text);
      }
    );

    if (!inputResult.success) {
      return { success: false, error: 'Could not find message input field' };
    }

    await sleep(300);
    await page.keyboard.press('Enter');
    await sleep(1000);

    // Log the interaction
    contactManager.logInteraction(contactUid, sessionId, 'dm', 'sent', text);

    db_.logActivity(sessionId, 'inbox_message_sent', `Sent message to ${contactUid} (${text.length} chars)`);

    // Mark conversation as read in store
    const convs = conversationStore.get(sessionId) ?? [];
    const conv = convs.find((c) => c.contactUid === contactUid);
    if (conv) conv.unread = false;

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Sends a direct message to a user by UID from a specific session.
 * Used by Group Hunter DM outreach and warm-up engine.
 *
 * @param sessionId  - The session to send from.
 * @param contactUid - The Facebook UID of the recipient.
 * @param text       - The message text to send.
 * @returns True if sent successfully, false otherwise.
 */
async function sendDM(
  sessionId: string,
  contactUid: string,
  text: string
): Promise<boolean> {
  const result = await sendReply(sessionId, contactUid, text);
  return result.success;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The Inbox Manager — unified multi-session Facebook Messenger interface.
 *
 * @example
 * import { inboxManager } from '../inbox/inbox-manager'
 *
 * // Start polling when a session launches:
 * inboxManager.startPolling(session.id)
 *
 * // Stop polling when a session closes:
 * inboxManager.stopPolling(session.id)
 *
 * // Get all conversations:
 * const conversations = inboxManager.getConversations()
 *
 * // Send a reply:
 * await inboxManager.sendReply(sessionId, contactUid, 'Hello!')
 */
export const inboxManager = {
  /** Starts inbox polling for a session. */
  startPolling,
  /** Stops inbox polling for a session. */
  stopPolling,
  /** Stops all active polling. Call on server shutdown. */
  stopAllPolling,
  /** Returns all conversations across sessions with optional filters. */
  getConversations,
  /** Returns the total unread count across all sessions. */
  getTotalUnreadCount,
  /** Returns the total unread count across all sessions (alias for getTotalUnreadCount). */
  getUnreadCount,
  /** Fetches the full message thread for a conversation. */
  getThread,
  /** Sends a reply in a conversation. */
  sendReply,
  /** Sends a DM to a user. Used by automation tools. */
  sendDM,
};
