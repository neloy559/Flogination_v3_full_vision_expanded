/**
 * ProgressBar — getBarColor Property-Based Tests
 *
 * Property 2: For any integer p in [0, 100], getBarColor(p) returns the
 * correct color class based on thresholds:
 *   - p < 65  → 'bg-[#00b894]'  (green)
 *   - 65 ≤ p ≤ 84 → 'bg-[#fdcb6e]'  (orange)
 *   - p ≥ 85  → 'bg-[#e17055]'  (red)
 *
 * **Validates: Requirements 2.4**
 */

import fc from 'fast-check';
import { getBarColor } from '../../app/components/ui/ProgressBar';

// ─── Color constants ──────────────────────────────────────────────────────────

const GREEN  = 'bg-[#00b894]';
const ORANGE = 'bg-[#fdcb6e]';
const RED    = 'bg-[#e17055]';

// ─── Property 2: Threshold mapping ───────────────────────────────────────────

/**
 * **Validates: Requirements 2.4**
 *
 * For any integer p in [0, 100], getBarColor(p) returns the correct class.
 */
describe('Property 2 — Progress Bar Color Threshold Mapping', () => {
  test('green for p < 65 (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 64 }),
        (p) => getBarColor(p) === GREEN
      ),
      { numRuns: 100 }
    );
  });

  test('orange for 65 ≤ p ≤ 84 (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 65, max: 84 }),
        (p) => getBarColor(p) === ORANGE
      ),
      { numRuns: 100 }
    );
  });

  test('red for p ≥ 85 (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 85, max: 100 }),
        (p) => getBarColor(p) === RED
      ),
      { numRuns: 100 }
    );
  });

  test('full range [0, 100] always returns one of the three valid classes (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100 }),
        (p) => {
          const result = getBarColor(p);
          return result === GREEN || result === ORANGE || result === RED;
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Boundary value tests ─────────────────────────────────────────────────

  describe('Boundary values', () => {
    test('p = 0 → green', () => {
      expect(getBarColor(0)).toBe(GREEN);
    });

    test('p = 64 → green (last green value)', () => {
      expect(getBarColor(64)).toBe(GREEN);
    });

    test('p = 65 → orange (first orange value)', () => {
      expect(getBarColor(65)).toBe(ORANGE);
    });

    test('p = 84 → orange (last orange value)', () => {
      expect(getBarColor(84)).toBe(ORANGE);
    });

    test('p = 85 → red (first red value)', () => {
      expect(getBarColor(85)).toBe(RED);
    });

    test('p = 100 → red', () => {
      expect(getBarColor(100)).toBe(RED);
    });
  });

  // ─── Monotonicity: no color regression as p increases ────────────────────

  test('color does not regress (green → orange → red) as p increases (property)', () => {
    // Encode color order: green=0, orange=1, red=2
    const colorOrder = (c: string): number => {
      if (c === GREEN)  return 0;
      if (c === ORANGE) return 1;
      return 2;
    };

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99 }),
        (p) => {
          const current = colorOrder(getBarColor(p));
          const next    = colorOrder(getBarColor(p + 1));
          // Color order must be non-decreasing
          return next >= current;
        }
      ),
      { numRuns: 100 }
    );
  });
});
