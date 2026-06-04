/**
 * Tests for InboxView pure helper functions.
 *
 * Covers:
 *  - filterConversations: AND-logic property test (Property 1)
 *  - filterConversations: unread filter correctness (Property 2)
 *  - formatRelativeTime: boundary value example tests
 *  - truncatePreview: boundary value example tests
 *
 * **Validates: Requirements 1.1–1.14**
 */

import fc from 'fast-check';
import {
  filterConversations,
  formatRelativeTime,
  truncatePreview,
  type InboxFilters,
} from '../app/components/views/InboxView';
import type { InboxConversation } from '../../../src/types';

// ─────────────────────────────────────────────
// ARBITRARIES
// ─────────────────────────────────────────────

/** Generates a valid InboxConversation object with constrained field sizes. */
const arbConversation = fc.record<InboxConversation>({
  sessionId: fc.uuid(),
  contactUid: fc.uuid(),
  contactName: fc.string({ minLength: 1, maxLength: 50 }),
  lastMessage: fc.string({ maxLength: 200 }),
  lastMessageTime: fc.integer({ min: 0 }),
  unread: fc.boolean(),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
});

/** Generates a valid InboxFilters object covering all filter dimensions. */
const arbFilters = fc.record<InboxFilters>({
  search: fc.oneof(fc.constant(''), fc.string({ maxLength: 30 })),
  tab: fc.oneof(fc.constant('all' as const), fc.constant('unread' as const)),
  sessionId: fc.oneof(fc.constant(''), fc.uuid()),
  tag: fc.oneof(fc.constant(''), fc.string({ minLength: 1, maxLength: 20 })),
});

// ─────────────────────────────────────────────
// PROPERTY-BASED TESTS
// ─────────────────────────────────────────────

// Feature: inbox-views-rebuild, Property 1: Filter AND-logic subset invariant
describe('filterConversations — AND-logic property (Property 1)', () => {
  /**
   * Every conversation returned by filterConversations must satisfy ALL active
   * predicates simultaneously. No conversation that satisfies all predicates
   * should be absent from the result.
   *
   * **Validates: Requirements 1.3, 1.4, 1.6, 1.7, 1.8**
   */
  test('every result satisfies all active predicates', () => {
    // Feature: inbox-views-rebuild, Property 1
    fc.assert(
      fc.property(
        fc.array(arbConversation, { maxLength: 50 }),
        arbFilters,
        (conversations, filters) => {
          const result = filterConversations(conversations, filters);

          // Every returned conversation must pass all active predicates
          const allResultsPassPredicates = result.every((conv) => {
            const passesSearch =
              filters.search === '' ||
              conv.contactName.toLowerCase().includes(filters.search.toLowerCase());
            const passesTab =
              filters.tab === 'all' || conv.unread === true;
            const passesSession =
              filters.sessionId === '' || conv.sessionId === filters.sessionId;
            const passesTag =
              filters.tag === '' || conv.tags.includes(filters.tag);
            return passesSearch && passesTab && passesSession && passesTag;
          });

          // Every conversation that passes all predicates must appear in the result
          const resultIds = new Set(
            result.map((c) => `${c.sessionId}:${c.contactUid}`)
          );
          const allMatchingAreIncluded = conversations
            .filter((conv) => {
              const passesSearch =
                filters.search === '' ||
                conv.contactName.toLowerCase().includes(filters.search.toLowerCase());
              const passesTab =
                filters.tab === 'all' || conv.unread === true;
              const passesSession =
                filters.sessionId === '' || conv.sessionId === filters.sessionId;
              const passesTag =
                filters.tag === '' || conv.tags.includes(filters.tag);
              return passesSearch && passesTab && passesSession && passesTag;
            })
            .every((conv) => resultIds.has(`${conv.sessionId}:${conv.contactUid}`));

          return allResultsPassPredicates && allMatchingAreIncluded;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('result is always a subset of the input conversations', () => {
    // Feature: inbox-views-rebuild, Property 1
    fc.assert(
      fc.property(
        fc.array(arbConversation, { maxLength: 50 }),
        arbFilters,
        (conversations, filters) => {
          const result = filterConversations(conversations, filters);
          const inputIds = new Set(
            conversations.map((c) => `${c.sessionId}:${c.contactUid}`)
          );
          return result.every((conv) =>
            inputIds.has(`${conv.sessionId}:${conv.contactUid}`)
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: inbox-views-rebuild, Property 2: Unread filter correctness
describe('filterConversations — unread filter (Property 2)', () => {
  /**
   * tab: 'unread' must return only conversations where unread === true.
   * tab: 'all' must return all conversations (subject to other active filters).
   *
   * **Validates: Requirements 1.4, 1.5**
   */
  test("tab: 'unread' returns only conversations where unread === true", () => {
    // Feature: inbox-views-rebuild, Property 2
    fc.assert(
      fc.property(
        fc.array(arbConversation, { maxLength: 50 }),
        (conversations) => {
          const filters: InboxFilters = {
            search: '',
            tab: 'unread',
            sessionId: '',
            tag: '',
          };
          const result = filterConversations(conversations, filters);
          return result.every((conv) => conv.unread === true);
        }
      ),
      { numRuns: 100 }
    );
  });

  test("tab: 'all' returns all conversations when no other filters are active", () => {
    // Feature: inbox-views-rebuild, Property 2
    fc.assert(
      fc.property(
        fc.array(arbConversation, { maxLength: 50 }),
        (conversations) => {
          const filters: InboxFilters = {
            search: '',
            tab: 'all',
            sessionId: '',
            tag: '',
          };
          const result = filterConversations(conversations, filters);
          return result.length === conversations.length;
        }
      ),
      { numRuns: 100 }
    );
  });

  test("tab: 'unread' result count never exceeds total conversation count", () => {
    // Feature: inbox-views-rebuild, Property 2
    fc.assert(
      fc.property(
        fc.array(arbConversation, { maxLength: 50 }),
        (conversations) => {
          const filters: InboxFilters = {
            search: '',
            tab: 'unread',
            sessionId: '',
            tag: '',
          };
          const result = filterConversations(conversations, filters);
          return result.length <= conversations.length;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────
// EXAMPLE TESTS — formatRelativeTime
// ─────────────────────────────────────────────

describe('formatRelativeTime — boundary value examples', () => {
  /**
   * Verifies human-readable relative time formatting at key boundaries.
   * Uses Date.now() as the reference point, so timestamps are computed
   * relative to the current time at test execution.
   *
   * **Validates: Requirements 1.9**
   */

  test('30 seconds ago → "0m ago" (less than 1 minute)', () => {
    const ts = Date.now() - 30 * 1000; // 30 seconds ago
    expect(formatRelativeTime(ts)).toBe('0m ago');
  });

  test('5 minutes ago → "5m ago"', () => {
    const ts = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    expect(formatRelativeTime(ts)).toBe('5m ago');
  });

  test('59 minutes ago → "59m ago" (just under 1 hour)', () => {
    const ts = Date.now() - 59 * 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('59m ago');
  });

  test('2 hours ago → "2h ago"', () => {
    const ts = Date.now() - 2 * 60 * 60 * 1000; // 2 hours ago
    expect(formatRelativeTime(ts)).toBe('2h ago');
  });

  test('23 hours ago → "23h ago" (just under 1 day)', () => {
    const ts = Date.now() - 23 * 60 * 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('23h ago');
  });

  test('3 days ago → "3d ago"', () => {
    const ts = Date.now() - 3 * 24 * 60 * 60 * 1000; // 3 days ago
    expect(formatRelativeTime(ts)).toBe('3d ago');
  });

  test('exactly 1 minute ago → "1m ago"', () => {
    const ts = Date.now() - 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('1m ago');
  });

  test('exactly 1 hour ago → "1h ago"', () => {
    const ts = Date.now() - 60 * 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('1h ago');
  });

  test('exactly 1 day ago → "1d ago"', () => {
    const ts = Date.now() - 24 * 60 * 60 * 1000;
    expect(formatRelativeTime(ts)).toBe('1d ago');
  });
});

// ─────────────────────────────────────────────
// EXAMPLE TESTS — truncatePreview
// ─────────────────────────────────────────────

describe('truncatePreview — boundary value examples', () => {
  /**
   * Verifies truncation behavior at the 40-character boundary used for
   * last-message previews in the conversation list.
   *
   * **Validates: Requirements 1.9**
   */

  test('string of exactly 40 chars → returned unchanged (no "…")', () => {
    const text = 'a'.repeat(40); // exactly 40 characters
    const result = truncatePreview(text, 40);
    expect(result).toBe(text);
    expect(result).not.toContain('…');
    expect(result.length).toBe(40);
  });

  test('string of 41 chars → truncated to 40 chars + "…" (total 41 chars)', () => {
    const text = 'a'.repeat(41); // 41 characters
    const result = truncatePreview(text, 40);
    expect(result).toBe('a'.repeat(40) + '…');
    expect(result.length).toBe(41); // 40 chars + 1 ellipsis character
    expect(result.endsWith('…')).toBe(true);
  });

  test('empty string → returned unchanged', () => {
    const result = truncatePreview('', 40);
    expect(result).toBe('');
    expect(result.length).toBe(0);
  });

  test('string shorter than maxLen → returned unchanged', () => {
    const text = 'Hello world';
    const result = truncatePreview(text, 40);
    expect(result).toBe(text);
    expect(result).not.toContain('…');
  });

  test('string of 39 chars → returned unchanged (one under limit)', () => {
    const text = 'b'.repeat(39);
    const result = truncatePreview(text, 40);
    expect(result).toBe(text);
    expect(result.length).toBe(39);
  });

  test('truncation preserves the first maxLen characters exactly', () => {
    const text = 'Hello, this is a test message that is definitely longer than forty characters total.';
    const result = truncatePreview(text, 40);
    expect(result).toBe(text.slice(0, 40) + '…');
    expect(result.startsWith(text.slice(0, 40))).toBe(true);
  });

  test('maxLen of 0 → any non-empty string is truncated to "…"', () => {
    const result = truncatePreview('hello', 0);
    expect(result).toBe('…');
  });
});
