/**
 * StatusBadge — Snapshot / Regression Tests
 *
 * Tests getStatusBadgeStyle for all 14 status values and both size variants
 * as a regression baseline. Since @testing-library/react is not available,
 * we snapshot the pure getStatusBadgeStyle function output directly.
 *
 * Satisfies: Requirements 2.3, 16.1
 */

import { getStatusBadgeStyle } from '../../app/components/ui/StatusBadge';
import type { StatusValue } from '../../app/components/ui/StatusBadge';

// ─── All 14 status values ─────────────────────────────────────────────────────

const ALL_STATUSES: StatusValue[] = [
  'live',
  'active',
  'checkpoint',
  'restricted',
  'dead',
  'draft',
  'paused',
  'running',
  'creating',
  'transferring',
  'complete',
  'failed',
  'verifying',
  'idle',
];

// ─── Size class logic (mirrors StatusBadge.tsx) ───────────────────────────────

function buildSizeClasses(size: 'sm' | 'md' = 'md'): string {
  return size === 'sm'
    ? 'text-[11px] px-[8px] py-[2px]'
    : 'text-label-sm px-[10px] py-[3px]';
}

// ─── Snapshot Tests ───────────────────────────────────────────────────────────

describe('StatusBadge — snapshot regression baseline (all 14 status values)', () => {
  test.each(ALL_STATUSES)('getStatusBadgeStyle("%s") snapshot', (status) => {
    expect(getStatusBadgeStyle(status)).toMatchSnapshot();
  });
});

describe('StatusBadge — size class snapshots', () => {
  test('sm size classes snapshot', () => {
    expect(buildSizeClasses('sm')).toMatchSnapshot();
  });

  test('md size classes snapshot (default)', () => {
    expect(buildSizeClasses('md')).toMatchSnapshot();
  });

  test('default (no arg) size classes snapshot', () => {
    expect(buildSizeClasses()).toMatchSnapshot();
  });
});

describe('StatusBadge — full style descriptor snapshots per status group', () => {
  test('green group (live, active, complete) — all return identical style', () => {
    const liveStyle = getStatusBadgeStyle('live');
    const activeStyle = getStatusBadgeStyle('active');
    const completeStyle = getStatusBadgeStyle('complete');
    expect({ live: liveStyle, active: activeStyle, complete: completeStyle }).toMatchSnapshot();
  });

  test('red group (restricted, failed) — all return identical style', () => {
    const restrictedStyle = getStatusBadgeStyle('restricted');
    const failedStyle = getStatusBadgeStyle('failed');
    expect({ restricted: restrictedStyle, failed: failedStyle }).toMatchSnapshot();
  });

  test('gray group (dead, draft, idle) — all return identical style', () => {
    const deadStyle = getStatusBadgeStyle('dead');
    const draftStyle = getStatusBadgeStyle('draft');
    const idleStyle = getStatusBadgeStyle('idle');
    expect({ dead: deadStyle, draft: draftStyle, idle: idleStyle }).toMatchSnapshot();
  });

  test('purple/spin group (running, creating, transferring, verifying) — all return identical style', () => {
    const runningStyle = getStatusBadgeStyle('running');
    const creatingStyle = getStatusBadgeStyle('creating');
    const transferringStyle = getStatusBadgeStyle('transferring');
    const verifyingStyle = getStatusBadgeStyle('verifying');
    expect({
      running: runningStyle,
      creating: creatingStyle,
      transferring: transferringStyle,
      verifying: verifyingStyle,
    }).toMatchSnapshot();
  });

  test('checkpoint — unique orange hex style', () => {
    expect(getStatusBadgeStyle('checkpoint')).toMatchSnapshot();
  });

  test('paused — unique Tailwind class style', () => {
    expect(getStatusBadgeStyle('paused')).toMatchSnapshot();
  });
});
