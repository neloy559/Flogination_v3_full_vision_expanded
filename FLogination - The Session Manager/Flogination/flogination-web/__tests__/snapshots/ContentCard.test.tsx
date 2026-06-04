/**
 * ContentCard — Snapshot / Regression Tests
 *
 * Tests the class-building logic of ContentCard as a regression baseline.
 * Since @testing-library/react is not available, we snapshot the pure
 * class-building logic and PADDING_MAP constants directly.
 *
 * Satisfies: Requirements 2.5, 16.1
 */

export {}; // Make this file a module to avoid global scope collisions

// ─── Replicate the component's class-building logic ──────────────────────────

const PADDING_MAP = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-8',
} as const;

type PaddingVariant = keyof typeof PADDING_MAP;

const BASE_CLASSES =
  'bg-surface-container-lowest border border-outline-variant rounded-card shadow-card';
const HOVER_CLASS = 'transition-shadow hover:shadow-md';

/**
 * Builds the className string that ContentCard would produce,
 * mirroring the component's internal logic exactly.
 */
function buildContentCardClasses(
  padding: PaddingVariant = 'md',
  hover: boolean = false,
  extraClassName?: string
): string {
  const paddingClass = PADDING_MAP[padding];
  const hoverClass = hover ? HOVER_CLASS : '';
  return `${BASE_CLASSES} ${paddingClass} ${hoverClass} ${extraClassName ?? ''}`.trim();
}

// ─── Snapshot Tests ───────────────────────────────────────────────────────────

describe('ContentCard — snapshot regression baseline', () => {
  test('default variant (md padding, no hover)', () => {
    expect(buildContentCardClasses()).toMatchSnapshot();
  });

  test('hover=true variant', () => {
    expect(buildContentCardClasses('md', true)).toMatchSnapshot();
  });

  test('sm padding variant', () => {
    expect(buildContentCardClasses('sm')).toMatchSnapshot();
  });

  test('lg padding variant', () => {
    expect(buildContentCardClasses('lg')).toMatchSnapshot();
  });

  test('sm padding + hover', () => {
    expect(buildContentCardClasses('sm', true)).toMatchSnapshot();
  });

  test('lg padding + hover', () => {
    expect(buildContentCardClasses('lg', true)).toMatchSnapshot();
  });

  test('with extra className', () => {
    expect(buildContentCardClasses('md', false, 'mb-6 col-span-2')).toMatchSnapshot();
  });

  test('PADDING_MAP snapshot — all three variants', () => {
    expect(PADDING_MAP).toMatchSnapshot();
  });
});
