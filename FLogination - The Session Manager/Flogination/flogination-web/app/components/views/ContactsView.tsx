'use client';
import { useState, useEffect, useCallback } from 'react';
import { useStore } from '../../../../../src/store';
import type { Contact, Session } from '../../../../../src/types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Maximum characters shown in the notes preview column. */
const NOTES_PREVIEW_MAX_CHARS = 60;

/** Predefined tag options for quick-add and tag filter dropdown. */
const QUICK_TAGS = ['buyer', 'seller', 'lead', 'warm', 'cold', 'vip', 'blocked'] as const;

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** Sort field options for the contacts table. */
type SortField = 'fbName' | 'lastInteraction';

/** Sort direction. */
type SortDir = 'asc' | 'desc';

/** Combined sort state. */
interface SortState {
  field: SortField;
  dir: SortDir;
}

// ─────────────────────────────────────────────
// PURE HELPERS
// ─────────────────────────────────────────────

/**
 * Parses a JSON tag string from a Contact record.
 * Returns an empty array on parse failure.
 *
 * @param raw - JSON-encoded string array, e.g. '["buyer","warm"]'
 * @returns Parsed string array, or [] on failure
 *
 * @example
 * parseTags('["buyer","lead"]') // → ['buyer', 'lead']
 * parseTags('invalid')          // → []
 */
export function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as string[];
    return [];
  } catch {
    return [];
  }
}

/**
 * Formats a Unix millisecond timestamp as a human-readable relative time string.
 *
 * @param ts - Unix millisecond timestamp, or undefined
 * @returns Relative time string such as "2h ago", "3d ago", or "—" when absent
 *
 * @example
 * relativeTime(Date.now() - 3_600_000) // → "1h ago"
 * relativeTime(undefined)              // → "—"
 */
export function relativeTime(ts: number | undefined): string {
  if (ts === undefined || ts === 0) return '—';
  const diffMs = Date.now() - ts;
  const diffSec = Math.floor(diffMs / 1_000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w ago`;
  return `${Math.floor(diffDay / 30)}mo ago`;
}

/**
 * Returns Tailwind CSS classes for a contact tag pill based on the tag name.
 *
 * @param tag - Tag string (e.g. 'buyer', 'blocked')
 * @returns Space-separated Tailwind class string
 *
 * @example
 * tagPillClass('buyer')   // → 'bg-[#0d2a1a] text-[#3fb950] border-[#1b4a2a]'
 * tagPillClass('unknown') // → 'bg-surface-container text-on-surface-variant border-outline-variant'
 */
export function tagPillClass(tag: string): string {
  switch (tag) {
    case 'buyer':   return 'bg-[#0d2a1a] text-[#3fb950] border-[#1b4a2a]';
    case 'seller':  return 'bg-[#1a1a2a] text-[#a2c9ff] border-[#2a2a4a]';
    case 'lead':    return 'bg-[#2b1a0d] text-[#ffba42] border-[#4a321b]';
    case 'warm':    return 'bg-[#2a1a0d] text-[#ffba42] border-[#4a321b]';
    case 'cold':    return 'bg-[#1a1a2a] text-[#8ab4f8] border-[#2a2a4a]';
    case 'vip':     return 'bg-[#2a0d2a] text-[#d8baff] border-[#4a1b4a]';
    case 'blocked': return 'bg-[#2a0d11] text-[#f85149] border-[#4a1b22]';
    default:        return 'bg-surface-container text-on-surface-variant border-outline-variant';
  }
}

/**
 * Filters a contact array by a search string across fbName, fbUid, and notes fields.
 * Matching is case-insensitive. Returns all contacts when search is empty.
 *
 * @param contacts - Array of Contact records to filter
 * @param search   - Search string; empty string returns all contacts
 * @returns Filtered array containing only contacts that match the search
 *
 * @example
 * filterContacts(contacts, 'john') // → contacts whose name/uid/notes contain 'john'
 * filterContacts(contacts, '')     // → all contacts
 */
export function filterContacts(contacts: Contact[], search: string): Contact[] {
  if (!search) return contacts;
  const needle = search.toLowerCase();
  return contacts.filter(
    (c) =>
      (c.fbName ?? '').toLowerCase().includes(needle) ||
      c.fbUid.toLowerCase().includes(needle) ||
      c.notes.toLowerCase().includes(needle)
  );
}

/**
 * Sorts a contact array by the given field and direction.
 * fbName uses localeCompare; lastInteraction uses numeric comparison.
 * Returns a new array — does not mutate the input.
 *
 * @param contacts - Array of Contact records to sort
 * @param field    - Sort field: 'fbName' or 'lastInteraction'
 * @param dir      - Sort direction: 'asc' or 'desc'
 * @returns New sorted array
 *
 * @example
 * sortContacts(contacts, 'fbName', 'asc')           // → alphabetical A→Z
 * sortContacts(contacts, 'lastInteraction', 'desc') // → most recent first
 */
export function sortContacts(
  contacts: Contact[],
  field: SortField,
  dir: SortDir
): Contact[] {
  return [...contacts].sort((a, b) => {
    let cmp = 0;
    if (field === 'fbName') {
      cmp = (a.fbName ?? '').localeCompare(b.fbName ?? '');
    } else {
      cmp = (a.lastInteraction ?? 0) - (b.lastInteraction ?? 0);
    }
    return dir === 'asc' ? cmp : -cmp;
  });
}

/**
 * Adds a tag to a tag list if not already present.
 * The tag is trimmed and lowercased before insertion.
 * Returns the original array unchanged if the tag is empty or already present (idempotent).
 *
 * @param tags - Current tag array
 * @param tag  - Tag string to add
 * @returns New array with the tag appended, or the original array if no change
 *
 * @example
 * addTag(['buyer'], 'lead')   // → ['buyer', 'lead']
 * addTag(['buyer'], 'buyer')  // → ['buyer'] (idempotent)
 * addTag(['buyer'], '  ')     // → ['buyer'] (empty after trim)
 */
export function addTag(tags: string[], tag: string): string[] {
  const trimmed = tag.trim().toLowerCase();
  if (!trimmed || tags.includes(trimmed)) return tags;
  return [...tags, trimmed];
}

/**
 * Removes a tag from a tag list.
 * Returns a new array without the specified tag.
 * If the tag is not present, returns a copy of the original array.
 *
 * @param tags - Current tag array
 * @param tag  - Tag string to remove
 * @returns New array with the tag removed
 *
 * @example
 * removeTag(['buyer', 'lead'], 'lead') // → ['buyer']
 * removeTag(['buyer'], 'vip')          // → ['buyer']
 */
export function removeTag(tags: string[], tag: string): string[] {
  return tags.filter((t) => t !== tag);
}

// ─────────────────────────────────────────────
// SEND MESSAGE MODAL (Task 5)
// ─────────────────────────────────────────────

/** Props for the SendMessageModal component. */
interface SendMessageModalProps {
  contact: Contact;
  sessions: Session[];
  onClose: () => void;
}

/**
 * Modal for sending a cross-account direct message to a contact.
 * Lets the operator pick which live session to send from.
 *
 * @param contact  - The contact to message
 * @param sessions - All sessions (filtered to live inside the modal)
 * @param onClose  - Callback to close the modal
 */
function SendMessageModal({ contact, sessions, onClose }: SendMessageModalProps) {
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  const liveSessions = sessions.filter((s) => s.healthStatus === 'live');

  const handleSend = async () => {
    if (!selectedSessionId || !messageText.trim()) return;
    setIsSending(true);
    try {
      const res = await fetch(`/api/contacts/${contact.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: selectedSessionId, text: messageText }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      setResult(data);
    } catch (e: unknown) {
      setResult({ success: false, error: e instanceof Error ? e.message : 'Network error' });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-surface-container-low border border-outline-variant rounded w-[480px] flex flex-col">
        {/* Header */}
        <div className="h-10 border-b border-outline-variant flex items-center justify-between px-4 bg-surface-container-highest">
          <span className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[16px]">send</span>
            Message {contact.fbName ?? contact.fbUid}
          </span>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface transition-colors">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {/* Session selector */}
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1">
              Send From Session
            </label>
            <select
              className="w-full h-8 ide-input px-2 font-data-mono text-[11px] rounded"
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              disabled={liveSessions.length === 0}
            >
              {liveSessions.length === 0
                ? <option value="">No live sessions</option>
                : <>
                    <option value="">Select session...</option>
                    {liveSessions.map((s) => (
                      <option key={s.id} value={s.id}>{s.fbName} ({s.country})</option>
                    ))}
                  </>
              }
            </select>
          </div>

          {/* Message textarea */}
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1">
              Message
            </label>
            <textarea
              className="w-full h-24 ide-input p-2 font-data-mono text-data-mono resize-none rounded scrollbar-hide"
              placeholder="Type your message..."
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
            />
          </div>

          {/* Result feedback */}
          {result && (
            <div className={`px-3 py-2 rounded border font-body-sm text-body-sm flex items-center gap-2 ${
              result.success
                ? 'bg-[#0d2a1a] text-[#3fb950] border-[#1b4a2a]'
                : 'bg-[#2a0d11] text-[#f85149] border-[#4a1b22]'
            }`}>
              <span className="material-symbols-outlined text-[14px]">
                {result.success ? 'check_circle' : 'error'}
              </span>
              {result.success ? 'Message sent successfully.' : result.error}
            </div>
          )}
        </div>

        <div className="p-3 border-t border-outline-variant flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-8 px-4 border border-outline-variant text-on-surface font-body-sm hover:bg-surface-container-high transition-colors rounded"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || !selectedSessionId || !messageText.trim()}
            className="h-8 px-5 bg-primary-container text-surface-container-lowest font-semibold font-body-sm flex items-center gap-2 hover:opacity-90 disabled:opacity-50 rounded"
          >
            <span className="material-symbols-outlined text-[14px]">send</span>
            {isSending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// DETAIL PANEL (Task 4)
// ─────────────────────────────────────────────

/** Props for the DetailPanel component. */
interface DetailPanelProps {
  contact: Contact;
  sessions: Session[];
  onTagsChange: (id: string, tags: string[]) => void;
  onNotesChange: (id: string, notes: string) => void;
  onSendMessage: (contact: Contact) => void;
}

/**
 * Right-side detail panel showing full contact info, tag editor, notes, and interaction history.
 * Resets local state whenever the selected contact changes.
 *
 * @param contact        - The currently selected contact
 * @param sessions       - All sessions (used to resolve firstSeenVia session name)
 * @param onTagsChange   - Callback invoked after every tag mutation
 * @param onNotesChange  - Callback invoked when the operator saves notes
 * @param onSendMessage  - Callback to open the send-message modal for this contact
 */
function DetailPanel({ contact, sessions, onTagsChange, onNotesChange, onSendMessage }: DetailPanelProps) {
  const [localTags, setLocalTags] = useState<string[]>(parseTags(contact.tags));
  const [notes, setNotes] = useState(contact.notes ?? '');
  const [tagInput, setTagInput] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);

  // Reset panel state when the selected contact changes
  useEffect(() => {
    setLocalTags(parseTags(contact.tags));
    setNotes(contact.notes ?? '');
    setNotesDirty(false);
    setTagInput('');
  }, [contact.id, contact.tags, contact.notes]);

  const handleAddTag = (tag: string) => {
    const next = addTag(localTags, tag);
    if (next === localTags) return; // no change (idempotent or empty)
    setLocalTags(next);
    onTagsChange(contact.id, next);
    setTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    const next = removeTag(localTags, tag);
    setLocalTags(next);
    onTagsChange(contact.id, next);
  };

  const handleSaveNotes = () => {
    onNotesChange(contact.id, notes);
    setNotesDirty(false);
  };

  const firstSeenSession = sessions.find((s) => s.id === contact.firstSeenVia);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Contact header */}
      <div className="p-3 border-b border-outline-variant bg-surface-container-highest">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-surface-container-low border border-outline-variant flex items-center justify-center shrink-0">
            <span className="font-data-mono text-[14px] text-on-surface uppercase">
              {(contact.fbName ?? contact.fbUid).charAt(0)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-data-mono text-data-mono text-on-surface truncate">
              {contact.fbName ?? '—'}
            </div>
            <div className="font-data-mono text-[9px] text-on-surface-variant">
              UID: {contact.fbUid}
            </div>
          </div>
          <button
            onClick={() => onSendMessage(contact)}
            className="h-7 px-3 bg-primary-container text-surface-container-lowest font-body-sm text-[10px] flex items-center gap-1 rounded hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-[12px]">send</span>
            Message
          </button>
        </div>

        {contact.profileUrl && (
          <a
            href={contact.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center gap-1 font-data-mono text-[9px] text-primary hover:underline"
          >
            <span className="material-symbols-outlined text-[10px]">open_in_new</span>
            {contact.profileUrl}
          </a>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-hide p-3 flex flex-col gap-3">
        {/* Meta grid */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-surface-container-lowest border border-outline-variant rounded p-2">
            <div className="font-label-caps text-[9px] text-on-surface-variant uppercase mb-0.5">First Seen Via</div>
            <div className="font-data-mono text-[10px] text-on-surface truncate">
              {firstSeenSession?.fbName ?? '—'}
            </div>
          </div>
          <div className="bg-surface-container-lowest border border-outline-variant rounded p-2">
            <div className="font-label-caps text-[9px] text-on-surface-variant uppercase mb-0.5">Last Interaction</div>
            <div className="font-data-mono text-[10px] text-on-surface">
              {relativeTime(contact.lastInteraction)}
            </div>
          </div>
        </div>

        {/* Tags section */}
        <div>
          <div className="font-label-caps text-label-caps text-on-surface-variant uppercase mb-1.5">Tags</div>
          <div className="flex flex-wrap gap-1 mb-2">
            {localTags.map((tag) => (
              <span
                key={tag}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[9px] uppercase tracking-wider ${tagPillClass(tag)}`}
              >
                {tag}
                <button onClick={() => handleRemoveTag(tag)} className="hover:opacity-70 transition-opacity">
                  <span className="material-symbols-outlined text-[10px]">close</span>
                </button>
              </span>
            ))}
            {localTags.length === 0 && (
              <span className="text-[10px] text-on-surface-variant font-data-mono">No tags</span>
            )}
          </div>

          {/* Quick-add buttons */}
          <div className="flex flex-wrap gap-1 mb-2">
            {QUICK_TAGS.filter((t) => !localTags.includes(t)).map((t) => (
              <button
                key={t}
                onClick={() => handleAddTag(t)}
                className="px-1.5 py-0.5 rounded-sm border border-dashed border-outline-variant text-[9px] text-on-surface-variant hover:border-primary hover:text-primary transition-colors uppercase tracking-wider"
              >
                + {t}
              </button>
            ))}
          </div>

          {/* Custom tag input */}
          <div className="flex gap-1">
            <input
              className="flex-1 h-7 ide-input px-2 font-data-mono text-[10px] rounded"
              placeholder="Custom tag..."
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddTag(tagInput); }}
            />
            <button
              onClick={() => handleAddTag(tagInput)}
              disabled={!tagInput.trim()}
              className="h-7 px-2 border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high disabled:opacity-40 transition-colors rounded"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
            </button>
          </div>
        </div>

        {/* Notes section */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <div className="font-label-caps text-label-caps text-on-surface-variant uppercase">Notes</div>
            {notesDirty && (
              <button
                onClick={handleSaveNotes}
                className="h-6 px-2 bg-primary-container text-surface-container-lowest font-body-sm text-[9px] rounded hover:opacity-90 transition-opacity"
              >
                Save
              </button>
            )}
          </div>
          <textarea
            className="w-full h-24 ide-input p-2 font-data-mono text-[10px] resize-none rounded scrollbar-hide"
            placeholder="Add notes about this contact..."
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setNotesDirty(true); }}
          />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// CONTACTS VIEW
// ─────────────────────────────────────────────

/**
 * ContactsView — CRM-style contacts table with sortable columns, tag/search filtering,
 * a stats bar, a detail panel, and a cross-account send-message modal.
 *
 * Structure:
 *  - StatsBar: total, buyers, leads, warm counts from contactStats
 *  - FilterBar: search input + tag filter dropdown
 *  - ContactsTable: sortable rows with avatar, name, FB UID, tags, last interaction,
 *    first seen via, notes preview, and actions
 *  - DetailPanel (Task 4): shown when a contact row is selected
 *  - SendMessageModal (Task 5): shown when the Message action is triggered
 *
 * @example
 * <ContactsView />
 */
export function ContactsView() {
  const {
    contacts,
    contactStats,
    sessions,
    selectedContactId,
    fetchContacts,
    setSelectedContact,
    updateContactTags,
    updateContactNotes,
  } = useStore();

  // ── Local state ──────────────────────────────
  const [sort, setSort] = useState<SortState>({ field: 'lastInteraction', dir: 'desc' });
  const [tagFilter, setTagFilter] = useState('');
  const [searchText, setSearchText] = useState('');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [messagingContact, setMessagingContact] = useState<Contact | null>(null);

  // ── Mount: fetch contacts ────────────────────
  useEffect(() => {
    setFetchError(null);
    fetchContacts().catch((e: unknown) => {
      setFetchError(e instanceof Error ? e.message : 'Failed to load contacts');
    });
  }, [fetchContacts]);

  // ── Tag filter change: re-fetch from API ─────
  const handleTagFilterChange = (tag: string) => {
    setTagFilter(tag);
    setFetchError(null);
    const fetchArgs = tag ? { tag } : undefined;
    fetchContacts(fetchArgs).catch((e: unknown) => {
      setFetchError(e instanceof Error ? e.message : 'Failed to load contacts');
    });
  };

  // ── Sort toggle ──────────────────────────────
  const handleSortToggle = (field: SortField) => {
    setSort((prev) => {
      if (prev.field === field) {
        return { field, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      // Initial direction per spec: Name → asc, Last Interaction → desc
      return { field, dir: field === 'fbName' ? 'asc' : 'desc' };
    });
  };

  // ── Derived: filtered + sorted contacts ─────
  const displayedContacts = sortContacts(
    filterContacts(contacts, searchText),
    sort.field,
    sort.dir
  );

  const selectedContact = contacts.find((c) => c.id === selectedContactId) ?? null;

  // ── Handlers for detail panel ────────────────
  const handleTagsChange = useCallback(
    (id: string, tags: string[]) => {
      updateContactTags(id, tags).catch(() => {
        // Silent catch — optimistic update already applied in DetailPanel
      });
    },
    [updateContactTags]
  );

  const handleNotesChange = useCallback(
    (id: string, notes: string) => {
      updateContactNotes(id, notes).catch(() => {
        // Silent catch — Save button re-appears via notesDirty state in DetailPanel
      });
    },
    [updateContactNotes]
  );

  // ── Sort icon helper ─────────────────────────
  const sortIcon = (field: SortField): string => {
    if (sort.field !== field) return 'unfold_more';
    return sort.dir === 'asc' ? 'arrow_upward' : 'arrow_downward';
  };

  return (
    <div className="p-container_padding flex flex-col gap-1 h-full overflow-hidden">

      {/* ── Stats bar ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-container-lowest border border-outline-variant rounded-sm shrink-0">
        <h1 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[18px]">contacts</span>
          Contacts CRM
        </h1>
        <div className="flex items-center gap-4 font-data-mono text-data-mono text-on-surface-variant">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[12px]">group</span>
            {contactStats.total} total
          </span>
          <span className="flex items-center gap-1 text-[#3fb950]">
            <span className="material-symbols-outlined text-[12px]">shopping_cart</span>
            {contactStats.buyers} buyers
          </span>
          <span className="flex items-center gap-1 text-[#ffba42]">
            <span className="material-symbols-outlined text-[12px]">trending_up</span>
            {contactStats.leads} leads
          </span>
          <span className="flex items-center gap-1 text-[#d8baff]">
            <span className="material-symbols-outlined text-[12px]">local_fire_department</span>
            {contactStats.warm} warm
          </span>
        </div>
      </div>

      {/* ── Error banner ── */}
      {fetchError && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#2a0d11] border border-[#4a1b22] rounded text-[#f85149] font-body-sm text-[11px] shrink-0">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {fetchError}
        </div>
      )}

      {/* ── Filter bar ── */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Tag filter dropdown */}
        <div className="flex items-center gap-1.5 bg-surface-container-low border border-outline-variant rounded px-2 h-8">
          <span className="material-symbols-outlined text-[14px] text-on-surface-variant">label</span>
          <select
            className="bg-transparent text-on-surface font-data-mono text-[11px] outline-none h-full"
            value={tagFilter}
            onChange={(e) => handleTagFilterChange(e.target.value)}
          >
            <option value="">All Tags</option>
            {QUICK_TAGS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Search input */}
        <div className="flex-1 flex items-center gap-1.5 bg-surface-container-low border border-outline-variant rounded px-2 h-8">
          <span className="material-symbols-outlined text-[14px] text-on-surface-variant">search</span>
          <input
            className="flex-1 bg-transparent text-on-surface font-data-mono text-[11px] outline-none placeholder:text-on-surface-variant"
            placeholder="Search name, UID, notes..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Main content: table + detail panel ── */}
      <div className="flex-1 flex gap-1 overflow-hidden">

        {/* Contacts table */}
        <div className="flex-1 bg-surface-container-low border border-outline-variant rounded flex flex-col overflow-hidden">
          <div className="overflow-auto flex-1 scrollbar-hide">
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-surface-container-low border-b border-outline-variant z-10">
                <tr>
                  {/* Avatar column */}
                  <th className="px-3 py-1 font-label-caps text-label-caps text-on-surface-variant w-8" />

                  {/* Name — sortable, initial direction asc */}
                  <th
                    className="px-3 py-1 font-label-caps text-label-caps text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors select-none"
                    onClick={() => handleSortToggle('fbName')}
                  >
                    <span className="flex items-center gap-1">
                      Name
                      <span className="material-symbols-outlined text-[12px]">{sortIcon('fbName')}</span>
                    </span>
                  </th>

                  <th className="px-3 py-1 font-label-caps text-label-caps text-on-surface-variant">FB UID</th>
                  <th className="px-3 py-1 font-label-caps text-label-caps text-on-surface-variant">Tags</th>

                  {/* Last Interaction — sortable, initial direction desc */}
                  <th
                    className="px-3 py-1 font-label-caps text-label-caps text-on-surface-variant cursor-pointer hover:text-on-surface transition-colors select-none"
                    onClick={() => handleSortToggle('lastInteraction')}
                  >
                    <span className="flex items-center gap-1">
                      Last Interaction
                      <span className="material-symbols-outlined text-[12px]">{sortIcon('lastInteraction')}</span>
                    </span>
                  </th>

                  <th className="px-3 py-1 font-label-caps text-label-caps text-on-surface-variant">First Seen Via</th>
                  <th className="px-3 py-1 font-label-caps text-label-caps text-on-surface-variant">Notes</th>
                  <th className="px-3 py-1 font-label-caps text-label-caps text-on-surface-variant">Actions</th>
                </tr>
              </thead>

              <tbody className="font-data-mono text-data-mono">
                {/* Empty state */}
                {displayedContacts.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-on-surface-variant">
                      <div className="flex flex-col items-center gap-2">
                        <span className="material-symbols-outlined text-[32px] opacity-40">person_search</span>
                        <span className="font-body-sm text-[11px]">
                          {contacts.length === 0 ? 'No contacts yet.' : 'No contacts match your filter.'}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}

                {/* Contact rows */}
                {displayedContacts.map((contact) => {
                  const isSelected = contact.id === selectedContactId;
                  const tags = parseTags(contact.tags);
                  const initial = (contact.fbName ?? contact.fbUid).charAt(0).toUpperCase();
                  const firstSeenSession = sessions.find((s) => s.id === contact.firstSeenVia);
                  const notesPreview = contact.notes.length > NOTES_PREVIEW_MAX_CHARS
                    ? `${contact.notes.slice(0, NOTES_PREVIEW_MAX_CHARS)}…`
                    : contact.notes;

                  return (
                    <tr
                      key={contact.id}
                      onClick={() => setSelectedContact(isSelected ? null : contact.id)}
                      className={`h-[28px] border-b border-outline-variant cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-secondary-container/10 border-l-2 border-l-primary'
                          : 'hover:bg-surface-container-highest'
                      }`}
                    >
                      {/* Avatar — initials circle */}
                      <td className="px-3 py-1">
                        <div className="w-6 h-6 rounded-full bg-primary-container flex items-center justify-center shrink-0">
                          <span className="font-data-mono text-[10px] text-surface-container-lowest font-semibold">
                            {initial}
                          </span>
                        </div>
                      </td>

                      {/* Name */}
                      <td className="px-3 py-1 text-on-surface max-w-[140px] truncate">
                        {contact.fbName ?? '—'}
                      </td>

                      {/* FB UID */}
                      <td className="px-3 py-1 text-on-surface-variant text-[10px]">
                        {contact.fbUid}
                      </td>

                      {/* Tags — up to 3 pills */}
                      <td className="px-3 py-1">
                        <div className="flex items-center gap-1">
                          {tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className={`inline-flex items-center px-1 py-0.5 rounded-sm border text-[8px] uppercase tracking-wider ${tagPillClass(tag)}`}
                            >
                              {tag}
                            </span>
                          ))}
                          {tags.length > 3 && (
                            <span className="text-[9px] text-on-surface-variant">+{tags.length - 3}</span>
                          )}
                        </div>
                      </td>

                      {/* Last Interaction */}
                      <td className="px-3 py-1 text-on-surface-variant text-[10px]">
                        {relativeTime(contact.lastInteraction)}
                      </td>

                      {/* First Seen Via — resolve session fbName */}
                      <td className="px-3 py-1 text-on-surface-variant text-[10px] max-w-[120px] truncate">
                        {firstSeenSession?.fbName ?? '—'}
                      </td>

                      {/* Notes preview */}
                      <td className="px-3 py-1 text-on-surface-variant text-[10px] max-w-[160px] truncate">
                        {notesPreview || '—'}
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMessagingContact(contact);
                          }}
                          className="h-6 px-2 border border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary transition-colors rounded flex items-center gap-1 text-[9px]"
                        >
                          <span className="material-symbols-outlined text-[11px]">send</span>
                          Message
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail panel — rendered when a contact is selected (Task 4) */}
        {selectedContact && (
          <div className="w-[300px] shrink-0 bg-surface-container-low border border-outline-variant rounded overflow-hidden">
            <DetailPanel
              contact={selectedContact}
              sessions={sessions}
              onTagsChange={handleTagsChange}
              onNotesChange={handleNotesChange}
              onSendMessage={setMessagingContact}
            />
          </div>
        )}
      </div>

      {/* Send message modal — rendered when messagingContact is set (Task 5) */}
      {messagingContact && (
        <SendMessageModal
          contact={messagingContact}
          sessions={sessions}
          onClose={() => setMessagingContact(null)}
        />
      )}
    </div>
  );
}
