/**
 * WarmUpView — Property-Based and Example Tests
 *
 * Tests for the three pure helper functions exported from WarmUpView.tsx:
 *   - parseSessionIds(raw: string): string[]
 *   - parseJobConfig(raw: string): WarmUpConfig | null
 *   - computeWarmUpScore(job: WarmUpJob, sessions: Session[]): number
 *
 * Feature: inbox-views-rebuild
 * Requirements: 6.1–6.9, 7.1–7.11
 */

import fc from 'fast-check';
import {
  parseSessionIds,
  parseJobConfig,
  computeWarmUpScore,
} from '../app/components/views/WarmUpView';
import type { Session, WarmUpJob, WarmUpConfig } from '../../../src/types';

// ─────────────────────────────────────────────
// HELPERS — Minimal object builders
// ─────────────────────────────────────────────

/**
 * Builds a minimal Session object with only the fields required by the type.
 * Fields not relevant to score computation are filled with stub values.
 */
function makeSession(id: string, warmUpScore?: number): Session {
  return {
    id,
    uid: 'uid-stub',
    fbName: 'Test Account',
    profileUrl: '',
    cookie: '',
    country: 'US',
    bmCount: 0,
    bmRoles: '[]',
    bmRestrictionStatus: '',
    ownedPages: '[]',
    pagesFollowingCount: 0,
    groupsJoinedCount: 0,
    groupRoles: '[]',
    bmData: '[]',
    ownedPagesData: '[]',
    joinedGroupsData: '[]',
    friendsCount: 0,
    professionalMode: false,
    monetizationStatus: false,
    healthStatus: 'live',
    scrapingStatus: 'done',
    lastCheck: 0,
    createdAt: 0,
    updatedAt: 0,
    warmUpScore,
  };
}

/**
 * Builds a minimal WarmUpJob with the given sessionIds JSON string.
 */
function makeJob(sessionIds: string, status: WarmUpJob['status'] = 'running'): WarmUpJob {
  const config: WarmUpConfig = {
    messagesPerDay: 5,
    durationDays: 7,
    responseDelayMinMs: 3000,
    responseDelayMaxMs: 15000,
    messageTemplates: [],
  };
  return {
    id: 'job-1',
    mode: 'internal',
    sessionIds,
    config: JSON.stringify(config),
    status,
    createdAt: 0,
  };
}

// ─────────────────────────────────────────────
// ARBITRARIES
// ─────────────────────────────────────────────

/** Arbitrary for a minimal Session with only fields needed for score computation. */
const arbSession = fc.record({
  id: fc.uuid(),
  warmUpScore: fc.option(fc.integer({ min: 0, max: 100 }), { nil: undefined }),
  // Required Session fields — stub values for fields not relevant to score
  uid: fc.constant('uid'),
  fbName: fc.constant('test'),
  profileUrl: fc.constant(''),
  cookie: fc.constant(''),
  country: fc.constant('US'),
  bmCount: fc.constant(0),
  bmRoles: fc.constant('[]'),
  bmRestrictionStatus: fc.constant(''),
  ownedPages: fc.constant('[]'),
  pagesFollowingCount: fc.constant(0),
  groupsJoinedCount: fc.constant(0),
  groupRoles: fc.constant('[]'),
  bmData: fc.constant('[]'),
  ownedPagesData: fc.constant('[]'),
  joinedGroupsData: fc.constant('[]'),
  friendsCount: fc.constant(0),
  professionalMode: fc.constant(false),
  monetizationStatus: fc.constant(false),
  healthStatus: fc.constant('live' as const),
  scrapingStatus: fc.constant('done' as const),
  lastCheck: fc.constant(0),
  createdAt: fc.constant(0),
  updatedAt: fc.constant(0),
});

/** Arbitrary for a WarmUpJob with a JSON-encoded sessionIds array. */
const arbWarmUpJob = fc.record({
  id: fc.uuid(),
  mode: fc.oneof(fc.constant('internal' as const), fc.constant('external' as const)),
  sessionIds: fc.array(fc.uuid(), { maxLength: 10 }).map(arr => JSON.stringify(arr)),
  config: fc.record({
    messagesPerDay: fc.integer({ min: 1, max: 20 }),
    durationDays: fc.integer({ min: 1, max: 90 }),
    responseDelayMinMs: fc.constant(3000),
    responseDelayMaxMs: fc.constant(15000),
    messageTemplates: fc.array(fc.string()),
  }).map(cfg => JSON.stringify(cfg)),
  status: fc.oneof(
    fc.constant('running' as const),
    fc.constant('paused' as const),
    fc.constant('completed' as const),
  ),
  createdAt: fc.integer({ min: 0 }),
});

/** Arbitrary for a valid WarmUpConfig object. */
const arbWarmUpConfig = fc.record({
  messagesPerDay: fc.integer({ min: 1, max: 20 }),
  durationDays: fc.integer({ min: 1, max: 90 }),
  responseDelayMinMs: fc.constant(3000),
  responseDelayMaxMs: fc.constant(15000),
  messageTemplates: fc.array(fc.string()),
});

// ─────────────────────────────────────────────
// PROPERTY TESTS
// ─────────────────────────────────────────────

describe('computeWarmUpScore — property tests', () => {
  // Feature: inbox-views-rebuild, Property 9
  test('Property 9: equals arithmetic mean of warmUpScore ?? 0 for matched sessions; returns 0 when no sessions match', () => {
    // Feature: inbox-views-rebuild, Property 9
    fc.assert(
      fc.property(
        arbWarmUpJob,
        fc.array(arbSession, { maxLength: 20 }),
        (job, sessions) => {
          const result = computeWarmUpScore(job, sessions);

          // Compute expected value manually
          const ids = parseSessionIds(job.sessionIds);
          const matched = sessions.filter(s => ids.includes(s.id));

          if (matched.length === 0) {
            // No sessions match → must return 0
            return result === 0;
          }

          const total = matched.reduce((sum, s) => sum + (s.warmUpScore ?? 0), 0);
          const expected = total / matched.length;

          // Allow floating-point epsilon
          return Math.abs(result - expected) < 1e-10;
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: inbox-views-rebuild, Property 9 (no-match sub-property)
  test('Property 9 (no-match): returns 0 when no sessions in the list match the job sessionIds', () => {
    // Feature: inbox-views-rebuild, Property 9
    fc.assert(
      fc.property(
        arbWarmUpJob,
        fc.array(arbSession, { maxLength: 20 }),
        (job, sessions) => {
          const ids = parseSessionIds(job.sessionIds);
          // Build a sessions list where none of the IDs appear in the job
          const nonMatchingSessions = sessions.filter(s => !ids.includes(s.id));
          const result = computeWarmUpScore(job, nonMatchingSessions);
          return result === 0;
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('parseSessionIds — property tests', () => {
  // Feature: inbox-views-rebuild, Property 10
  test('Property 10 (round-trip): parseSessionIds(JSON.stringify(arr)) deep-equals arr for any string[]', () => {
    // Feature: inbox-views-rebuild, Property 10
    fc.assert(
      fc.property(
        fc.array(fc.string()),
        (arr) => {
          const result = parseSessionIds(JSON.stringify(arr));
          if (result.length !== arr.length) return false;
          return arr.every((item, i) => result[i] === item);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: inbox-views-rebuild, Property 10
  test('Property 10 (invalid JSON): returns [] without throwing for any non-JSON string', () => {
    // Feature: inbox-views-rebuild, Property 10
    fc.assert(
      fc.property(
        // Generate strings that are definitely not valid JSON arrays
        fc.string().filter(s => {
          try {
            const p = JSON.parse(s);
            return !Array.isArray(p);
          } catch {
            return true; // invalid JSON — include it
          }
        }),
        (invalidOrNonArray) => {
          let result: string[];
          try {
            result = parseSessionIds(invalidOrNonArray);
          } catch {
            return false; // must NOT throw
          }
          return Array.isArray(result) && result.length === 0;
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('parseJobConfig — property tests', () => {
  test('round-trip: parseJobConfig(JSON.stringify(config)) deep-equals original WarmUpConfig', () => {
    fc.assert(
      fc.property(
        arbWarmUpConfig,
        (config) => {
          const result = parseJobConfig(JSON.stringify(config));
          if (result === null) return false;
          return (
            result.messagesPerDay === config.messagesPerDay &&
            result.durationDays === config.durationDays &&
            result.responseDelayMinMs === config.responseDelayMinMs &&
            result.responseDelayMaxMs === config.responseDelayMaxMs &&
            result.messageTemplates.length === config.messageTemplates.filter(t => typeof t === 'string').length
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  test('invalid JSON: returns null without throwing for any non-JSON string', () => {
    fc.assert(
      fc.property(
        fc.string().filter(s => {
          try {
            JSON.parse(s);
            return false; // valid JSON — exclude
          } catch {
            return true; // invalid JSON — include
          }
        }),
        (invalidJson) => {
          let result: ReturnType<typeof parseJobConfig>;
          try {
            result = parseJobConfig(invalidJson);
          } catch {
            return false; // must NOT throw
          }
          return result === null;
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─────────────────────────────────────────────
// EXAMPLE TESTS — computeWarmUpScore
// ─────────────────────────────────────────────

describe('computeWarmUpScore — example tests', () => {
  test('all sessions matched: mean of [60, 80] = 70', () => {
    const job = makeJob(JSON.stringify(['a', 'b']));
    const sessions = [
      makeSession('a', 60),
      makeSession('b', 80),
    ];
    expect(computeWarmUpScore(job, sessions)).toBe(70);
  });

  test('partial match: only "a" matches from sessionIds ["a","b","c"], score 50 → mean = 50', () => {
    const job = makeJob(JSON.stringify(['a', 'b', 'c']));
    const sessions = [
      makeSession('a', 50),
      makeSession('x', 100), // "x" is not in the job's sessionIds
    ];
    // Only "a" matches → mean of [50] = 50
    expect(computeWarmUpScore(job, sessions)).toBe(50);
  });

  test('no match: job has sessionIds ["z"], sessions has only "a" → score = 0', () => {
    const job = makeJob(JSON.stringify(['z']));
    const sessions = [makeSession('a', 80)];
    expect(computeWarmUpScore(job, sessions)).toBe(0);
  });

  test('empty sessionIds: job has sessionIds "[]", any sessions → score = 0', () => {
    const job = makeJob('[]');
    const sessions = [makeSession('a', 80)];
    expect(computeWarmUpScore(job, sessions)).toBe(0);
  });

  test('warmUpScore undefined treated as 0: mean of [undefined, 40] = 20', () => {
    const job = makeJob(JSON.stringify(['a', 'b']));
    const sessions = [
      makeSession('a', undefined), // warmUpScore ?? 0 → 0
      makeSession('b', 40),
    ];
    expect(computeWarmUpScore(job, sessions)).toBe(20);
  });

  test('all warmUpScores undefined: mean of [0, 0] = 0', () => {
    const job = makeJob(JSON.stringify(['a', 'b']));
    const sessions = [
      makeSession('a', undefined),
      makeSession('b', undefined),
    ];
    expect(computeWarmUpScore(job, sessions)).toBe(0);
  });
});

// ─────────────────────────────────────────────
// EXAMPLE TESTS — parseSessionIds
// ─────────────────────────────────────────────

describe('parseSessionIds — example tests', () => {
  test('valid JSON array of strings → returns the array', () => {
    expect(parseSessionIds('["abc","def"]')).toEqual(['abc', 'def']);
  });

  test('empty JSON array → returns []', () => {
    expect(parseSessionIds('[]')).toEqual([]);
  });

  test('invalid JSON → returns []', () => {
    expect(parseSessionIds('not-json')).toEqual([]);
  });

  test('JSON object (not array) → returns []', () => {
    expect(parseSessionIds('{"key":"value"}')).toEqual([]);
  });

  test('JSON array with non-string elements → filters them out', () => {
    expect(parseSessionIds('["a", 1, null, "b"]')).toEqual(['a', 'b']);
  });

  test('empty string → returns []', () => {
    expect(parseSessionIds('')).toEqual([]);
  });
});

// ─────────────────────────────────────────────
// EXAMPLE TESTS — parseJobConfig
// ─────────────────────────────────────────────

describe('parseJobConfig — example tests', () => {
  const validConfig: WarmUpConfig = {
    messagesPerDay: 5,
    durationDays: 7,
    responseDelayMinMs: 3000,
    responseDelayMaxMs: 15000,
    messageTemplates: ['Hello!', 'How are you?'],
  };

  test('valid WarmUpConfig JSON → returns parsed config', () => {
    const result = parseJobConfig(JSON.stringify(validConfig));
    expect(result).toEqual(validConfig);
  });

  test('invalid JSON → returns null', () => {
    expect(parseJobConfig('bad-json')).toBeNull();
  });

  test('empty string → returns null', () => {
    expect(parseJobConfig('')).toBeNull();
  });

  test('JSON object missing required fields → returns null', () => {
    expect(parseJobConfig('{"messagesPerDay":5}')).toBeNull();
  });

  test('JSON array (not object) → returns null', () => {
    expect(parseJobConfig('[1,2,3]')).toBeNull();
  });

  test('null JSON value → returns null', () => {
    expect(parseJobConfig('null')).toBeNull();
  });
});
