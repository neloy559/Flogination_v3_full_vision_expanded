/**
 * Flogination V5 — Spin Syntax Parser
 *
 * Resolves {option_a|option_b|option_c} tokens in content templates.
 * Used by all automation tools to produce unique content per session.
 *
 * Rules:
 *  - Tokens are resolved innermost-first (supports nesting up to depth 5).
 *  - Each option is selected with uniform distribution.
 *  - Malformed tokens (unclosed `{`) are passed through unchanged.
 *  - Single-option tokens `{only}` return the option as-is.
 *  - This is a pure function — no side effects, no imports, fully testable.
 */

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Maximum nesting depth before the parser gives up and returns the original string. */
const MAX_NESTING_DEPTH = 5;

/** Maximum iterations of the innermost-token replacement loop before bailing out. */
const MAX_RESOLVE_ITERATIONS = 1_000;

/** Max characters of the original template shown in warning messages. */
const WARNING_PREVIEW_LENGTH = 80;

// ─────────────────────────────────────────────
// CORE LOGIC
// ─────────────────────────────────────────────

/**
 * Resolves all spin syntax tokens in a content template string.
 * Processes innermost tokens first, working outward through nested structures.
 *
 * @param template  - Content string containing {a|b|c} tokens.
 * @param randomFn  - Random number generator. Defaults to Math.random.
 *                    Inject a seeded function for deterministic testing.
 * @returns The resolved string with all valid tokens replaced.
 *
 * @example
 * resolve('{Hello|Hi} {world|there}')
 * // → "Hi there"  (or any valid combination)
 *
 * @example
 * resolve('{Buy now|Check this}: https://example.com')
 * // → "Check this: https://example.com"
 *
 * @example
 * resolve('{Outer {inner_a|inner_b}|plain}')
 * // → "Outer inner_a"  or  "Outer inner_b"  or  "plain"
 *
 * @example Deterministic testing with seeded random
 * resolve('{a|b|c}', () => 0)  // always picks first option → "a"
 * resolve('{a|b|c}', () => 0.99) // always picks last option → "c"
 */
function resolve(
  template: string,
  randomFn: () => number = Math.random
): string {
  const depth = measureNestingDepth(template);

  if (depth > MAX_NESTING_DEPTH) {
    console.warn(
      `[spin-parser] spin_depth_exceeded: nesting depth ${depth} exceeds max ${MAX_NESTING_DEPTH}. Returning original string.`
    );
    return template;
  }

  if (!template.includes('{')) {
    // Fast path — no tokens present
    return template;
  }

  return resolvePass(template, randomFn);
}

/**
 * Performs one resolution pass over the string.
 * Finds the innermost `{...}` token (no nested braces inside) and resolves it.
 * Repeats until no tokens remain or a malformed token is detected.
 */
function resolvePass(input: string, randomFn: () => number): string {
  let current = input;

  // Regex matches the innermost {token} — one that contains no nested braces.
  // This ensures we always resolve from the inside out.
  const INNERMOST_TOKEN = /\{([^{}]*)\}/g;

  let safetyCounter = 0;

  while (INNERMOST_TOKEN.test(current)) {
    INNERMOST_TOKEN.lastIndex = 0; // reset after .test()

    current = current.replace(INNERMOST_TOKEN, (_match, inner: string) => {
      return pickOption(inner, randomFn);
    });

    safetyCounter++;
    if (safetyCounter > MAX_RESOLVE_ITERATIONS) {
      console.warn('[spin-parser] spin_parse_error: exceeded max iterations. Returning current state.');
      break;
    }
  }

  // Check for unclosed braces — malformed input
  if (current.includes('{') || current.includes('}')) {
    const preview = input.length > WARNING_PREVIEW_LENGTH
      ? `${input.slice(0, WARNING_PREVIEW_LENGTH)}...`
      : input;
    console.warn(
      `[spin-parser] spin_parse_error: malformed spin token detected in: "${preview}". Returning original string.`
    );
    return input;
  }

  return current;
}

/**
 * Picks one option from a pipe-delimited option string.
 * Uses uniform distribution across all options.
 *
 * @param inner    - The content inside `{...}`, e.g. "option_a|option_b|option_c"
 * @param randomFn - RNG function returning a value in [0, 1)
 * @returns One randomly selected option.
 *
 * @example
 * pickOption('a|b|c', Math.random) // → "a", "b", or "c" with equal probability
 * pickOption('only', Math.random)  // → "only"
 */
function pickOption(inner: string, randomFn: () => number): string {
  const options = inner.split('|');

  if (options.length === 1) {
    // Single option — return as-is, no randomness needed
    return options[0];
  }

  const index = Math.floor(randomFn() * options.length);
  // Clamp to valid range in case randomFn returns exactly 1.0
  const safeIndex = Math.min(index, options.length - 1);
  return options[safeIndex];
}

/**
 * Measures the maximum nesting depth of `{...}` tokens in a string.
 * Used to detect excessively nested templates before processing.
 *
 * @param input - The template string to analyse.
 * @returns The maximum nesting depth found (0 if no tokens present).
 *
 * @example
 * measureNestingDepth('{a|b}')           // → 1
 * measureNestingDepth('{a|{b|c}}')       // → 2
 * measureNestingDepth('{a|{b|{c|d}}}')   // → 3
 */
function measureNestingDepth(input: string): number {
  let maxDepth = 0;
  let currentDepth = 0;

  for (const char of input) {
    if (char === '{') {
      currentDepth++;
      if (currentDepth > maxDepth) {
        maxDepth = currentDepth;
      }
    } else if (char === '}') {
      currentDepth--;
    }
  }

  return maxDepth;
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * The spin syntax parser.
 * Import and use `spinParser.resolve(template)` in automation tools.
 *
 * @example
 * import { spinParser } from '../utils/spin-parser'
 *
 * const comment = spinParser.resolve(
 *   '{Check this out|Have a look|Worth seeing}: https://example.com'
 * )
 * // → "Have a look: https://example.com"
 */
export const spinParser = {
  resolve,
  /** Exposed for testing — measures nesting depth without resolving. */
  measureNestingDepth,
};
