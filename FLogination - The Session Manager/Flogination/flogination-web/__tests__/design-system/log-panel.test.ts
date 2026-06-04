/**
 * LogPanel — getLogLevelColor Property-Based Tests
 *
 * Property 4: For any log level in ['success', 'info', 'error'],
 * getLogLevelColor(level) returns a non-empty string. Idempotence
 * is also verified.
 *
 * **Validates: Requirements 2.8**
 */

import fc from 'fast-check';
import { getLogLevelColor } from '../../app/components/ui/LogPanel';

// ─── Valid log levels ─────────────────────────────────────────────────────────

type LogLevel = 'success' | 'info' | 'error';

const ALL_LOG_LEVELS: LogLevel[] = ['success', 'info', 'error'];

// ─── Expected color classes per Requirement 2.8 ───────────────────────────────

/** Success → green-family (secondary-container = #6dfad2) */
const SUCCESS_CLASS = 'text-secondary-container';

/** Info → purple/primary-family (primary-fixed = #e4dfff) */
const INFO_CLASS = 'text-primary-fixed';

/** Error → red-family */
const ERROR_CLASS = 'text-error';

// ─── Property 4: Non-empty string and idempotence ────────────────────────────

/**
 * **Validates: Requirements 2.8**
 */
describe('Property 4 — Log Level Color Mapping', () => {
  describe('Returns a non-empty string for all log levels (property)', () => {
    test('getLogLevelColor returns a non-empty string (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_LOG_LEVELS),
          (level) => {
            const result = getLogLevelColor(level);
            return typeof result === 'string' && result.length > 0;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Idempotence — calling twice returns the same result (property)', () => {
    test('getLogLevelColor is idempotent (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_LOG_LEVELS),
          (level) => getLogLevelColor(level) === getLogLevelColor(level)
        ),
        { numRuns: 100 }
      );
    });
  });

  // ─── Color family verification per Requirement 2.8 ───────────────────────

  describe('Color family correctness', () => {
    test('success → text-secondary-container (green-family)', () => {
      expect(getLogLevelColor('success')).toBe(SUCCESS_CLASS);
    });

    test('info → text-primary-fixed (purple/primary-family)', () => {
      expect(getLogLevelColor('info')).toBe(INFO_CLASS);
    });

    test('error → text-error (red-family)', () => {
      expect(getLogLevelColor('error')).toBe(ERROR_CLASS);
    });
  });

  describe('Each level maps to a distinct class (property)', () => {
    test('success, info, and error all return different classes', () => {
      const successClass = getLogLevelColor('success');
      const infoClass    = getLogLevelColor('info');
      const errorClass   = getLogLevelColor('error');

      expect(successClass).not.toBe(infoClass);
      expect(successClass).not.toBe(errorClass);
      expect(infoClass).not.toBe(errorClass);
    });
  });

  describe('Returned class starts with "text-" (property)', () => {
    test('all log level colors are Tailwind text utility classes (property)', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...ALL_LOG_LEVELS),
          (level) => getLogLevelColor(level).startsWith('text-')
        ),
        { numRuns: 100 }
      );
    });
  });
});
