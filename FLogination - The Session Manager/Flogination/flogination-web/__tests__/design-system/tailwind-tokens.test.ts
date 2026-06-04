/**
 * Tailwind Design Token Completeness — Property-Based Tests
 *
 * Property 1: For any token name in the required design system set,
 * the exported tailwind.config.js object SHALL contain that key with
 * the correct value.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
 */

import fc from 'fast-check';
import * as path from 'path';

// Load the tailwind config from the project root (two levels up from flogination-web)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const tailwindConfig = require(path.resolve(__dirname, '../../../../tailwind.config.js'));

const colors = tailwindConfig.theme?.extend?.colors ?? {};
const spacing = tailwindConfig.theme?.extend?.spacing ?? {};
const borderRadius = tailwindConfig.theme?.extend?.borderRadius ?? {};
const boxShadow = tailwindConfig.theme?.extend?.boxShadow ?? {};
const fontFamily = tailwindConfig.theme?.extend?.fontFamily ?? {};
const fontSize = tailwindConfig.theme?.extend?.fontSize ?? {};

// ─── Required token sets with expected values ─────────────────────────────────

/** Requirement 1.1 — 21 color tokens */
const REQUIRED_COLORS: Record<string, string> = {
  'background':                '#f0f2f7',
  'surface':                   '#fcf8ff',
  'surface-container-lowest':  '#ffffff',
  'surface-container-low':     '#f5f2ff',
  'surface-container':         '#efecff',
  'surface-container-high':    '#e8e5ff',
  'surface-container-highest': '#e2e0fc',
  'primary':                   '#5341cd',
  'primary-container':         '#6c5ce7',
  'on-primary':                '#ffffff',
  'on-primary-container':      '#faf6ff',
  'primary-fixed':             '#e4dfff',
  'on-surface':                '#1a1a2e',
  'on-surface-variant':        '#474554',
  'outline':                   '#787586',
  'outline-variant':           '#c8c4d7',
  'error':                     '#ba1a1a',
  'secondary':                 '#006b55',
  'secondary-container':       '#6dfad2',
  'tertiary':                  '#755300',
  'inverse-surface':           '#2f2e43',
};

/** Requirement 1.2 — spacing tokens */
const REQUIRED_SPACING: Record<string, string> = {
  'sidebar-width':     '240px',
  'sidebar-collapsed': '52px',
  'gutter':            '24px',
  'container-margin':  '32px',
  'space-xl':          '32px',
  'space-lg':          '24px',
  'space-md':          '16px',
  'space-sm':          '8px',
  'space-xs':          '4px',
};

/** Requirement 1.3 — border-radius tokens */
const REQUIRED_BORDER_RADIUS: Record<string, string> = {
  'card':   '12px',
  'button': '8px',
  'badge':  '9999px',
};

/** Requirement 1.4 — box-shadow tokens */
const REQUIRED_BOX_SHADOW: Record<string, string> = {
  'card':     '0 2px 8px rgba(0,0,0,0.06)',
  'elevated': '0 1px 3px rgba(0,0,0,0.02)',
};

/** Requirement 1.5 — font family tokens (first element of the array) */
const REQUIRED_FONT_FAMILY: Record<string, string> = {
  'sans': 'Inter',
  'mono': '"JetBrains Mono"',
};

/** Requirement 1.6 — font size tokens (first element of the tuple = the size string) */
const REQUIRED_FONT_SIZE: Record<string, string> = {
  'display':     '32px',
  'headline-lg': '24px',
  'headline-md': '20px',
  'body-lg':     '16px',
  'body-md':     '14px',
  'label-md':    '13px',
  'label-sm':    '12px',
  'mono':        '13px',
};

// ─── Property 1: Color token completeness ────────────────────────────────────

/**
 * **Validates: Requirements 1.1**
 *
 * For any color token name in the required set, the tailwind config
 * SHALL contain that key with the exact correct hex value.
 */
describe('Property 1 — Design Token Completeness', () => {
  describe('Requirement 1.1 — Color tokens', () => {
    const colorNames = Object.keys(REQUIRED_COLORS);

    test('every required color token exists with the correct value (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...colorNames),
          (tokenName) => {
            const expected = REQUIRED_COLORS[tokenName];
            const actual = colors[tokenName];
            return actual === expected;
          }
        ),
        { numRuns: 100 }
      );
    });

    // Explicit boundary checks for all 21 tokens
    test.each(Object.entries(REQUIRED_COLORS))(
      'color token "%s" has value "%s"',
      (token, expected) => {
        expect(colors[token]).toBe(expected);
      }
    );
  });

  // ─── Requirement 1.2 — Spacing tokens ──────────────────────────────────────

  describe('Requirement 1.2 — Spacing tokens', () => {
    const spacingNames = Object.keys(REQUIRED_SPACING);

    test('every required spacing token exists with the correct value (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...spacingNames),
          (tokenName) => {
            const expected = REQUIRED_SPACING[tokenName];
            const actual = spacing[tokenName];
            return actual === expected;
          }
        ),
        { numRuns: 100 }
      );
    });

    test.each(Object.entries(REQUIRED_SPACING))(
      'spacing token "%s" has value "%s"',
      (token, expected) => {
        expect(spacing[token]).toBe(expected);
      }
    );
  });

  // ─── Requirement 1.3 — Border-radius tokens ────────────────────────────────

  describe('Requirement 1.3 — Border-radius tokens', () => {
    const radiusNames = Object.keys(REQUIRED_BORDER_RADIUS);

    test('every required border-radius token exists with the correct value (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...radiusNames),
          (tokenName) => {
            const expected = REQUIRED_BORDER_RADIUS[tokenName];
            const actual = borderRadius[tokenName];
            return actual === expected;
          }
        ),
        { numRuns: 100 }
      );
    });

    test.each(Object.entries(REQUIRED_BORDER_RADIUS))(
      'borderRadius token "%s" has value "%s"',
      (token, expected) => {
        expect(borderRadius[token]).toBe(expected);
      }
    );
  });

  // ─── Requirement 1.4 — Box-shadow tokens ───────────────────────────────────

  describe('Requirement 1.4 — Box-shadow tokens', () => {
    const shadowNames = Object.keys(REQUIRED_BOX_SHADOW);

    test('every required box-shadow token exists with the correct value (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...shadowNames),
          (tokenName) => {
            const expected = REQUIRED_BOX_SHADOW[tokenName];
            const actual = boxShadow[tokenName];
            return actual === expected;
          }
        ),
        { numRuns: 100 }
      );
    });

    test.each(Object.entries(REQUIRED_BOX_SHADOW))(
      'boxShadow token "%s" has value "%s"',
      (token, expected) => {
        expect(boxShadow[token]).toBe(expected);
      }
    );
  });

  // ─── Requirement 1.5 — Font family tokens ──────────────────────────────────

  describe('Requirement 1.5 — Font family tokens', () => {
    const fontFamilyNames = Object.keys(REQUIRED_FONT_FAMILY);

    test('every required font-family token exists with the correct first family (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...fontFamilyNames),
          (tokenName) => {
            const expectedFirst = REQUIRED_FONT_FAMILY[tokenName];
            const actual = fontFamily[tokenName];
            // fontFamily values are arrays; check the first element
            return Array.isArray(actual) && actual[0] === expectedFirst;
          }
        ),
        { numRuns: 100 }
      );
    });

    test('sans font family starts with Inter', () => {
      expect(Array.isArray(fontFamily['sans'])).toBe(true);
      expect(fontFamily['sans'][0]).toBe('Inter');
    });

    test('mono font family starts with JetBrains Mono', () => {
      expect(Array.isArray(fontFamily['mono'])).toBe(true);
      expect(fontFamily['mono'][0]).toBe('"JetBrains Mono"');
    });
  });

  // ─── Requirement 1.6 — Font size tokens ────────────────────────────────────

  describe('Requirement 1.6 — Font size tokens', () => {
    const fontSizeNames = Object.keys(REQUIRED_FONT_SIZE);

    test('every required font-size token exists with the correct size value (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...fontSizeNames),
          (tokenName) => {
            const expectedSize = REQUIRED_FONT_SIZE[tokenName];
            const actual = fontSize[tokenName];
            // fontSize values are tuples [size, options]; check the first element
            return Array.isArray(actual) && actual[0] === expectedSize;
          }
        ),
        { numRuns: 100 }
      );
    });

    test.each(Object.entries(REQUIRED_FONT_SIZE))(
      'fontSize token "%s" has size "%s"',
      (token, expectedSize) => {
        expect(Array.isArray(fontSize[token])).toBe(true);
        expect(fontSize[token][0]).toBe(expectedSize);
      }
    );
  });

  // ─── darkMode check ─────────────────────────────────────────────────────────

  describe('Requirement 1.9 — darkMode is disabled', () => {
    test('darkMode is set to false', () => {
      expect(tailwindConfig.darkMode).toBe(false);
    });
  });
});
