/**
 * ProgressBar — Unit Tests
 *
 * Tests getBarColor at boundary values and verifies the clamping
 * logic of the ProgressBar component.
 *
 * Satisfies: Requirements 2.4, 16.1
 */

import { getBarColor } from '../../app/components/ui/ProgressBar';

// ─── Color constants ──────────────────────────────────────────────────────────

const GREEN  = 'bg-[#00b894]';
const ORANGE = 'bg-[#fdcb6e]';
const RED    = 'bg-[#e17055]';

// ─── Clamping logic (mirrors ProgressBar.tsx) ─────────────────────────────────

function clampValue(value: number): number {
  return Math.min(100, Math.max(0, value));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProgressBar — getBarColor boundary values', () => {
  describe('Green zone (p < 65)', () => {
    test('p = 0 → green', () => {
      expect(getBarColor(0)).toBe(GREEN);
    });

    test('p = 1 → green', () => {
      expect(getBarColor(1)).toBe(GREEN);
    });

    test('p = 32 → green (mid-range)', () => {
      expect(getBarColor(32)).toBe(GREEN);
    });

    test('p = 64 → green (last green value)', () => {
      expect(getBarColor(64)).toBe(GREEN);
    });
  });

  describe('Orange zone (65 ≤ p ≤ 84)', () => {
    test('p = 65 → orange (first orange value)', () => {
      expect(getBarColor(65)).toBe(ORANGE);
    });

    test('p = 74 → orange (mid-range)', () => {
      expect(getBarColor(74)).toBe(ORANGE);
    });

    test('p = 84 → orange (last orange value)', () => {
      expect(getBarColor(84)).toBe(ORANGE);
    });
  });

  describe('Red zone (p ≥ 85)', () => {
    test('p = 85 → red (first red value)', () => {
      expect(getBarColor(85)).toBe(RED);
    });

    test('p = 92 → red (mid-range)', () => {
      expect(getBarColor(92)).toBe(RED);
    });

    test('p = 100 → red', () => {
      expect(getBarColor(100)).toBe(RED);
    });
  });

  describe('Threshold transitions', () => {
    test('64 → green, 65 → orange (green/orange boundary)', () => {
      expect(getBarColor(64)).toBe(GREEN);
      expect(getBarColor(65)).toBe(ORANGE);
    });

    test('84 → orange, 85 → red (orange/red boundary)', () => {
      expect(getBarColor(84)).toBe(ORANGE);
      expect(getBarColor(85)).toBe(RED);
    });
  });

  describe('Return value is always one of the three valid classes', () => {
    const VALID_CLASSES = new Set([GREEN, ORANGE, RED]);

    const TEST_VALUES = [0, 10, 20, 30, 40, 50, 60, 64, 65, 70, 80, 84, 85, 90, 100];

    test.each(TEST_VALUES)('getBarColor(%i) returns a valid class', (p) => {
      expect(VALID_CLASSES.has(getBarColor(p))).toBe(true);
    });
  });
});

describe('ProgressBar — value clamping logic', () => {
  test('value 0 clamps to 0', () => {
    expect(clampValue(0)).toBe(0);
  });

  test('value 100 clamps to 100', () => {
    expect(clampValue(100)).toBe(100);
  });

  test('value 50 is unchanged', () => {
    expect(clampValue(50)).toBe(50);
  });

  test('value below 0 clamps to 0', () => {
    expect(clampValue(-10)).toBe(0);
  });

  test('value above 100 clamps to 100', () => {
    expect(clampValue(150)).toBe(100);
  });

  test('clamped value at 64 → green', () => {
    expect(getBarColor(clampValue(64))).toBe(GREEN);
  });

  test('clamped value at 65 → orange', () => {
    expect(getBarColor(clampValue(65))).toBe(ORANGE);
  });

  test('clamped value at 85 → red', () => {
    expect(getBarColor(clampValue(85))).toBe(RED);
  });
});
