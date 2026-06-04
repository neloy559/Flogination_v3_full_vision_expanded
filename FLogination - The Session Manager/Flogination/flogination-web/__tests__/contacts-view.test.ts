/**
 * ContactsView — Property-Based and Example Tests
 *
 * Tests pure helper functions exported from ContactsView.tsx:
 *   - parseTags
 *   - filterContacts
 *   - sortContacts
 *   - addTag
 *   - removeTag
 *
 * Feature: inbox-views-rebuild
 * Requirements: 3.1–3.11, 4.1–4.10
 */

import fc from 'fast-check';
import {
  parseTags,
  filterContacts,
  sortContacts,
  addTag,
  removeTag,
} from '../app/components/views/ContactsView';
import type { Contact } from '../../../src/types';

// ─────────────────────────────────────────────
// ARBITRARIES
// ─────────────────────────────────────────────

/** Arbitrary for a Contact record matching the full Contact interface. */
const arbContact = fc.record({
  id: fc.uuid(),
  fbUid: fc.string({ minLength: 1, maxLength: 20 }),
  fbName: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  tags: fc.array(fc.string({ minLength: 1, maxLength: 20 })).map((arr) => JSON.stringify(arr)),
  notes: fc.string({ maxLength: 200 }),
  firstSeenVia: fc.option(fc.uuid(), { nil: undefined }),
  lastInteraction: fc.option(fc.integer({ min: 0 }), { nil: undefined }),
  createdAt: fc.integer({ min: 0 }),
  updatedAt: fc.integer({ min: 0 }),
});

/** Arbitrary for a non-empty search string (avoids the trivial empty-string case). */
const arbNonEmptySearch = fc.string({ minLength: 1, maxLength: 30 });

/** Arbitrary for a tag string (trimmed, lowercase-safe). */
const arbTag = fc.string({ minLength: 1, maxLength: 20 }).map((s) => s.trim()).filter((s) => s.length > 0);

/** Arbitrary for a tag array (may contain duplicates — tests handle that). */
const arbTagArray = fc.array(arbTag, { maxLength: 10 });

// ─────────────────────────────────────────────
// PROPERTY 5 — filterContacts search correctness
// Validates: Requirements 3.6
// ─────────────────────────────────────────────

// Feature: inbox-views-rebuild, Property 5
describe('filterContacts — search correctness (Property 5)', () => {
  test('every result contains the search string in fbName, fbUid, or notes (case-insensitive)', () => {
    // Feature: inbox-views-rebuild, Property 5
    fc.assert(
      fc.property(
        fc.array(arbContact, { maxLength: 50 }),
        arbNonEmptySearch,
        (contacts, search) => {
          const result = filterContacts(contacts as Contact[], search);
          const needle = search.toLowerCase();

          return result.every(
            (c) =>
              (c.fbName ?? '').toLowerCase().includes(needle) ||
              c.fbUid.toLowerCase().includes(needle) ||
              c.notes.toLowerCase().includes(needle)
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  test('no matching contact is absent from the result', () => {
    // Feature: inbox-views-rebuild, Property 5
    fc.assert(
      fc.property(
        fc.array(arbContact, { maxLength: 50 }),
        arbNonEmptySearch,
        (contacts, search) => {
          const result = filterContacts(contacts as Contact[], search);
          const needle = search.toLowerCase();

          const expectedIds = new Set(
            contacts
              .filter(
                (c) =>
                  (c.fbName ?? '').toLowerCase().includes(needle) ||
                  c.fbUid.toLowerCase().includes(needle) ||
                  c.notes.toLowerCase().includes(needle)
              )
              .map((c) => c.id)
          );

          const resultIds = new Set(result.map((c) => c.id));

          // Every expected contact must appear in the result
          for (const id of Array.from(expectedIds)) {
            if (!resultIds.has(id)) return false;
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  test('empty search returns all contacts', () => {
    fc.assert(
      fc.property(fc.array(arbContact, { maxLength: 50 }), (contacts) => {
        const result = filterContacts(contacts as Contact[], '');
        return result.length === contacts.length;
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────
// PROPERTY 6 — sort round-trip
// Validates: Requirements 3.4, 3.5
// ─────────────────────────────────────────────

// Feature: inbox-views-rebuild, Property 6
describe('sortContacts — sort round-trip (Property 6)', () => {
  test('sort asc then desc produces the reverse of sort asc (unique fbName values)', () => {
    // Feature: inbox-views-rebuild, Property 6
    // Use contacts with unique fbName values to avoid tie-breaking ambiguity.
    // We generate unique names by mapping index onto the string.
    fc.assert(
      fc.property(
        fc.array(arbContact, { minLength: 2, maxLength: 30 }),
        (rawContacts) => {
          // Assign unique fbName values to eliminate ties
          const contacts: Contact[] = rawContacts.map((c, i) => ({
            ...(c as Contact),
            fbName: `contact_${String(i).padStart(4, '0')}`,
          }));

          const sortedAsc = sortContacts(contacts, 'fbName', 'asc');
          const sortedAscThenDesc = sortContacts(sortedAsc, 'fbName', 'desc');

          // The round-trip result must be the reverse of the ascending sort
          const expectedReverse = [...sortedAsc].reverse();

          if (sortedAscThenDesc.length !== expectedReverse.length) return false;

          return sortedAscThenDesc.every((c, i) => c.id === expectedReverse[i].id);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('sort does not mutate the input array', () => {
    // Feature: inbox-views-rebuild, Property 6
    fc.assert(
      fc.property(fc.array(arbContact, { maxLength: 30 }), (contacts) => {
        const original = [...contacts] as Contact[];
        sortContacts(original, 'fbName', 'asc');
        // Input array must be unchanged
        return original.every((c, i) => c === contacts[i]);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────
// PROPERTY 7 — addTag idempotence and set membership
// Validates: Requirements 4.5, 4.6
// ─────────────────────────────────────────────

// Feature: inbox-views-rebuild, Property 7
describe('addTag — idempotence and set membership (Property 7)', () => {
  test('addTag(addTag(tags, t), t) deep-equals addTag(tags, t)', () => {
    // Feature: inbox-views-rebuild, Property 7
    fc.assert(
      fc.property(arbTagArray, arbTag, (tags, tag) => {
        const once = addTag(tags, tag);
        const twice = addTag(once, tag);

        if (once.length !== twice.length) return false;
        return once.every((v, i) => v === twice[i]);
      }),
      { numRuns: 100 }
    );
  });

  test('result of addTag contains the tag exactly once', () => {
    // Feature: inbox-views-rebuild, Property 7
    fc.assert(
      fc.property(arbTagArray, arbTag, (tags, tag) => {
        const normalizedTag = tag.trim().toLowerCase();
        // Only test with a valid (non-empty after trim) tag
        if (!normalizedTag) return true;

        const result = addTag(tags, normalizedTag);
        const count = result.filter((t) => t === normalizedTag).length;
        return count === 1;
      }),
      { numRuns: 100 }
    );
  });

  test('addTag with already-present tag returns array of same length', () => {
    // Feature: inbox-views-rebuild, Property 7
    fc.assert(
      fc.property(arbTagArray, arbTag, (tags, tag) => {
        const normalizedTag = tag.trim().toLowerCase();
        if (!normalizedTag) return true;

        // First add the tag to ensure it's present
        const withTag = addTag(tags, normalizedTag);
        // Adding again must not change the length
        const withTagAgain = addTag(withTag, normalizedTag);
        return withTagAgain.length === withTag.length;
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────
// PROPERTY 8 — removeTag correctness
// Validates: Requirements 4.3
// ─────────────────────────────────────────────

// Feature: inbox-views-rebuild, Property 8
describe('removeTag — correctness (Property 8)', () => {
  test('removeTag(tags, t) does not contain t', () => {
    // Feature: inbox-views-rebuild, Property 8
    fc.assert(
      fc.property(arbTagArray, arbTag, (tags, tag) => {
        const result = removeTag(tags, tag);
        return !result.includes(tag);
      }),
      { numRuns: 100 }
    );
  });

  test('removeTag(tags, t) contains all elements from tags that are not t', () => {
    // Feature: inbox-views-rebuild, Property 8
    fc.assert(
      fc.property(arbTagArray, arbTag, (tags, tag) => {
        const result = removeTag(tags, tag);
        const otherTags = tags.filter((t) => t !== tag);

        // Every non-t element from the original must appear in the result
        // (preserving order and multiplicity for non-t elements)
        if (result.length !== otherTags.length) return false;
        return result.every((v, i) => v === otherTags[i]);
      }),
      { numRuns: 100 }
    );
  });

  test('removeTag on a tag not in the list returns a copy of the original', () => {
    // Feature: inbox-views-rebuild, Property 8
    fc.assert(
      fc.property(arbTagArray, arbTag, (tags, tag) => {
        // Ensure tag is NOT in the list
        const tagsWithout = tags.filter((t) => t !== tag);
        const result = removeTag(tagsWithout, tag);

        if (result.length !== tagsWithout.length) return false;
        return result.every((v, i) => v === tagsWithout[i]);
      }),
      { numRuns: 100 }
    );
  });
});

// ─────────────────────────────────────────────
// EXAMPLE TESTS — parseTags
// ─────────────────────────────────────────────

describe('parseTags — example tests', () => {
  test('valid JSON array returns the parsed array', () => {
    expect(parseTags('["buyer","lead"]')).toEqual(['buyer', 'lead']);
  });

  test('valid JSON array with a single element', () => {
    expect(parseTags('["vip"]')).toEqual(['vip']);
  });

  test('empty JSON array returns []', () => {
    expect(parseTags('[]')).toEqual([]);
  });

  test('invalid JSON returns []', () => {
    expect(parseTags('not-valid-json')).toEqual([]);
  });

  test('empty string returns []', () => {
    expect(parseTags('')).toEqual([]);
  });

  test('JSON null returns []', () => {
    expect(parseTags('null')).toEqual([]);
  });

  test('JSON number returns []', () => {
    expect(parseTags('42')).toEqual([]);
  });

  test('JSON object (not array) returns []', () => {
    expect(parseTags('{"tag":"buyer"}')).toEqual([]);
  });

  test('JSON boolean returns []', () => {
    expect(parseTags('true')).toEqual([]);
  });
});
