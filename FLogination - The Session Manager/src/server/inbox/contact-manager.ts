/**
 * Flogination V5 — Contact Manager (CRM)
 *
 * Tracks every person the operator has interacted with across all sessions.
 * Acts as a lightweight CRM for buyers, sellers, and leads.
 *
 * Key capabilities:
 *  - Upsert contacts by Facebook UID — one record per person regardless of
 *    how many sessions have interacted with them.
 *  - Tag contacts: buyer, seller, lead, warm, cold.
 *  - Track full interaction history: DMs, comments, group post replies.
 *  - Cross-account visibility: see which sessions have talked to a contact.
 *  - Known contact detection: flag contacts already in the CRM when they
 *    appear in Group Hunter scraped member lists.
 *
 * All data is stored in SQLite via the db_ layer.
 * The contact-manager module provides higher-level business logic on top.
 */

import { db_ } from '../database';
import type { Contact, ContactInteraction, InteractionType, InteractionDirection } from '../../types';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** Filters for querying contacts. */
export interface ContactFilters {
  tag?: string;
  sessionId?: string;
  recencyDays?: number;
}

/** A contact with their full interaction history. */
export interface ContactWithHistory extends Contact {
  interactions: ContactInteraction[];
  /** Parsed tags array (from JSON string). */
  tagList: string[];
  /** Number of sessions that have interacted with this contact. */
  sessionCount: number;
}

// ─────────────────────────────────────────────
// UPSERT
// ─────────────────────────────────────────────

/**
 * Creates or updates a contact record by Facebook UID.
 * If the contact already exists, updates their name and lastInteraction.
 * If new, creates a fresh record with the provided data.
 *
 * @param fbUid       - The Facebook UID of the contact.
 * @param data        - Optional data to set on creation or update.
 * @returns The contact record (created or updated).
 *
 * @example
 * const contact = contactManager.upsert('123456789', {
 *   fbName: 'John Doe',
 *   firstSeenVia: sessionId,
 * })
 */
function upsert(
  fbUid: string,
  data?: {
    fbName?: string;
    profileUrl?: string;
    firstSeenVia?: string;
    tags?: string[];
    notes?: string;
  }
): Contact {
  return db_.upsertContact(fbUid, {
    fbName: data?.fbName,
    profileUrl: data?.profileUrl,
    firstSeenVia: data?.firstSeenVia,
    tags: data?.tags ? JSON.stringify(data.tags) : undefined,
    notes: data?.notes,
  });
}

// ─────────────────────────────────────────────
// INTERACTION LOGGING
// ─────────────────────────────────────────────

/**
 * Records an interaction with a contact.
 * Automatically upserts the contact if they don't exist yet.
 *
 * @param fbUid     - The Facebook UID of the contact.
 * @param sessionId - The session that performed the interaction.
 * @param type      - The type of interaction.
 * @param direction - 'sent' (we initiated) or 'received' (they initiated).
 * @param content   - The message or comment content (optional).
 * @returns The created ContactInteraction record.
 *
 * @example
 * contactManager.logInteraction('123456789', sessionId, 'dm', 'sent', 'Hi! Interested?')
 */
function logInteraction(
  fbUid: string,
  sessionId: string,
  type: InteractionType,
  direction: InteractionDirection,
  content?: string
): ContactInteraction {
  // Ensure contact exists
  const contact = db_.upsertContact(fbUid, { firstSeenVia: sessionId });

  return db_.insertContactInteraction({
    contactId: contact.id,
    sessionId,
    type,
    content,
    direction,
    timestamp: Date.now(),
  });
}

/**
 * Records an interaction directly by contact UUID (no fbUid lookup required).
 * Use this when you already have the contact's internal ID from a prior query.
 *
 * Signature matches the task spec: insertInteraction(contactId, sessionId, type, content, direction)
 *
 * @param contactId - The contact's internal UUID.
 * @param sessionId - The session that performed the interaction.
 * @param type      - The type of interaction.
 * @param content   - The message or comment content (optional).
 * @param direction - 'sent' (we initiated) or 'received' (they initiated).
 * @returns The created ContactInteraction record, or undefined if contact not found.
 *
 * @example
 * contactManager.insertInteraction(contact.id, sessionId, 'dm', 'Hi! Interested?', 'sent')
 */
function insertInteraction(
  contactId: string,
  sessionId: string,
  type: InteractionType,
  content: string | undefined,
  direction: InteractionDirection
): ContactInteraction | undefined {
  // Verify the contact exists before inserting
  const contact = db_.getContactById(contactId);
  if (!contact) return undefined;

  return db_.insertContactInteraction({
    contactId,
    sessionId,
    type,
    content,
    direction,
    timestamp: Date.now(),
  });
}

// ─────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────

/**
 * Returns contacts with optional filters, enriched with parsed tag list
 * and session count.
 *
 * @param filters - Optional filters: tag, sessionId, recencyDays.
 * @returns Array of enriched contact records.
 *
 * @example
 * // All buyers active in last 30 days:
 * const buyers = contactManager.getContacts({ tag: 'buyer', recencyDays: 30 })
 */
function getContacts(filters?: ContactFilters): ContactWithHistory[] {
  const contacts = db_.getContacts(filters);
  return contacts.map(enrichContact);
}

/**
 * Returns a single contact with their full interaction history.
 *
 * @param id - The contact's internal UUID.
 * @returns The enriched contact, or undefined if not found.
 */
function getContactWithHistory(id: string): ContactWithHistory | undefined {
  const contact = db_.getContactById(id);
  if (!contact) return undefined;

  const interactions = db_.getContactInteractions(id);
  return enrichContactWithInteractions(contact, interactions);
}

/**
 * Returns a contact by their Facebook UID.
 *
 * @param fbUid - The Facebook UID to look up.
 * @returns The contact record, or undefined if not found.
 */
function getByFbUid(fbUid: string): Contact | undefined {
  const contacts = db_.getContacts();
  return contacts.find((c) => c.fbUid === fbUid);
}

/**
 * Checks if a Facebook UID is already in the contact database.
 * Used by Group Hunter to flag known contacts in scraped member lists.
 *
 * @param fbUid - The Facebook UID to check.
 * @returns True if the contact exists, false otherwise.
 */
function isKnownContact(fbUid: string): boolean {
  return getByFbUid(fbUid) !== undefined;
}

/**
 * Returns the tags for a contact as a parsed string array.
 *
 * @param contact - The contact record.
 * @returns Array of tag strings.
 */
function parseTags(contact: Contact): string[] {
  try {
    return JSON.parse(contact.tags || '[]');
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────
// TAG MANAGEMENT
// ─────────────────────────────────────────────

/**
 * Adds a tag to a contact. Does nothing if the tag already exists.
 *
 * @param contactId - The contact's internal UUID.
 * @param tag       - The tag to add (e.g. 'buyer', 'seller', 'warm').
 * @returns The updated contact, or undefined if not found.
 *
 * @example
 * contactManager.addTag(contact.id, 'buyer')
 */
function addTag(contactId: string, tag: string): Contact | undefined {
  const contact = db_.getContactById(contactId);
  if (!contact) return undefined;

  const tags = parseTags(contact);
  if (!tags.includes(tag)) {
    tags.push(tag);
    return db_.updateContact(contactId, { tags: JSON.stringify(tags), notes: contact.notes });
  }
  return contact;
}

/**
 * Removes a tag from a contact.
 *
 * @param contactId - The contact's internal UUID.
 * @param tag       - The tag to remove.
 * @returns The updated contact, or undefined if not found.
 */
function removeTag(contactId: string, tag: string): Contact | undefined {
  const contact = db_.getContactById(contactId);
  if (!contact) return undefined;

  const tags = parseTags(contact).filter((t) => t !== tag);
  return db_.updateContact(contactId, { tags: JSON.stringify(tags), notes: contact.notes });
}

/**
 * Sets all tags for a contact, replacing existing tags.
 *
 * @param contactId - The contact's internal UUID.
 * @param tags      - The new tag array.
 * @returns The updated contact, or undefined if not found.
 */
function setTags(contactId: string, tags: string[]): Contact | undefined {
  const contact = db_.getContactById(contactId);
  if (!contact) return undefined;
  return db_.updateContact(contactId, { tags: JSON.stringify(tags), notes: contact.notes });
}

/**
 * Updates the notes for a contact.
 *
 * @param contactId - The contact's internal UUID.
 * @param notes     - The new notes text.
 * @returns The updated contact, or undefined if not found.
 */
function updateNotes(contactId: string, notes: string): Contact | undefined {
  const contact = db_.getContactById(contactId);
  if (!contact) return undefined;
  return db_.updateContact(contactId, { tags: contact.tags, notes });
}

// ─────────────────────────────────────────────
// TASK-SPEC ALIASES
// These names match the task spec exactly and delegate to the canonical
// implementations above. Callers may use either form.
// ─────────────────────────────────────────────

/**
 * Alias for `upsert` — creates or updates a contact by Facebook UID.
 * Provided to match the task spec naming: upsertContact(fbUid, data).
 *
 * @param fbUid - The Facebook UID of the contact.
 * @param data  - Optional data to set on creation or update.
 * @returns The contact record (created or updated).
 *
 * @example
 * contactManager.upsertContact('123456789', { fbName: 'Jane Doe' })
 */
const upsertContact = upsert;

/**
 * Alias for `setTags` — sets all tags for a contact, replacing existing ones.
 * Provided to match the task spec naming: updateContactTags(contactId, tags).
 *
 * @param contactId - The contact's internal UUID.
 * @param tags      - The new tag array.
 * @returns The updated contact, or undefined if not found.
 *
 * @example
 * contactManager.updateContactTags(contact.id, ['buyer', 'warm'])
 */
const updateContactTags = setTags;

/**
 * Alias for `updateNotes` — updates the notes for a contact.
 * Provided to match the task spec naming: updateContactNotes(contactId, notes).
 *
 * @param contactId - The contact's internal UUID.
 * @param notes     - The new notes text.
 * @returns The updated contact, or undefined if not found.
 *
 * @example
 * contactManager.updateContactNotes(contact.id, 'Interested in bulk deal')
 */
const updateContactNotes = updateNotes;

// ─────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────

/**
 * Returns aggregate contact statistics.
 * Used by the sidebar badge and dashboard widgets.
 *
 * @returns Counts of total contacts and contacts by tag.
 */
function getStats(): {
  total: number;
  buyers: number;
  sellers: number;
  leads: number;
  warm: number;
} {
  const contacts = db_.getContacts();
  return {
    total: contacts.length,
    buyers: contacts.filter((c) => parseTags(c).includes('buyer')).length,
    sellers: contacts.filter((c) => parseTags(c).includes('seller')).length,
    leads: contacts.filter((c) => parseTags(c).includes('lead')).length,
    warm: contacts.filter((c) => parseTags(c).includes('warm')).length,
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Enriches a contact with parsed tags and session count.
 * Loads interactions from DB.
 */
function enrichContact(contact: Contact): ContactWithHistory {
  const interactions = db_.getContactInteractions(contact.id);
  return enrichContactWithInteractions(contact, interactions);
}

/**
 * Enriches a contact with pre-loaded interactions.
 */
function enrichContactWithInteractions(
  contact: Contact,
  interactions: ContactInteraction[]
): ContactWithHistory {
  const sessionIds = new Set(interactions.map((i) => i.sessionId));
  return {
    ...contact,
    interactions,
    tagList: parseTags(contact),
    sessionCount: sessionIds.size,
  };
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The Contact Manager — lightweight CRM for tracking buyers, sellers, and leads.
 *
 * @example
 * import { contactManager } from '../inbox/contact-manager'
 *
 * // After sending a DM:
 * contactManager.logInteraction(recipientUid, sessionId, 'dm', 'sent', messageText)
 *
 * // Tag a contact as a buyer:
 * contactManager.addTag(contact.id, 'buyer')
 *
 * // Check if a scraped UID is already known:
 * if (contactManager.isKnownContact(uid)) {
 *   // Show known_contact indicator in Group Hunter UI
 * }
 */
export const contactManager = {
  /** Creates or updates a contact by Facebook UID. */
  upsert,
  /** Creates or updates a contact by Facebook UID (task-spec alias for upsert). */
  upsertContact,
  /** Records an interaction with a contact (looks up contact by fbUid). */
  logInteraction,
  /** Records an interaction directly by contact UUID (contactId, sessionId, type, content, direction). */
  insertInteraction,
  /** Returns contacts with optional filters. */
  getContacts,
  /** Returns a contact with full interaction history. */
  getContactWithHistory,
  /** Returns a contact by Facebook UID. */
  getByFbUid,
  /** Returns true if a UID is already in the contact database. */
  isKnownContact,
  /** Parses a contact's tags JSON string into an array. */
  parseTags,
  /** Adds a tag to a contact. */
  addTag,
  /** Removes a tag from a contact. */
  removeTag,
  /** Sets all tags for a contact. */
  setTags,
  /** Sets all tags for a contact (task-spec alias for setTags). */
  updateContactTags,
  /** Updates the notes for a contact. */
  updateNotes,
  /** Updates the notes for a contact (task-spec alias for updateNotes). */
  updateContactNotes,
  /** Returns aggregate contact statistics. */
  getStats,
};
