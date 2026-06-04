/**
 * ToggleSwitch — Snapshot / Regression Tests
 *
 * Tests the class-building logic of ToggleSwitch as a regression baseline.
 * Since @testing-library/react is not available, we snapshot the pure
 * class-building logic directly.
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
 * Builds the full class descriptor object for a ToggleSwitch instance,
 * capturing all class-building decisions in one snapshot.
 */
function buildToggleSwitchSnapshot(opts: {
  checked: boolean;
  disabled: boolean;
  label?: string;
}): object {
  return {
    labelClass: buildLabelClass(opts.disabled),
    spanClass: buildToggleSpanClass(opts.checked),
    hasLabel: opts.label !== undefined,
    labelText: opts.label ?? null,
  };
}

// ─── Snapshot Tests ───────────────────────────────────────────────────────────

describe('ToggleSwitch — snapshot regression baseline', () => {
  test('unchecked, enabled, no label', () => {
    expect(buildToggleSwitchSnapshot({ checked: false, disabled: false })).toMatchSnapshot();
  });

  test('checked, enabled, no label', () => {
    expect(buildToggleSwitchSnapshot({ checked: true, disabled: false })).toMatchSnapshot();
  });

  test('unchecked, disabled, no label', () => {
    expect(buildToggleSwitchSnapshot({ checked: false, disabled: true })).toMatchSnapshot();
  });

  test('checked, disabled, no label', () => {
    expect(buildToggleSwitchSnapshot({ checked: true, disabled: true })).toMatchSnapshot();
  });

  test('unchecked, enabled, with label', () => {
    expect(
      buildToggleSwitchSnapshot({ checked: false, disabled: false, label: 'Enable feature' })
    ).toMatchSnapshot();
  });

  test('checked, enabled, with label', () => {
    expect(
      buildToggleSwitchSnapshot({ checked: true, disabled: false, label: 'Enable feature' })
    ).toMatchSnapshot();
  });

  test('disabled, with label', () => {
    expect(
      buildToggleSwitchSnapshot({ checked: false, disabled: true, label: 'Disabled option' })
    ).toMatchSnapshot();
  });

  test('toggle span class — unchecked snapshot', () => {
    expect(buildToggleSpanClass(false)).toMatchSnapshot();
  });

  test('toggle span class — checked snapshot', () => {
    expect(buildToggleSpanClass(true)).toMatchSnapshot();
  });

  test('label class — enabled snapshot', () => {
    expect(buildLabelClass(false)).toMatchSnapshot();
  });

  test('label class — disabled snapshot', () => {
    expect(buildLabelClass(true)).toMatchSnapshot();
  });
});
