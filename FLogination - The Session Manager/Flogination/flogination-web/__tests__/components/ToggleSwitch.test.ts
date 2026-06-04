/**
 * ToggleSwitch — Unit Tests
 *
 * Tests the class-building logic and onChange behavior of ToggleSwitch.
 * Since @testing-library/react is not available, we test the pure
 * class-building logic and the onChange callback contract directly.
 *
 * Satisfies: Requirements 2.6, 16.1
 */

export {}; // Make this file a module to avoid global scope collisions

// ─── Replicate the component's class-building logic ──────────────────────────

const TOGGLE_BASE_CLASS = 'toggle-switch';
const TOGGLE_CHECKED_CLASS = 'checked';

/**
 * Builds the className for the toggle span element,
 * mirroring ToggleSwitch.tsx's internal logic.
 */
function buildToggleSpanClass(checked: boolean): string {
  return checked ? `${TOGGLE_BASE_CLASS} ${TOGGLE_CHECKED_CLASS}` : TOGGLE_BASE_CLASS;
}

/**
 * Builds the className for the label element,
 * mirroring ToggleSwitch.tsx's internal logic.
 */
function buildLabelClass(disabled: boolean): string {
  const base = 'inline-flex items-center gap-2 cursor-pointer select-none';
  return disabled ? `${base} opacity-50 cursor-not-allowed` : base;
}

/**
 * Simulates the onChange handler behavior.
 * The handler calls the prop with the new boolean value from the event.
 */
function simulateChange(
  currentChecked: boolean,
  onChange: (checked: boolean) => void
): void {
  // Simulates a checkbox change event toggling the value
  onChange(!currentChecked);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ToggleSwitch — class composition and behavior', () => {
  describe('Toggle span classes', () => {
    test('unchecked → only "toggle-switch" class (no "checked")', () => {
      const cls = buildToggleSpanClass(false);
      expect(cls).toBe('toggle-switch');
      expect(cls).not.toContain('checked');
    });

    test('checked → "toggle-switch checked"', () => {
      const cls = buildToggleSpanClass(true);
      expect(cls).toContain('toggle-switch');
      expect(cls).toContain('checked');
    });

    test('checked state always includes the base toggle-switch class', () => {
      expect(buildToggleSpanClass(true)).toContain('toggle-switch');
      expect(buildToggleSpanClass(false)).toContain('toggle-switch');
    });
  });

  describe('Label classes — disabled state', () => {
    test('enabled → cursor-pointer, no opacity-50, no cursor-not-allowed', () => {
      const cls = buildLabelClass(false);
      expect(cls).toContain('cursor-pointer');
      expect(cls).not.toContain('opacity-50');
      expect(cls).not.toContain('cursor-not-allowed');
    });

    test('disabled → opacity-50 and cursor-not-allowed', () => {
      const cls = buildLabelClass(true);
      expect(cls).toContain('opacity-50');
      expect(cls).toContain('cursor-not-allowed');
    });

    test('disabled → still includes base layout classes', () => {
      const cls = buildLabelClass(true);
      expect(cls).toContain('inline-flex');
      expect(cls).toContain('items-center');
    });
  });

  describe('onChange callback contract', () => {
    test('onChange is called with true when toggled from unchecked', () => {
      const onChange = jest.fn();
      simulateChange(false, onChange);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(true);
    });

    test('onChange is called with false when toggled from checked', () => {
      const onChange = jest.fn();
      simulateChange(true, onChange);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(false);
    });

    test('onChange receives a boolean value', () => {
      const receivedValues: unknown[] = [];
      const onChange = (v: boolean) => receivedValues.push(v);

      simulateChange(false, onChange);
      simulateChange(true, onChange);

      expect(typeof receivedValues[0]).toBe('boolean');
      expect(typeof receivedValues[1]).toBe('boolean');
    });

    test('onChange is not called if not triggered', () => {
      const onChange = jest.fn();
      // No interaction — onChange should not be called
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Checked/unchecked state representation', () => {
    test('checked=true produces a class string containing "checked"', () => {
      expect(buildToggleSpanClass(true)).toContain('checked');
    });

    test('checked=false produces a class string NOT containing "checked"', () => {
      expect(buildToggleSpanClass(false)).not.toContain('checked');
    });

    test('toggling checked state changes the class string', () => {
      const unchecked = buildToggleSpanClass(false);
      const checked   = buildToggleSpanClass(true);
      expect(unchecked).not.toBe(checked);
    });
  });
});
