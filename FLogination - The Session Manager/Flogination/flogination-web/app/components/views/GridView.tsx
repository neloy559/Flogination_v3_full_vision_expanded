'use client';
import { useState, useEffect, useCallback } from 'react';
import { useStore, startPolling } from '../../../../../src/store';
import type { Session } from '../../../../../src/types';
import { ContentCard } from '../ui/ContentCard';
import { StatusBadge } from '../ui/StatusBadge';
import type { StatusValue } from '../ui/StatusBadge';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** How often to poll for active sessions. */
const GRID_POLL_INTERVAL_MS = 3_000;

/** Default grid layout (cols × rows). */
const DEFAULT_COLS = 3;
const DEFAULT_ROWS = 4;

/** Min/max grid dimensions. */
const MIN_COLS = 1;
const MAX_COLS = 6;
const MIN_ROWS = 1;
const MAX_ROWS = 6;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Maps a health status string to a StatusValue for the StatusBadge component.
 */
function healthStatusToStatusValue(status: string): StatusValue {
  switch (status) {
    case 'live':         return 'live';
    case 'checkpoint':   return 'checkpoint';
    case 'restricted':   return 'restricted';
    case 'dead':         return 'dead';
    default:             return 'idle';
  }
}

/**
 * Returns a Material Symbol icon name for a session state.
 */
function stateIcon(state: string | undefined): string {
  switch (state) {
    case 'active':      return 'play_circle';
    case 'launching':   return 'pending';
    case 'hibernating': return 'bedtime';
    case 'closing':     return 'stop_circle';
    default:            return 'radio_button_unchecked';
  }
}

/**
 * Returns a color class for the state icon.
 */
function stateIconColor(state: string | undefined): string {
  switch (state) {
    case 'active':      return 'text-[#3fb950]';
    case 'launching':   return 'text-[#ffba42]';
    case 'hibernating': return 'text-on-surface-variant';
    default:            return 'text-outline-variant';
  }
}

// ─────────────────────────────────────────────
// SESSION TILE
// ─────────────────────────────────────────────

interface SessionTileProps {
  session: Session;
  onHibernate: (id: string) => void;
  onWake: (id: string) => void;
  onClose: (id: string) => void;
}

/**
 * A single tile in the grid view representing one active session.
 */
function SessionTile({ session, onHibernate, onWake, onClose }: SessionTileProps) {
  const isHibernating = session.state === 'hibernating';
  const isActive = session.state === 'active';

  return (
    <div className="bg-surface-container-low border border-outline-variant rounded flex flex-col overflow-hidden hover:border-primary/50 transition-colors">
      {/* Tile header */}
      <div className="h-7 bg-surface-container-highest border-b border-outline-variant flex items-center px-2 gap-2">
        <span className={`material-symbols-outlined text-[14px] ${stateIconColor(session.state)}`}>
          {stateIcon(session.state)}
        </span>
        <span className="font-data-mono text-[10px] text-on-surface truncate flex-1">
          {session.fbName}
        </span>
        <StatusBadge status={healthStatusToStatusValue(session.healthStatus)} size="sm" />
      </div>

      {/* Avatar / placeholder */}
      <div className="flex-1 flex items-center justify-center bg-surface-container-lowest min-h-[80px] relative">
        {session.profileUrl ? (
          <img
            src={session.profileUrl}
            alt={session.fbName}
            className="w-12 h-12 rounded-full object-cover border border-outline-variant"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-12 h-12 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center">
            <span className="material-symbols-outlined text-[24px] text-on-surface-variant">person</span>
          </div>
        )}

        {/* Hibernating overlay */}
        {isHibernating && (
          <div className="absolute inset-0 bg-surface-container-lowest/80 flex items-center justify-center">
            <span className="material-symbols-outlined text-[32px] text-on-surface-variant">bedtime</span>
          </div>
        )}
      </div>

      {/* Session meta */}
      <div className="px-2 py-1 border-t border-outline-variant">
        <div className="font-data-mono text-[9px] text-on-surface-variant truncate">
          UID: {session.uid || '—'}
        </div>
        <div className="font-data-mono text-[9px] text-on-surface-variant">
          {session.country} · {session.bmCount} BMs
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex border-t border-outline-variant">
        {isHibernating ? (
          <button
            onClick={() => onWake(session.id)}
            className="flex-1 h-7 flex items-center justify-center gap-1 text-[10px] font-data-mono text-[#3fb950] hover:bg-[#0d2a1a] transition-colors"
            title="Wake session"
          >
            <span className="material-symbols-outlined text-[12px]">wb_sunny</span>
            Wake
          </button>
        ) : (
          <button
            onClick={() => onHibernate(session.id)}
            disabled={!isActive}
            className="flex-1 h-7 flex items-center justify-center gap-1 text-[10px] font-data-mono text-on-surface-variant hover:bg-surface-container-high disabled:opacity-40 transition-colors"
            title="Hibernate session"
          >
            <span className="material-symbols-outlined text-[12px]">bedtime</span>
            Hibernate
          </button>
        )}
        <div className="w-px bg-outline-variant" />
        <button
          onClick={() => onClose(session.id)}
          className="flex-1 h-7 flex items-center justify-center gap-1 text-[10px] font-data-mono text-[#f85149] hover:bg-[#2a0d11] transition-colors"
          title="Close session"
        >
          <span className="material-symbols-outlined text-[12px]">close</span>
          Close
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// EMPTY TILE
// ─────────────────────────────────────────────

/**
 * Placeholder tile for empty grid slots.
 */
function EmptyTile() {
  return (
    <div className="bg-surface-container-lowest border border-dashed border-outline-variant rounded flex items-center justify-center min-h-[160px] opacity-40">
      <span className="material-symbols-outlined text-[24px] text-on-surface-variant">add_circle</span>
    </div>
  );
}

// ─────────────────────────────────────────────
// GRID VIEW
// ─────────────────────────────────────────────

/**
 * Grid View — displays live browser sessions as tiles in a configurable grid.
 * Polls GET /api/sessions every 3s for live session state.
 * Each tile shows: avatar, FB name, health badge, Hibernate/Wake/Close buttons.
 */
export function GridView() {
  const { sessions, fetchSessions, hibernateSession, wakeSession, closeSession, gridLayout } = useStore();

  const [cols, setCols] = useState(gridLayout?.cols ?? DEFAULT_COLS);
  const [rows, setRows] = useState(gridLayout?.rows ?? DEFAULT_ROWS);

  // ── Polling ──────────────────────────────────
  useEffect(() => {
    fetchSessions();
    const stop = startPolling(fetchSessions, GRID_POLL_INTERVAL_MS);
    return stop;
  }, [fetchSessions]);

  // Sync with settings when they load
  useEffect(() => {
    if (gridLayout) {
      setCols(gridLayout.cols);
      setRows(gridLayout.rows);
    }
  }, [gridLayout]);

  // ── Active sessions ──────────────────────────
  const activeSessions = sessions.filter(
    (s) => s.state === 'active' || s.state === 'launching' || s.state === 'hibernating'
  );

  // ── Grid slots ───────────────────────────────
  const totalSlots = cols * rows;
  const slots: Array<Session | null> = [
    ...activeSessions.slice(0, totalSlots),
    ...Array(Math.max(0, totalSlots - activeSessions.length)).fill(null),
  ];

  // ── Handlers ─────────────────────────────────
  const handleHibernate = useCallback(
    (id: string) => hibernateSession(id).catch(() => {}),
    [hibernateSession]
  );
  const handleWake = useCallback(
    (id: string) => wakeSession(id).catch(() => {}),
    [wakeSession]
  );
  const handleClose = useCallback(
    (id: string) => closeSession(id).catch(() => {}),
    [closeSession]
  );

  return (
    <div className="p-container_padding bg-background flex flex-col gap-3 h-full overflow-hidden">
      {/* Header */}
      <ContentCard padding="sm">
        <div className="flex items-center justify-between">
          <h1 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[18px]">grid_view</span>
            Grid View
          </h1>
          <div className="flex items-center gap-3">
            <span className="font-data-mono text-data-mono text-on-surface-variant">
              {activeSessions.length} active
            </span>

            {/* Grid size controls */}
            <div className="flex items-center gap-1.5 bg-surface-container-low border border-outline-variant rounded px-2 h-7">
              <span className="font-label-caps text-[9px] text-on-surface-variant uppercase">Cols</span>
              <button
                onClick={() => setCols((c) => Math.max(MIN_COLS, c - 1))}
                className="w-5 h-5 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">remove</span>
              </button>
              <span className="font-data-mono text-data-mono text-on-surface w-4 text-center">{cols}</span>
              <button
                onClick={() => setCols((c) => Math.min(MAX_COLS, c + 1))}
                className="w-5 h-5 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5 bg-surface-container-low border border-outline-variant rounded px-2 h-7">
              <span className="font-label-caps text-[9px] text-on-surface-variant uppercase">Rows</span>
              <button
                onClick={() => setRows((r) => Math.max(MIN_ROWS, r - 1))}
                className="w-5 h-5 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">remove</span>
              </button>
              <span className="font-data-mono text-data-mono text-on-surface w-4 text-center">{rows}</span>
              <button
                onClick={() => setRows((r) => Math.min(MAX_ROWS, r + 1))}
                className="w-5 h-5 flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
              </button>
            </div>
          </div>
        </div>
      </ContentCard>

      {/* Grid */}
      <div
        className="flex-1 overflow-y-auto"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gap: '4px',
          alignContent: 'start',
        }}
      >
        {slots.map((session, i) =>
          session ? (
            <SessionTile
              key={session.id}
              session={session}
              onHibernate={handleHibernate}
              onWake={handleWake}
              onClose={handleClose}
            />
          ) : (
            <EmptyTile key={`empty-${i}`} />
          )
        )}
      </div>

      {/* Footer status */}
      {activeSessions.length > totalSlots && (
        <ContentCard padding="sm">
          <p className="text-center font-body-sm text-[10px] text-on-surface-variant">
            {activeSessions.length - totalSlots} sessions not shown — increase grid size to see all
          </p>
        </ContentCard>
      )}
    </div>
  );
}
