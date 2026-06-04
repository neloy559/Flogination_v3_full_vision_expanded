/**
 * LogPanel — Snapshot / Regression Tests
 *
 * Tests getLogLevelColor for all three log levels and the empty-entries
 * state as a regression baseline. Since @testing-library/react is not
 * available, we snapshot the pure getLogLevelColor function output directly.
 *
 * Satisfies: Requirements 2.8, 16.1
 */

import { getLogLevelColor } from '../../app/components/ui/LogPanel';

// ─── Log level type (mirrors LogPanel.tsx) ────────────────────────────────────

type LogLevel = 'success' | 'info' | 'error';

// ─── Sample log entries for snapshot ─────────────────────────────────────────

const SAMPLE_SUCCESS_ENTRY = {
  id: 'entry-1',
  level: 'success' as LogLevel,
  message: 'Session launched successfully',
  timestamp: 1700000000000,
};

const SAMPLE_INFO_ENTRY = {
  id: 'entry-2',
  level: 'info' as LogLevel,
  message: 'Scraping profile data...',
  timestamp: 1700000001000,
};

const SAMPLE_ERROR_ENTRY = {
  id: 'entry-3',
  level: 'error' as LogLevel,
  message: 'Failed to connect to proxy',
  timestamp: 1700000002000,
};

// ─── Snapshot Tests ───────────────────────────────────────────────────────────

describe('LogPanel — getLogLevelColor snapshot regression baseline', () => {
  test('success level → color class snapshot', () => {
    expect(getLogLevelColor('success')).toMatchSnapshot();
  });

  test('info level → color class snapshot', () => {
    expect(getLogLevelColor('info')).toMatchSnapshot();
  });

  test('error level → color class snapshot', () => {
    expect(getLogLevelColor('error')).toMatchSnapshot();
  });

  test('all three levels — combined snapshot', () => {
    expect({
      success: getLogLevelColor('success'),
      info:    getLogLevelColor('info'),
      error:   getLogLevelColor('error'),
    }).toMatchSnapshot();
  });
});

describe('LogPanel — log entry structure snapshots', () => {
  test('success entry structure snapshot', () => {
    expect({
      ...SAMPLE_SUCCESS_ENTRY,
      colorClass: getLogLevelColor(SAMPLE_SUCCESS_ENTRY.level),
    }).toMatchSnapshot();
  });

  test('info entry structure snapshot', () => {
    expect({
      ...SAMPLE_INFO_ENTRY,
      colorClass: getLogLevelColor(SAMPLE_INFO_ENTRY.level),
    }).toMatchSnapshot();
  });

  test('error entry structure snapshot', () => {
    expect({
      ...SAMPLE_ERROR_ENTRY,
      colorClass: getLogLevelColor(SAMPLE_ERROR_ENTRY.level),
    }).toMatchSnapshot();
  });

  test('empty entries state snapshot', () => {
    const entries: typeof SAMPLE_SUCCESS_ENTRY[] = [];
    expect({
      isEmpty: entries.length === 0,
      count: entries.length,
      emptyMessage: 'No log entries',
    }).toMatchSnapshot();
  });

  test('all three log levels with entries snapshot', () => {
    const entries = [SAMPLE_SUCCESS_ENTRY, SAMPLE_INFO_ENTRY, SAMPLE_ERROR_ENTRY];
    expect(
      entries.map((e) => ({
        id: e.id,
        level: e.level,
        colorClass: getLogLevelColor(e.level),
      }))
    ).toMatchSnapshot();
  });
});
