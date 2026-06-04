/**
 * Dashboard — Session Stat Derivation Property-Based Tests
 *
 * Property 6: For any array of Session objects with arbitrary healthStatus
 * values drawn from ['live', 'checkpoint', 'restricted', 'dead'], the derived
 * stat counts computed by the Dashboard SHALL satisfy:
 *
 *   - total === sessions.length
 *   - live + checkpoint + restricted + dead === total  (partition completeness)
 *   - live       === sessions.filter(s => s.healthStatus === 'live').length
 *   - checkpoint === sessions.filter(s => s.healthStatus === 'checkpoint').length
 *   - restricted === sessions.filter(s => s.healthStatus === 'restricted').length
 *   - dead       === sessions.filter(s => s.healthStatus === 'dead').length
 *   - All counts are non-negative integers
 *
 * Tests the pure derivation logic extracted from Dashboard.tsx:
 *
 *   const total      = sessions.length
 *   const live       = sessions.filter(s => s.healthStatus === 'live').length
 *   const checkpoint = sessions.filter(s => s.healthStatus === 'checkpoint').length
 *   const restricted = sessions.filter(s => s.healthStatus === 'restricted').length
 *   const dead       = sessions.filter(s => s.healthStatus === 'dead').length
 *
 * **Validates: Requirements 4.2, 16.1**
 */

import fc from 'fast-check';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** The four healthStatus values used by the Dashboard stat cards. */
type DashboardHealthStatus = 'live' | 'checkpoint' | 'restricted' | 'dead';

/** Minimal session shape required for stat derivation — only healthStatus matters. */
interface SessionStub {
  healthStatus: DashboardHealthStatus;
}

// ─────────────────────────────────────────────────────────────────────────────
// PURE DERIVATION LOGIC (mirrored from Dashboard.tsx — not exported)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derives the 5 stat counts from a session array.
 * Mirrors the derivation block in Dashboard.tsx exactly.
 *
 * @param sessions - Array of session stubs with healthStatus
 * @returns Object with total, live, checkpoint, restricted, dead counts
 */
function deriveStats(sessions: SessionStub[]): {
  total:      number;
  live:       number;
  checkpoint: number;
  restricted: number;
  dead:       number;
} {
  const total      = sessions.length;
  const live       = sessions.filter(s => s.healthStatus === 'live').length;
  const checkpoint = sessions.filter(s => s.healthStatus === 'checkpoint').length;
  const restricted = sessions.filter(s => s.healthStatus === 'restricted').length;
  const dead       = sessions.filter(s => s.healthStatus === 'dead').length;
  return { total, live, checkpoint, restricted, dead };
}

// ─────────────────────────────────────────────────────────────────────────────
// ARBITRARIES
// ─────────────────────────────────────────────────────────────────────────────

/** Generates a single session stub with a random healthStatus from the 4 valid values. */
const sessionArb: fc.Arbitrary<SessionStub> = fc.record({
  healthStatus: fc.constantFrom<DashboardHealthStatus>(
    'live',
    'checkpoint',
    'restricted',
    'dead'
  ),
});

/** Generates an array of 0–50 session stubs. */
const sessionArrayArb: fc.Arbitrary<SessionStub[]> = fc.array(sessionArb, {
  minLength: 0,
  maxLength: 50,
});

// ─────────────────────────────────────────────────────────────────────────────
// PROPERTY 6 — Session Stat Derivation Correctness
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Validates: Requirements 4.2, 16.1**
 */
describe('Property 6 — Session Stat Derivation Correctness', () => {

  // ── 6a: total === sessions.length ─────────────────────────────────────────

  describe('total equals sessions.length', () => {
    test('total === sessions.length for any session array (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { total } = deriveStats(sessions);
          return total === sessions.length;
        }),
        { numRuns: 100 }
      );
    });
  });

  // ── 6b: Partition completeness ────────────────────────────────────────────

  describe('live + checkpoint + restricted + dead === total (partition completeness)', () => {
    test('sum of all status counts equals total for any session array (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { total, live, checkpoint, restricted, dead } = deriveStats(sessions);
          return live + checkpoint + restricted + dead === total;
        }),
        { numRuns: 100 }
      );
    });
  });

  // ── 6c: Each count equals the filtered array length ───────────────────────

  describe('each count equals the filtered array length', () => {
    test('live count equals filtered live sessions (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { live } = deriveStats(sessions);
          return live === sessions.filter(s => s.healthStatus === 'live').length;
        }),
        { numRuns: 100 }
      );
    });

    test('checkpoint count equals filtered checkpoint sessions (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { checkpoint } = deriveStats(sessions);
          return checkpoint === sessions.filter(s => s.healthStatus === 'checkpoint').length;
        }),
        { numRuns: 100 }
      );
    });

    test('restricted count equals filtered restricted sessions (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { restricted } = deriveStats(sessions);
          return restricted === sessions.filter(s => s.healthStatus === 'restricted').length;
        }),
        { numRuns: 100 }
      );
    });

    test('dead count equals filtered dead sessions (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { dead } = deriveStats(sessions);
          return dead === sessions.filter(s => s.healthStatus === 'dead').length;
        }),
        { numRuns: 100 }
      );
    });
  });

  // ── 6d: All counts are non-negative integers ──────────────────────────────

  describe('all counts are non-negative integers', () => {
    test('total is a non-negative integer (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { total } = deriveStats(sessions);
          return Number.isInteger(total) && total >= 0;
        }),
        { numRuns: 100 }
      );
    });

    test('live is a non-negative integer (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { live } = deriveStats(sessions);
          return Number.isInteger(live) && live >= 0;
        }),
        { numRuns: 100 }
      );
    });

    test('checkpoint is a non-negative integer (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { checkpoint } = deriveStats(sessions);
          return Number.isInteger(checkpoint) && checkpoint >= 0;
        }),
        { numRuns: 100 }
      );
    });

    test('restricted is a non-negative integer (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { restricted } = deriveStats(sessions);
          return Number.isInteger(restricted) && restricted >= 0;
        }),
        { numRuns: 100 }
      );
    });

    test('dead is a non-negative integer (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { dead } = deriveStats(sessions);
          return Number.isInteger(dead) && dead >= 0;
        }),
        { numRuns: 100 }
      );
    });
  });

  // ── 6e: No double-counting — each session contributes to exactly one bucket ─

  describe('no double-counting — each session contributes to exactly one bucket', () => {
    test('each session is counted in exactly one status bucket (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const { live, checkpoint, restricted, dead } = deriveStats(sessions);
          // Since all healthStatus values are from the 4-value set, the sum
          // must equal the total — no session can be in two buckets.
          const sum = live + checkpoint + restricted + dead;
          return sum === sessions.length;
        }),
        { numRuns: 100 }
      );
    });
  });

  // ── 6f: Monotonicity — adding a session increases exactly one count by 1 ──

  describe('adding a session increases exactly one count by 1', () => {
    test('appending a live session increments live by 1 and total by 1 (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const before = deriveStats(sessions);
          const after  = deriveStats([...sessions, { healthStatus: 'live' }]);
          return (
            after.total      === before.total      + 1 &&
            after.live       === before.live       + 1 &&
            after.checkpoint === before.checkpoint     &&
            after.restricted === before.restricted     &&
            after.dead       === before.dead
          );
        }),
        { numRuns: 100 }
      );
    });

    test('appending a checkpoint session increments checkpoint by 1 and total by 1 (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const before = deriveStats(sessions);
          const after  = deriveStats([...sessions, { healthStatus: 'checkpoint' }]);
          return (
            after.total      === before.total      + 1 &&
            after.live       === before.live           &&
            after.checkpoint === before.checkpoint + 1 &&
            after.restricted === before.restricted     &&
            after.dead       === before.dead
          );
        }),
        { numRuns: 100 }
      );
    });

    test('appending a restricted session increments restricted by 1 and total by 1 (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const before = deriveStats(sessions);
          const after  = deriveStats([...sessions, { healthStatus: 'restricted' }]);
          return (
            after.total      === before.total      + 1 &&
            after.live       === before.live           &&
            after.checkpoint === before.checkpoint     &&
            after.restricted === before.restricted + 1 &&
            after.dead       === before.dead
          );
        }),
        { numRuns: 100 }
      );
    });

    test('appending a dead session increments dead by 1 and total by 1 (property)', () => {
      fc.assert(
        fc.property(sessionArrayArb, (sessions) => {
          const before = deriveStats(sessions);
          const after  = deriveStats([...sessions, { healthStatus: 'dead' }]);
          return (
            after.total      === before.total  + 1 &&
            after.live       === before.live       &&
            after.checkpoint === before.checkpoint &&
            after.restricted === before.restricted &&
            after.dead       === before.dead   + 1
          );
        }),
        { numRuns: 100 }
      );
    });
  });

  // ── 6g: Edge cases ────────────────────────────────────────────────────────

  describe('Edge cases', () => {
    test('empty array → all counts are 0', () => {
      const { total, live, checkpoint, restricted, dead } = deriveStats([]);
      expect(total).toBe(0);
      expect(live).toBe(0);
      expect(checkpoint).toBe(0);
      expect(restricted).toBe(0);
      expect(dead).toBe(0);
    });

    test('all-live array → live === total, others === 0', () => {
      const sessions: SessionStub[] = Array.from({ length: 10 }, () => ({ healthStatus: 'live' as const }));
      const { total, live, checkpoint, restricted, dead } = deriveStats(sessions);
      expect(total).toBe(10);
      expect(live).toBe(10);
      expect(checkpoint).toBe(0);
      expect(restricted).toBe(0);
      expect(dead).toBe(0);
    });

    test('all-dead array → dead === total, others === 0', () => {
      const sessions: SessionStub[] = Array.from({ length: 7 }, () => ({ healthStatus: 'dead' as const }));
      const { total, live, checkpoint, restricted, dead } = deriveStats(sessions);
      expect(total).toBe(7);
      expect(live).toBe(0);
      expect(checkpoint).toBe(0);
      expect(restricted).toBe(0);
      expect(dead).toBe(7);
    });

    test('one of each status → each count is 1, total is 4', () => {
      const sessions: SessionStub[] = [
        { healthStatus: 'live' },
        { healthStatus: 'checkpoint' },
        { healthStatus: 'restricted' },
        { healthStatus: 'dead' },
      ];
      const { total, live, checkpoint, restricted, dead } = deriveStats(sessions);
      expect(total).toBe(4);
      expect(live).toBe(1);
      expect(checkpoint).toBe(1);
      expect(restricted).toBe(1);
      expect(dead).toBe(1);
      expect(live + checkpoint + restricted + dead).toBe(total);
    });
  });
});
