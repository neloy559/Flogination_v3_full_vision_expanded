/**
 * StatusBadge — getStatusBadgeStyle Property-Based Tests
 *
 * Property 3: For any status value in the 14-value set,
 * getStatusBadgeStyle(status) returns an object with non-empty
 * bg, text, and prefix fields. Idempotence is also verified.
 *
 * **Validates: Requirements 2.3**
 */

import fc from 'fast-check';
import { getStatusBadgeStyle } from '../../app/components/ui/StatusBadge';
import type { StatusValue } from '../../app/components/ui/StatusBadge';

// ─── All 14 valid status values ───────────────────────────────────────────────

const ALL_STATUSES: StatusValue[] = [
  'live',
  'active',
  'checkpoint',
  'restricted',
  'dead',
  'draft',
  'paused',
  'running',
  'creating',
  'transferring',
  'complete',
  'failed',
  'verifying',
  'idle',
];

// ─── Expected color groups per Requirement 2.3 ───────────────────────────────

/** Green statuses: Live / Active / Complete */
const GREEN_STATUSES: StatusValue[] = ['live', 'active', 'complete'];
const GREEN_BG   = '#00b89415';
const GREEN_TEXT = '#00b894';

/** Orange (hex) statuses: Checkpoint */
const CHECKPOINT_STATUSES: StatusValue[] = ['checkpoint'];
const ORANGE_BG   = '#fdcb6e15';
const ORANGE_TEXT = '#fdcb6e';

/** Red statuses: Restricted / Failed */
const RED_STATUSES: StatusValue[] = ['restricted', 'failed'];
const RED_BG   = '#e1705515';
const RED_TEXT = '#e17055';

/** Gray statuses: Dead / Draft / Idle */
const GRAY_STATUSES: StatusValue[] = ['dead', 'draft', 'idle'];
const GRAY_BG   = '#63636e15';
const GRAY_TEXT = '#636e72';

/** Paused — Tailwind classes */
const PAUSED_STATUSES: StatusValue[] = ['paused'];
const PAUSED_BG   = 'bg-orange-100';
const PAUSED_TEXT = 'text-orange-700';

/** Purple / spinning statuses: Running / Creating / Transferring / Verifying */
const PURPLE_STATUSES: StatusValue[] = ['running', 'creating', 'transferring', 'verifying'];
const PURPLE_BG   = '#5341cd15';
const PURPLE_TEXT = '#5341cd';

// ─── Property 3: Non-empty fields and idempotence ────────────────────────────

/**
 * **Validates: Requirements 2.3**
 */
describe('Property 3 — StatusBadge Style Mapping', () => {
  describe('Non-empty fields for all 14 statuses (property)', () => {
    test('bg, text, and prefix are all non-empty strings (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_STATUSES),
          (status) => {
            const style = getStatusBadgeStyle(status);
            return (
              typeof style.bg     === 'string' && style.bg.length     > 0 &&
              typeof style.text   === 'string' && style.text.length   > 0 &&
              typeof style.prefix === 'string' && style.prefix.length > 0
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    test('useInlineStyle is a boolean (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_STATUSES),
          (status) => typeof getStatusBadgeStyle(status).useInlineStyle === 'boolean'
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Idempotence — calling twice returns the same result (property)', () => {
    test('getStatusBadgeStyle is idempotent (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_STATUSES),
          (status) => {
            const first  = getStatusBadgeStyle(status);
            const second = getStatusBadgeStyle(status);
            return (
              first.bg            === second.bg            &&
              first.text          === second.text          &&
              first.prefix        === second.prefix        &&
              first.useInlineStyle === second.useInlineStyle
            );
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  // ─── Color spec verification per Requirement 2.3 ─────────────────────────

  describe('Color spec — green statuses (live, active, complete)', () => {
    test.each(GREEN_STATUSES)('status "%s" → green colors', (status) => {
      const style = getStatusBadgeStyle(status);
      expect(style.bg).toBe(GREEN_BG);
      expect(style.text).toBe(GREEN_TEXT);
      expect(style.prefix).toBe('dot');
      expect(style.useInlineStyle).toBe(true);
    });
  });

  describe('Color spec — checkpoint (orange hex)', () => {
    test.each(CHECKPOINT_STATUSES)('status "%s" → orange hex colors', (status) => {
      const style = getStatusBadgeStyle(status);
      expect(style.bg).toBe(ORANGE_BG);
      expect(style.text).toBe(ORANGE_TEXT);
      expect(style.prefix).toBe('dot');
      expect(style.useInlineStyle).toBe(true);
    });
  });

  describe('Color spec — red statuses (restricted, failed)', () => {
    test.each(RED_STATUSES)('status "%s" → red colors', (status) => {
      const style = getStatusBadgeStyle(status);
      expect(style.bg).toBe(RED_BG);
      expect(style.text).toBe(RED_TEXT);
      expect(style.prefix).toBe('dot');
      expect(style.useInlineStyle).toBe(true);
    });
  });

  describe('Color spec — gray statuses (dead, draft, idle)', () => {
    test.each(GRAY_STATUSES)('status "%s" → gray colors', (status) => {
      const style = getStatusBadgeStyle(status);
      expect(style.bg).toBe(GRAY_BG);
      expect(style.text).toBe(GRAY_TEXT);
      expect(style.prefix).toBe('dot');
      expect(style.useInlineStyle).toBe(true);
    });
  });

  describe('Color spec — paused (Tailwind classes)', () => {
    test.each(PAUSED_STATUSES)('status "%s" → Tailwind orange classes', (status) => {
      const style = getStatusBadgeStyle(status);
      expect(style.bg).toBe(PAUSED_BG);
      expect(style.text).toBe(PAUSED_TEXT);
      expect(style.prefix).toBe('pause');
      expect(style.useInlineStyle).toBe(false);
    });
  });

  describe('Color spec — purple/spinning statuses (running, creating, transferring, verifying)', () => {
    test.each(PURPLE_STATUSES)('status "%s" → purple colors with spin prefix', (status) => {
      const style = getStatusBadgeStyle(status);
      expect(style.bg).toBe(PURPLE_BG);
      expect(style.text).toBe(PURPLE_TEXT);
      expect(style.prefix).toBe('spin');
      expect(style.useInlineStyle).toBe(true);
    });
  });

  // ─── Exhaustive coverage: all 14 statuses return a valid prefix ───────────

  describe('All 14 statuses return a valid prefix value', () => {
    const VALID_PREFIXES = new Set(['dot', 'pause', 'spin']);

    test.each(ALL_STATUSES)('status "%s" has a valid prefix', (status) => {
      const style = getStatusBadgeStyle(status);
      expect(VALID_PREFIXES.has(style.prefix)).toBe(true);
    });
  });
});
