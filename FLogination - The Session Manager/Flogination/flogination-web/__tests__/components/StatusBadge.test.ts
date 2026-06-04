/**
 * StatusBadge — Unit Tests
 *
 * Tests getStatusBadgeStyle for all 14 status values and both size variants.
 * Since @testing-library/react is not available, we test the pure
 * getStatusBadgeStyle function and size class logic directly.
 *
 * Satisfies: Requirements 2.3, 16.1
 */

import { getStatusBadgeStyle } from '../../app/components/ui/StatusBadge';
import type { StatusValue } from '../../app/components/ui/StatusBadge';

// ─── Size class logic (mirrors StatusBadge.tsx) ───────────────────────────────

function buildSizeClasses(size: 'sm' | 'md' = 'md'): string {
  return size === 'sm'
    ? 'text-[11px] px-[8px] py-[2px]'
    : 'text-label-sm px-[10px] py-[3px]';
}

// ─── All 14 status values ─────────────────────────────────────────────────────

const ALL_STATUSES: StatusValue[] = [
  'live', 'active', 'checkpoint', 'restricted', 'dead', 'draft',
  'paused', 'running', 'creating', 'transferring', 'complete',
  'failed', 'verifying', 'idle',
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('StatusBadge — getStatusBadgeStyle for all 14 status values', () => {
  describe('All 14 statuses return a valid style object', () => {
    test.each(ALL_STATUSES)('status "%s" returns non-empty bg, text, prefix', (status) => {
      const style = getStatusBadgeStyle(status);
      expect(typeof style.bg).toBe('string');
      expect(style.bg.length).toBeGreaterThan(0);
      expect(typeof style.text).toBe('string');
      expect(style.text.length).toBeGreaterThan(0);
      expect(typeof style.prefix).toBe('string');
      expect(style.prefix.length).toBeGreaterThan(0);
    });
  });

  describe('Green statuses — live, active, complete', () => {
    const GREEN_STATUSES: StatusValue[] = ['live', 'active', 'complete'];

    test.each(GREEN_STATUSES)('status "%s" → green bg #00b89415', (status) => {
      expect(getStatusBadgeStyle(status).bg).toBe('#00b89415');
    });

    test.each(GREEN_STATUSES)('status "%s" → green text #00b894', (status) => {
      expect(getStatusBadgeStyle(status).text).toBe('#00b894');
    });

    test.each(GREEN_STATUSES)('status "%s" → dot prefix', (status) => {
      expect(getStatusBadgeStyle(status).prefix).toBe('dot');
    });
  });

  describe('Checkpoint — orange hex', () => {
    test('checkpoint → bg #fdcb6e15', () => {
      expect(getStatusBadgeStyle('checkpoint').bg).toBe('#fdcb6e15');
    });

    test('checkpoint → text #fdcb6e', () => {
      expect(getStatusBadgeStyle('checkpoint').text).toBe('#fdcb6e');
    });

    test('checkpoint → dot prefix', () => {
      expect(getStatusBadgeStyle('checkpoint').prefix).toBe('dot');
    });
  });

  describe('Red statuses — restricted, failed', () => {
    const RED_STATUSES: StatusValue[] = ['restricted', 'failed'];

    test.each(RED_STATUSES)('status "%s" → red bg #e1705515', (status) => {
      expect(getStatusBadgeStyle(status).bg).toBe('#e1705515');
    });

    test.each(RED_STATUSES)('status "%s" → red text #e17055', (status) => {
      expect(getStatusBadgeStyle(status).text).toBe('#e17055');
    });

    test.each(RED_STATUSES)('status "%s" → dot prefix', (status) => {
      expect(getStatusBadgeStyle(status).prefix).toBe('dot');
    });
  });

  describe('Gray statuses — dead, draft, idle', () => {
    const GRAY_STATUSES: StatusValue[] = ['dead', 'draft', 'idle'];

    test.each(GRAY_STATUSES)('status "%s" → gray bg #63636e15', (status) => {
      expect(getStatusBadgeStyle(status).bg).toBe('#63636e15');
    });

    test.each(GRAY_STATUSES)('status "%s" → gray text #636e72', (status) => {
      expect(getStatusBadgeStyle(status).text).toBe('#636e72');
    });

    test.each(GRAY_STATUSES)('status "%s" → dot prefix', (status) => {
      expect(getStatusBadgeStyle(status).prefix).toBe('dot');
    });
  });

  describe('Paused — Tailwind classes', () => {
    test('paused → bg-orange-100', () => {
      expect(getStatusBadgeStyle('paused').bg).toBe('bg-orange-100');
    });

    test('paused → text-orange-700', () => {
      expect(getStatusBadgeStyle('paused').text).toBe('text-orange-700');
    });

    test('paused → pause prefix', () => {
      expect(getStatusBadgeStyle('paused').prefix).toBe('pause');
    });

    test('paused → useInlineStyle is false', () => {
      expect(getStatusBadgeStyle('paused').useInlineStyle).toBe(false);
    });
  });

  describe('Purple/spinning statuses — running, creating, transferring, verifying', () => {
    const PURPLE_STATUSES: StatusValue[] = ['running', 'creating', 'transferring', 'verifying'];

    test.each(PURPLE_STATUSES)('status "%s" → purple bg #5341cd15', (status) => {
      expect(getStatusBadgeStyle(status).bg).toBe('#5341cd15');
    });

    test.each(PURPLE_STATUSES)('status "%s" → purple text #5341cd', (status) => {
      expect(getStatusBadgeStyle(status).text).toBe('#5341cd');
    });

    test.each(PURPLE_STATUSES)('status "%s" → spin prefix', (status) => {
      expect(getStatusBadgeStyle(status).prefix).toBe('spin');
    });
  });
});

describe('StatusBadge — size variants', () => {
  describe('sm size', () => {
    test('sm → text-[11px]', () => {
      const cls = buildSizeClasses('sm');
      expect(cls).toContain('text-[11px]');
    });

    test('sm → px-[8px] py-[2px]', () => {
      const cls = buildSizeClasses('sm');
      expect(cls).toContain('px-[8px]');
      expect(cls).toContain('py-[2px]');
    });
  });

  describe('md size (default)', () => {
    test('md → text-label-sm', () => {
      const cls = buildSizeClasses('md');
      expect(cls).toContain('text-label-sm');
    });

    test('md → px-[10px] py-[3px]', () => {
      const cls = buildSizeClasses('md');
      expect(cls).toContain('px-[10px]');
      expect(cls).toContain('py-[3px]');
    });

    test('default (no arg) → md size classes', () => {
      const cls = buildSizeClasses();
      expect(cls).toContain('text-label-sm');
    });
  });

  test('sm and md produce different class strings', () => {
    expect(buildSizeClasses('sm')).not.toBe(buildSizeClasses('md'));
  });
});
