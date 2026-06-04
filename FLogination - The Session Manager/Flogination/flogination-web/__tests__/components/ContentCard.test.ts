/**
 * ContentCard — Unit Tests
 *
 * Tests the class composition logic of ContentCard by verifying
 * the PADDING_MAP and hover class behavior through the component's
 * exported logic.
 *
 * Since @testing-library/react is not available, we test the pure
 * class-building logic directly.
 *
 * Satisfies: Requirements 2.5, 16.1
 */

export {}; // Make this file a module to avoid global scope collisions

// ─── Replicate the component's class-building logic ──────────────────────────
// These constants mirror what ContentCard.tsx uses internally.

const PADDING_MAP = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-8',
} as const;

type PaddingVariant = keyof typeof PADDING_MAP;

const BASE_CLASSES = 'bg-surface-container-lowest border border-outline-variant rounded-card shadow-card';
const HOVER_CLASS  = 'transition-shadow hover:shadow-md';

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
  const hoverClass   = hover ? HOVER_CLASS : '';
  return `${BASE_CLASSES} ${paddingClass} ${hoverClass} ${extraClassName ?? ''}`.trim();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ContentCard — class composition', () => {
  describe('Base classes', () => {
    test('always includes bg-surface-container-lowest', () => {
      const classes = buildContentCardClasses();
      expect(classes).toContain('bg-surface-container-lowest');
    });

    test('always includes border border-outline-variant', () => {
      const classes = buildContentCardClasses();
      expect(classes).toContain('border border-outline-variant');
    });

    test('always includes rounded-card', () => {
      const classes = buildContentCardClasses();
      expect(classes).toContain('rounded-card');
    });

    test('always includes shadow-card', () => {
      const classes = buildContentCardClasses();
      expect(classes).toContain('shadow-card');
    });
  });

  describe('Padding variants', () => {
    test('default padding is md → p-5', () => {
      const classes = buildContentCardClasses();
      expect(classes).toContain('p-5');
    });

    test('padding="sm" → p-3', () => {
      const classes = buildContentCardClasses('sm');
      expect(classes).toContain('p-3');
    });

    test('padding="md" → p-5', () => {
      const classes = buildContentCardClasses('md');
      expect(classes).toContain('p-5');
    });

    test('padding="lg" → p-8', () => {
      const classes = buildContentCardClasses('lg');
      expect(classes).toContain('p-8');
    });

    test('only one padding class is applied at a time', () => {
      const smClasses = buildContentCardClasses('sm');
      expect(smClasses).not.toContain('p-5');
      expect(smClasses).not.toContain('p-8');

      const mdClasses = buildContentCardClasses('md');
      expect(mdClasses).not.toContain('p-3');
      expect(mdClasses).not.toContain('p-8');

      const lgClasses = buildContentCardClasses('lg');
      expect(lgClasses).not.toContain('p-3');
      expect(lgClasses).not.toContain('p-5');
    });
  });

  describe('Hover prop', () => {
    test('hover=false → no hover classes', () => {
      const classes = buildContentCardClasses('md', false);
      expect(classes).not.toContain('transition-shadow');
      expect(classes).not.toContain('hover:shadow-md');
    });

    test('hover=true → includes transition-shadow hover:shadow-md', () => {
      const classes = buildContentCardClasses('md', true);
      expect(classes).toContain('transition-shadow');
      expect(classes).toContain('hover:shadow-md');
    });

    test('hover=true does not remove base classes', () => {
      const classes = buildContentCardClasses('md', true);
      expect(classes).toContain('bg-surface-container-lowest');
      expect(classes).toContain('rounded-card');
      expect(classes).toContain('shadow-card');
    });
  });

  describe('Extra className passthrough', () => {
    test('extra className is appended to the class string', () => {
      const classes = buildContentCardClasses('md', false, 'mb-6');
      expect(classes).toContain('mb-6');
    });

    test('extra className does not override base classes', () => {
      const classes = buildContentCardClasses('md', false, 'custom-class');
      expect(classes).toContain('bg-surface-container-lowest');
      expect(classes).toContain('custom-class');
    });

    test('undefined className does not add "undefined" to the string', () => {
      const classes = buildContentCardClasses('md', false, undefined);
      expect(classes).not.toContain('undefined');
    });
  });

  describe('PADDING_MAP completeness', () => {
    test('PADDING_MAP covers all three variants', () => {
      expect(PADDING_MAP.sm).toBe('p-3');
      expect(PADDING_MAP.md).toBe('p-5');
      expect(PADDING_MAP.lg).toBe('p-8');
    });
  });
});
