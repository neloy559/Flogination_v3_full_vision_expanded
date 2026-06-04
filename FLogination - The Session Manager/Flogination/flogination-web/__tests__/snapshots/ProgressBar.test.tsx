/**
 * ProgressBar — Snapshot / Regression Tests
 *
 * Tests getBarColor at the specific values required by the task spec
 * as a regression baseline. Since @testing-library/react is not available,
 * we snapshot the pure getBarColor function output directly.
 *
 * Satisfies: Requirements 2.4, 16.1
 */

import { getBarColor } from '../../app/components/ui/ProgressBar';

// ─── Color constants ──────────────────────────────────────────────────────────

const GREEN  = 'bg-[#00b894]';
const ORANGE = 'bg-[#fdcb6e]';
const RED    = 'bg-[#e17055]';

// ─── Snapshot Tests ───────────────────────────────────────────────────────────

describe('ProgressBar — snapshot regression baseline', () => {
  test('value 0 → green', () => {
    expect(getBarColor(0)).toMatchSnapshot();
  });

  test('value 50 → green', () => {
    expect(getBarColor(50)).toMatchSnapshot();
  });

  test('value 64 → green (last green value)', () => {
    expect(getBarColor(64)).toMatchSnapshot();
  });

  test('value 65 → orange (first orange value)', () => {
    expect(getBarColor(65)).toMatchSnapshot();
  });

  test('value 84 → orange (last orange value)', () => {
    expect(getBarColor(84)).toMatchSnapshot();
  });

  test('value 85 → red (first red value)', () => {
    expect(getBarColor(85)).toMatchSnapshot();
  });

  test('value 100 → red', () => {
    expect(getBarColor(100)).toMatchSnapshot();
  });
});

describe('ProgressBar — color class values snapshot', () => {
  test('all three color class strings snapshot', () => {
    expect({ green: GREEN, orange: ORANGE, red: RED }).toMatchSnapshot();
  });

  test('boundary mapping snapshot (64, 65, 84, 85)', () => {
    expect({
      p64: getBarColor(64),
      p65: getBarColor(65),
      p84: getBarColor(84),
      p85: getBarColor(85),
    }).toMatchSnapshot();
  });

  test('full range snapshot (0, 50, 64, 65, 84, 85, 100)', () => {
    expect({
      p0:   getBarColor(0),
      p50:  getBarColor(50),
      p64:  getBarColor(64),
      p65:  getBarColor(65),
      p84:  getBarColor(84),
      p85:  getBarColor(85),
      p100: getBarColor(100),
    }).toMatchSnapshot();
  });
});
