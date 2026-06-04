'use client';

import { useEffect, useState } from 'react';
import { useStore } from '../../../../../src/store';
import type { Session, WarmUpConfig, WarmUpJob } from '../../../../../src/types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Minimum number of sessions required to create a warm-up job. */
const MIN_SESSIONS_FOR_WARMUP = 2;

/** Maximum messages per day allowed in a warm-up job config. */
const MAX_MESSAGES_PER_DAY = 20;

/** Minimum messages per day allowed in a warm-up job config. */
const MIN_MESSAGES_PER_DAY = 1;

/** Maximum duration in days for a warm-up job. */
const MAX_DURATION_DAYS = 90;

/** Minimum duration in days for a warm-up job. */
const MIN_DURATION_DAYS = 1;

/** Minimum response delay in milliseconds for external warm-up mode. */
const RESPONSE_DELAY_MIN_MS = 3_000;

/** Maximum response delay in milliseconds for external warm-up mode. */
const RESPONSE_DELAY_MAX_MS = 15_000;

/** Default messages per day for a new warm-up job. */
const DEFAULT_MESSAGES_PER_DAY = 5;

/** Default duration in days for a new warm-up job. */
const DEFAULT_DURATION_DAYS = 7;

// ─────────────────────────────────────────────
// PURE HELPERS
// ─────────────────────────────────────────────

/**
 * Parses a JSON-encoded string array of session IDs.
 * Returns an empty array if the input is not valid JSON or not an array.
 *
 * @param raw - JSON string expected to encode a string[]
 * @returns Parsed string array, or [] on any parse failure
 *
 * @example
 * parseSessionIds('["abc","def"]') // → ["abc", "def"]
 * parseSessionIds('not-json')      // → []
 */
export function parseSessionIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/**
 * Parses a JSON-encoded WarmUpConfig string.
 * Returns null if the input is not valid JSON or does not match the expected shape.
 *
 * @param raw - JSON string expected to encode a WarmUpConfig object
 * @returns Parsed WarmUpConfig, or null on any parse failure
 *
 * @example
 * parseJobConfig('{"messagesPerDay":5,"durationDays":7,...}') // → WarmUpConfig
 * parseJobConfig('bad-json')                                  // → null
 */
export function parseJobConfig(raw: string): WarmUpConfig | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj['messagesPerDay'] !== 'number' ||
      typeof obj['durationDays'] !== 'number' ||
      typeof obj['responseDelayMinMs'] !== 'number' ||
      typeof obj['responseDelayMaxMs'] !== 'number' ||
      !Array.isArray(obj['messageTemplates'])
    ) {
      return null;
    }
    return {
      messagesPerDay: obj['messagesPerDay'] as number,
      durationDays: obj['durationDays'] as number,
      responseDelayMinMs: obj['responseDelayMinMs'] as number,
      responseDelayMaxMs: obj['responseDelayMaxMs'] as number,
      messageTemplates: (obj['messageTemplates'] as unknown[]).filter(
        (t): t is string => typeof t === 'string'
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Computes the warm-up score for a job as the arithmetic mean of
 * `warmUpScore ?? 0` across all sessions matched by the job's sessionIds.
 * Returns 0 if no sessions match or sessionIds is empty/invalid.
 *
 * @param job - The WarmUpJob to compute the score for
 * @param sessions - Full list of sessions to look up IDs against
 * @returns Arithmetic mean of warmUpScore for matched sessions, or 0
 *
 * @example
 * computeWarmUpScore(job, sessions) // → 42.5
 */
export function computeWarmUpScore(job: WarmUpJob, sessions: Session[]): number {
  const ids = parseSessionIds(job.sessionIds);
  if (ids.length === 0) return 0;
  const matched = sessions.filter(s => ids.includes(s.id));
  if (matched.length === 0) return 0;
  const total = matched.reduce((sum, s) => sum + (s.warmUpScore ?? 0), 0);
  return total / matched.length;
}

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────

/**
 * WarmUpView — Warm-up job manager.
 *
 * Renders a two-panel layout:
 * - Left panel: job creation form (mode selector, config inputs, session multi-select)
 * - Right panel: jobs table (populated by Task 7)
 *
 * Consumes the Zustand store for all state and actions.
 * All magic numbers are defined as named constants above.
 */
export function WarmUpView() {
  const {
    sessions,
    warmUpJobs,
    fetchWarmUpJobs,
    createWarmUpJob,
    pauseWarmUpJob,
    startWarmUpJob,
    deleteWarmUpJob,
  } = useStore();

  // ── Local state ──────────────────────────────
  const [mode, setMode] = useState<'internal' | 'external'>('internal');
  const [messagesPerDay, setMessagesPerDay] = useState<number>(DEFAULT_MESSAGES_PER_DAY);
  const [durationDays, setDurationDays] = useState<number>(DEFAULT_DURATION_DAYS);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // ── Mount effect ─────────────────────────────
  useEffect(() => {
    void fetchWarmUpJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived data ─────────────────────────────
  const eligibleSessions = sessions.filter(
    s => s.healthStatus === 'live' || s.healthStatus === 'warming'
  );

  // ── Handlers ─────────────────────────────────

  /** Toggles a session's inclusion in the selected set. */
  const handleToggleSession = (id: string): void => {
    setSelectedSessionIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  /** Clamps a numeric input value to the given min/max range. */
  const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

  /** Handles the Create Job button click. */
  const handleCreate = async (): Promise<void> => {
    if (selectedSessionIds.size < MIN_SESSIONS_FOR_WARMUP) {
      setError(`Select at least ${MIN_SESSIONS_FOR_WARMUP} sessions to create a warm-up job.`);
      return;
    }

    setError(null);
    setIsCreating(true);

    try {
      await createWarmUpJob({
        mode,
        sessionIds: JSON.stringify(Array.from(selectedSessionIds)),
        config: JSON.stringify({
          messagesPerDay,
          durationDays,
          responseDelayMinMs: RESPONSE_DELAY_MIN_MS,
          responseDelayMaxMs: RESPONSE_DELAY_MAX_MS,
          messageTemplates: [],
        } satisfies WarmUpConfig),
        status: 'running',
      });
      // Success — clear selections and error
      setSelectedSessionIds(new Set());
      setError(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Failed to create warm-up job';
      setError(message);
    } finally {
      setIsCreating(false);
    }
  };

  // ── Render ────────────────────────────────────
  return (
    <div className="flex h-full gap-1 p-4">

      {/* ── LEFT PANEL — Job Creation Form ─────── */}
      <div className="w-80 shrink-0 flex flex-col gap-1">

        {/* Mode selector */}
        <div className="bg-surface border border-outline-variant p-3 flex flex-col gap-3 rounded">
          <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            Warm-Up Mode
          </span>
          <div className="flex gap-2">
            {(['internal', 'external'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 h-8 rounded text-sm border transition-colors capitalize ${
                  mode === m
                    ? 'bg-primary-container/20 border-primary text-primary'
                    : 'border-outline-variant text-on-surface-variant hover:bg-surface-container-low'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            {mode === 'internal'
              ? 'Pairs sessions together and sends messages between them on a schedule.'
              : 'Monitors incoming messages and auto-replies with AI after a human-like delay.'}
          </p>
        </div>

        {/* Config inputs */}
        <div className="bg-surface border border-outline-variant p-3 flex flex-col gap-3 rounded">
          <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            Config
          </span>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-on-surface-variant">
              Messages per day ({MIN_MESSAGES_PER_DAY}–{MAX_MESSAGES_PER_DAY})
            </span>
            <input
              type="number"
              min={MIN_MESSAGES_PER_DAY}
              max={MAX_MESSAGES_PER_DAY}
              value={messagesPerDay}
              onChange={e =>
                setMessagesPerDay(clamp(Number(e.target.value), MIN_MESSAGES_PER_DAY, MAX_MESSAGES_PER_DAY))
              }
              className="h-8 px-2 text-sm text-on-surface bg-transparent border border-outline-variant rounded w-full focus:outline-none focus:border-primary"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-on-surface-variant">
              Duration ({MIN_DURATION_DAYS}–{MAX_DURATION_DAYS} days)
            </span>
            <input
              type="number"
              min={MIN_DURATION_DAYS}
              max={MAX_DURATION_DAYS}
              value={durationDays}
              onChange={e =>
                setDurationDays(clamp(Number(e.target.value), MIN_DURATION_DAYS, MAX_DURATION_DAYS))
              }
              className="h-8 px-2 text-sm text-on-surface bg-transparent border border-outline-variant rounded w-full focus:outline-none focus:border-primary"
            />
          </label>
        </div>

        {/* Session multi-select */}
        <div className="bg-surface border border-outline-variant flex flex-col flex-1 min-h-0 rounded overflow-hidden">
          <div className="px-3 py-2 border-b border-outline-variant flex justify-between items-center bg-surface-container-low shrink-0">
            <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
              Sessions
            </span>
            <span className="text-xs text-on-surface-variant font-mono">
              {selectedSessionIds.size} selected
            </span>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {eligibleSessions.length === 0 ? (
              <div className="p-4 text-center text-sm text-on-surface-variant">
                <span className="material-symbols-outlined text-2xl block mb-1 opacity-40">
                  wifi_off
                </span>
                No live or warming sessions available
              </div>
            ) : (
              eligibleSessions.map(s => {
                const isSelected = selectedSessionIds.has(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => handleToggleSession(s.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 border-b border-outline-variant hover:bg-surface-container-low transition-colors text-left ${
                      isSelected ? 'bg-primary-container/10' : ''
                    }`}
                  >
                    {/* Checkbox indicator */}
                    <div
                      className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-primary border-primary'
                          : 'border-outline-variant bg-transparent'
                      }`}
                    >
                      {isSelected && (
                        <span className="material-symbols-outlined text-[12px] text-white leading-none">
                          check
                        </span>
                      )}
                    </div>

                    {/* Session info */}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-sm text-on-surface truncate">
                        {s.fbName || `Account ${s.id.slice(0, 8)}`}
                      </span>
                      <span className="text-[10px] text-on-surface-variant font-mono capitalize">
                        {s.healthStatus}
                        {s.warmUpScore !== undefined ? ` · score ${s.warmUpScore}` : ''}
                      </span>
                    </div>

                    {/* Health status icon */}
                    <span
                      className={`material-symbols-outlined text-[14px] shrink-0 ${
                        s.healthStatus === 'live' ? 'text-green-500' : 'text-amber-500'
                      }`}
                    >
                      {s.healthStatus === 'live' ? 'check_circle' : 'autorenew'}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Inline error */}
        {error !== null && (
          <div className="flex items-start gap-2 bg-error/10 border border-error/30 text-error text-sm px-3 py-2 rounded">
            <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">error</span>
            <span>{error}</span>
          </div>
        )}

        {/* Create Job button */}
        <button
          onClick={() => void handleCreate()}
          disabled={isCreating}
          className="h-9 bg-primary-container text-on-primary-container text-sm font-semibold rounded flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {isCreating ? (
            <>
              <span className="material-symbols-outlined text-[16px] animate-spin">
                progress_activity
              </span>
              Creating…
            </>
          ) : (
            <>
              <span className="material-symbols-outlined text-[16px]">whatshot</span>
              Create Job
            </>
          )}
        </button>
      </div>

      {/* ── RIGHT PANEL — Jobs Table ────────────── */}
      <div className="flex-1 bg-surface border border-outline-variant flex flex-col min-h-0 rounded overflow-hidden">

        {/* Panel header */}
        <div className="px-3 py-2 border-b border-outline-variant flex justify-between items-center bg-surface-container-low shrink-0">
          <span className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            Warm-Up Jobs
          </span>
          <span className="text-xs text-on-surface-variant font-mono">
            {warmUpJobs.length} total
          </span>
        </div>

        {/* Table scroll container */}
        <div className="flex-1 overflow-auto scrollbar-hide">
          {warmUpJobs.length === 0 ? (
            /* ── Empty state ── */
            <div className="flex flex-col items-center justify-center h-full gap-2 text-on-surface-variant">
              <span className="material-symbols-outlined text-4xl opacity-30">
                local_fire_department
              </span>
              <p className="text-sm">No warm-up jobs yet.</p>
              <p className="text-xs opacity-60">Create one to start building account trust scores.</p>
            </div>
          ) : (
            /* ── Jobs table ── */
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-outline-variant bg-surface-container-low sticky top-0 z-10">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                    Mode
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                    Sessions
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                    Msg/Day
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                    Duration
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                    Status
                  </th>
                  <th
                    title="msgs_sent×0.4 + msgs_replied×0.4 + age_factor×20"
                    className="px-3 py-2 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap cursor-help"
                  >
                    Score
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-on-surface-variant uppercase tracking-wider whitespace-nowrap">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {warmUpJobs.map((job: WarmUpJob) => {
                  const cfg = parseJobConfig(job.config);
                  const sessionCount = parseSessionIds(job.sessionIds).length;
                  const score = Math.round(computeWarmUpScore(job, sessions));
                  const scoreBarWidth = Math.min(score, 100);

                  // Status badge classes
                  const statusClasses: Record<'running' | 'paused' | 'completed', string> = {
                    running: 'text-green-500 bg-green-500/10 border-green-500/30',
                    paused: 'text-amber-500 bg-amber-500/10 border-amber-500/30',
                    completed: 'text-on-surface-variant bg-surface-container border-outline-variant',
                  };
                  const statusIcons: Record<'running' | 'paused' | 'completed', string> = {
                    running: 'play_circle',
                    paused: 'pause_circle',
                    completed: 'check_circle',
                  };

                  return (
                    <tr
                      key={job.id}
                      className="border-b border-outline-variant hover:bg-surface-container-low transition-colors"
                    >
                      {/* Mode */}
                      <td className="px-3 py-2 text-on-surface capitalize whitespace-nowrap">
                        {job.mode}
                      </td>

                      {/* Sessions count */}
                      <td className="px-3 py-2 text-on-surface-variant whitespace-nowrap font-mono">
                        {sessionCount}
                      </td>

                      {/* Msg/Day */}
                      <td className="px-3 py-2 text-on-surface-variant whitespace-nowrap font-mono">
                        {cfg !== null ? cfg.messagesPerDay : '—'}
                      </td>

                      {/* Duration */}
                      <td className="px-3 py-2 text-on-surface-variant whitespace-nowrap font-mono">
                        {cfg !== null ? `${cfg.durationDays}d` : '—'}
                      </td>

                      {/* Status badge */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium ${statusClasses[job.status]}`}
                        >
                          <span className="material-symbols-outlined text-[12px] leading-none">
                            {statusIcons[job.status]}
                          </span>
                          <span className="capitalize">{job.status}</span>
                        </span>
                      </td>

                      {/* Score + progress bar */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-2 min-w-[100px]">
                          <span className="text-on-surface font-mono text-xs w-7 shrink-0 text-right">
                            {score}
                          </span>
                          {/* Progress bar track */}
                          <div className="flex-1 h-1.5 bg-surface-container rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${scoreBarWidth}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Action buttons */}
                      <td className="px-3 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {/* Pause — only for running jobs */}
                          {job.status === 'running' && (
                            <button
                              onClick={() => void pauseWarmUpJob(job.id)}
                              title="Pause job"
                              className="h-7 px-2 border border-outline-variant rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors text-xs flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[14px]">pause</span>
                              Pause
                            </button>
                          )}

                          {/* Start — only for paused jobs */}
                          {job.status === 'paused' && (
                            <button
                              onClick={() => void startWarmUpJob(job.id)}
                              title="Resume job"
                              className="h-7 px-2 border border-outline-variant rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors text-xs flex items-center gap-1"
                            >
                              <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                              Start
                            </button>
                          )}

                          {/* Delete — always visible */}
                          <button
                            onClick={() => void deleteWarmUpJob(job.id)}
                            title="Delete job"
                            className="h-7 px-2 border border-error/30 rounded text-error hover:bg-error/10 transition-colors text-xs flex items-center gap-1"
                          >
                            <span className="material-symbols-outlined text-[14px]">delete</span>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
