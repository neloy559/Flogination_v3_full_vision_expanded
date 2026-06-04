'use client';
import { useState, useEffect, useCallback } from 'react';
import { useStore, startPolling } from '../../../../../src/store';
import type { ActivityLog, Session } from '../../../../../src/types';
import { ContentCard } from '../ui/ContentCard';
import { StatusBadge } from '../ui/StatusBadge';
import type { StatusValue } from '../ui/StatusBadge';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** How often to auto-refresh the logs table. */
const LOG_POLL_INTERVAL_MS = 5_000;

/** Default number of log entries to fetch. */
const DEFAULT_LOG_LIMIT = 100;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Formats a Unix millisecond timestamp as a human-readable local time string.
 */
function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Maps an action string to a StatusValue for the StatusBadge component.
 * Returns null when no specific status applies (renders a plain text badge instead).
 */
function actionToStatusValue(action: string): StatusValue | null {
  if (action.includes('error') || action.includes('fail') || action.includes('dead')) {
    return 'failed';
  }
  if (action.includes('checkpoint')) {
    return 'checkpoint';
  }
  if (action.includes('restricted')) {
    return 'restricted';
  }
  if (action.includes('warn')) {
    return 'checkpoint';
  }
  if (
    action.includes('launch') ||
    action.includes('live') ||
    action.includes('success') ||
    action.includes('parked')
  ) {
    return 'live';
  }
  return null;
}

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────

/**
 * Logs View — displays the activity_logs table with filtering and auto-refresh.
 *
 * Features:
 *  - Filter by session (dropdown) and free-text search across action + details
 *  - Auto-refresh every 5s via polling
 *  - Color-coded action badges (error/warn/success/neutral) via StatusBadge
 */
export function LogsView() {
  const { sessions, logs, fetchLogs } = useStore();

  const [filterSessionId, setFilterSessionId] = useState('');
  const [searchText, setSearchText] = useState('');

  // ── Polling ──────────────────────────────────
  const doFetch = useCallback((): Promise<void> => {
    return fetchLogs(filterSessionId || undefined, DEFAULT_LOG_LIMIT).then(() => undefined);
  }, [fetchLogs, filterSessionId]);

  useEffect(() => {
    doFetch();
    const stop = startPolling(doFetch, LOG_POLL_INTERVAL_MS);
    return stop;
  }, [doFetch]);

  // ── Filtering ────────────────────────────────
  const sessionMap = new Map<string, Session>(sessions.map((s) => [s.id, s]));

  const filteredLogs: ActivityLog[] = logs.filter((log) => {
    if (!searchText) return true;
    const needle = searchText.toLowerCase();
    const session = sessionMap.get(log.sessionId);
    return (
      log.action.toLowerCase().includes(needle) ||
      log.details.toLowerCase().includes(needle) ||
      (session?.fbName ?? '').toLowerCase().includes(needle) ||
      log.sessionId.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="p-container_padding bg-background flex flex-col gap-3 h-full overflow-hidden">
      {/* Header */}
      <ContentCard padding="sm">
        <div className="flex items-center justify-between">
          <h1 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[18px]">list_alt</span>
            Activity Logs
          </h1>
          <span className="font-data-mono text-data-mono text-on-surface-variant">
            {filteredLogs.length} entries | Auto-refresh 5s
          </span>
        </div>
      </ContentCard>

      {/* Filter bar */}
      <ContentCard padding="sm">
        <div className="flex items-center gap-2">
          {/* Session filter */}
          <div className="flex items-center gap-1.5 bg-surface-container-low border border-outline-variant rounded px-2 h-8">
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant">person</span>
            <select
              className="bg-transparent text-on-surface font-data-mono text-[11px] outline-none h-full"
              value={filterSessionId}
              onChange={(e) => setFilterSessionId(e.target.value)}
            >
              <option value="">All Sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fbName}
                </option>
              ))}
            </select>
          </div>

          {/* Free-text search */}
          <div className="flex-1 flex items-center gap-1.5 bg-surface-container-low border border-outline-variant rounded px-2 h-8">
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant">search</span>
            <input
              className="flex-1 bg-transparent text-on-surface font-data-mono text-[11px] outline-none placeholder:text-on-surface-variant"
              placeholder="Search action, details, session name..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            {searchText && (
              <button
                onClick={() => setSearchText('')}
                className="text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            )}
          </div>

          {/* Manual refresh */}
          <button
            onClick={doFetch}
            className="h-8 px-3 border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors rounded flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[14px]">refresh</span>
            <span className="font-body-sm text-[11px]">Refresh</span>
          </button>
        </div>
      </ContentCard>

      {/* Logs table */}
      <ContentCard padding="sm" className="flex-1 flex flex-col overflow-hidden !p-0">
        <div className="overflow-auto flex-1">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="sticky top-0 bg-surface-container-low border-b border-outline-variant z-10">
              <tr>
                {['Timestamp', 'Session', 'Action', 'Details'].map((h) => (
                  <th key={h} className="px-3 py-1 font-label-caps text-label-caps text-on-surface-variant">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-data-mono text-data-mono">
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-on-surface-variant">
                    {logs.length === 0 ? 'No activity logged yet.' : 'No results match your filter.'}
                  </td>
                </tr>
              )}
              {filteredLogs.map((log) => {
                const session = sessionMap.get(log.sessionId);
                const statusValue = actionToStatusValue(log.action);
                return (
                  <tr
                    key={log.id}
                    className="h-[28px] border-b border-outline-variant hover:bg-surface-container-highest transition-colors"
                  >
                    {/* Timestamp */}
                    <td className="px-3 py-1 text-on-surface-variant text-[10px] shrink-0">
                      {formatTimestamp(log.timestamp)}
                    </td>

                    {/* Session */}
                    <td className="px-3 py-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-on-surface truncate max-w-[140px]">
                          {session?.fbName ?? '—'}
                        </span>
                        {session?.uid && (
                          <span className="text-[9px] text-on-surface-variant">
                            {session.uid.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Action badge */}
                    <td className="px-3 py-1">
                      {statusValue ? (
                        <StatusBadge status={statusValue} size="sm" />
                      ) : (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border text-[9px] uppercase tracking-wider bg-surface-container text-on-surface-variant border-outline-variant">
                          {log.action.replace(/_/g, ' ')}
                        </span>
                      )}
                    </td>

                    {/* Details */}
                    <td className="px-3 py-1 text-on-surface-variant max-w-[400px] truncate">
                      {log.details}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </ContentCard>
    </div>
  );
}
