'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useStore, startPolling } from '../../../../../../src/store';
import type { ParkedAsset, Session } from '../../../../../../src/types';
import { ContentCard } from '../../ui/ContentCard';
import { StatusBadge } from '../../ui/StatusBadge';
import { ProgressBar } from '../../ui/ProgressBar';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** How often to refresh the parked assets job table (ms). */
const JOB_POLL_INTERVAL_MS = 5_000;

/** Default BMs to create per worker. */
const DEFAULT_BMS_PER_WORKER = 2;

/** Minimum BMs per worker. */
const MIN_BMS_PER_WORKER = 1;

/** Maximum BMs per worker. */
const MAX_BMS_PER_WORKER = 10;

/** Default BM name template. */
const DEFAULT_NAME_TEMPLATE = 'AdOps {random} Media';

/** Health statuses that warrant a warning badge on worker selection. */
const WARN_HEALTH_STATUSES = new Set(['checkpoint', 'restricted']);

/** Health statuses that are completely unusable as workers. */
const DEAD_HEALTH_STATUSES = new Set(['banned', 'dead']);

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface BMJobRow {
  id: string;
  bmName: string;
  bmId: string;
  workerName: string;
  currentAdmin: string;
  adAccountSlots: number;
  restrictionStatus: string;
  transferStatus: string;
  createdAt: number;
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Maps a TransferStatus to Tailwind badge classes (light theme). */
function transferStatusClasses(status: string): string {
  switch (status) {
    case 'transferred': return 'bg-secondary/10 text-secondary border-secondary/30';
    case 'failed':      return 'bg-error/10 text-error border-error/30';
    default:            return 'bg-tertiary/10 text-tertiary border-tertiary/30';
  }
}

/** Maps a TransferStatus to a Material Symbol icon name. */
function transferStatusIcon(status: string): string {
  switch (status) {
    case 'transferred': return 'check_circle';
    case 'failed':      return 'error';
    default:            return 'hourglass_empty';
  }
}

/** Maps a HealthStatus to a color class for the worker list badge (light theme). */
function healthBadgeClasses(status: string): string {
  switch (status) {
    case 'live':        return 'text-secondary';
    case 'checkpoint':  return 'text-tertiary';
    case 'restricted':  return 'text-error';
    case 'warming':     return 'text-primary';
    default:            return 'text-error';
  }
}

/** Returns true if a session can be selected as a worker. */
function isUsableWorker(s: Session): boolean {
  return !DEAD_HEALTH_STATUSES.has(s.healthStatus);
}

// ─────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────

interface SearchableSessionListProps {
  sessions: Session[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  placeholder?: string;
  showBmCount?: boolean;
}

/**
 * Searchable, scrollable session list with health status indicators.
 * Used for both worker multi-select and parking account single-select.
 */
function SearchableSessionList({
  sessions,
  selectedIds,
  onToggle,
  placeholder = 'Search accounts...',
  showBmCount = false,
}: SearchableSessionListProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return q
      ? sessions.filter((s) => s.fbName.toLowerCase().includes(q) || s.uid.includes(q))
      : sessions;
  }, [sessions, query]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-2 pt-2 pb-1">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2 top-1/2 -translate-y-1/2 text-[14px] text-on-surface-variant pointer-events-none">
            search
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full h-7 ide-input pl-7 pr-2 font-data-mono text-[11px] rounded"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2 scrollbar-hide">
        {filtered.length === 0 && (
          <div className="py-4 text-center text-on-surface-variant font-body-sm text-body-sm text-[11px]">
            {query ? 'No matches' : 'No sessions available'}
          </div>
        )}
        {filtered.map((s) => {
          const isSelected = selectedIds.has(s.id);
          const isWarning = WARN_HEALTH_STATUSES.has(s.healthStatus);
          return (
            <label
              key={s.id}
              className={`flex items-center gap-2 px-2 py-1.5 border transition-colors cursor-pointer rounded-sm group mb-0.5 ${
                isSelected
                  ? 'bg-surface-container-highest border-outline-variant'
                  : 'border-transparent hover:bg-surface-container-highest hover:border-outline-variant'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggle(s.id)}
                className="w-3.5 h-3.5 bg-surface-container-lowest border-outline-variant rounded-sm text-primary focus:ring-0 shrink-0"
              />
              <div className="flex-1 flex justify-between items-center min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-data-mono text-data-mono text-on-surface group-hover:text-primary transition-colors truncate text-[11px]">
                    {s.fbName}
                  </span>
                  {isWarning && (
                    <span
                      className="material-symbols-outlined text-[12px] text-tertiary shrink-0"
                      title={`Account is ${s.healthStatus}`}
                    >
                      warning
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {showBmCount && (
                    <span className="text-[10px] text-on-surface-variant font-data-mono">
                      {s.bmCount} BMs
                    </span>
                  )}
                  <span className={`text-[9px] font-data-mono uppercase ${healthBadgeClasses(s.healthStatus)}`}>
                    {s.healthStatus}
                  </span>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────

/**
 * BM Factory View — creates Facebook Business Managers via worker accounts
 * and parks them on a designated parking account.
 *
 * Layout:
 *  1. Configuration panel — worker multi-select, parking account, per-worker config
 *  2. Real-time job table — polls /api/parked-assets?type=bm every 5s
 *  3. Job summary — totals for created / transferred / failed / skipped
 */
export function BMFactoryView() {
  const { sessions, parkedAssets, fetchParkedAssets } = useStore();

  // ── Config state ─────────────────────────────
  const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set());
  const [parkingId, setParkingId] = useState('');
  const [bmsPerWorker, setBmsPerWorker] = useState(DEFAULT_BMS_PER_WORKER);
  const [nameTemplate, setNameTemplate] = useState(DEFAULT_NAME_TEMPLATE);
  const [createAdAccount, setCreateAdAccount] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Polling ──────────────────────────────────
  useEffect(() => {
    void fetchParkedAssets('bm');
    return startPolling((): Promise<void> => fetchParkedAssets('bm').then(() => undefined), JOB_POLL_INTERVAL_MS);
  }, [fetchParkedAssets]);

  // ── Derived session lists ────────────────────
  const workerCandidates = useMemo(
    () => sessions.filter(isUsableWorker),
    [sessions]
  );

  const parkingCandidates = useMemo(
    () => sessions.filter((s) => s.healthStatus === 'live' && s.id !== parkingId && !selectedWorkers.has(s.id)),
    [sessions, parkingId, selectedWorkers]
  );

  // Parking account as a single-item set for the shared list component
  const parkingSet = useMemo(
    () => (parkingId ? new Set([parkingId]) : new Set<string>()),
    [parkingId]
  );

  // ── Derived job rows ─────────────────────────
  const jobRows: BMJobRow[] = useMemo(
    () =>
      parkedAssets
        .filter((a: ParkedAsset) => a.type === 'bm')
        .map((a: ParkedAsset) => {
          const worker = sessions.find((s) => s.id === a.creatorSessionId);
          const parking = sessions.find((s) => s.id === a.parkingSessionId);
          return {
            id: a.id,
            bmName: a.assetName,
            bmId: a.assetId,
            workerName: worker?.fbName ?? a.creatorSessionId.slice(0, 8),
            currentAdmin: parking?.fbName ?? a.parkingSessionId.slice(0, 8),
            adAccountSlots: 0, // populated by server when available
            restrictionStatus: 'Live',
            transferStatus: a.transferStatus,
            createdAt: a.createdAt,
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt),
    [parkedAssets, sessions]
  );

  // ── Job summary ──────────────────────────────
  const summary = useMemo(() => {
    const total = jobRows.length;
    const transferred = jobRows.filter((r) => r.transferStatus === 'transferred').length;
    const failed = jobRows.filter((r) => r.transferStatus === 'failed').length;
    const pending = jobRows.filter((r) => r.transferStatus === 'pending').length;
    return { total, transferred, failed, pending };
  }, [jobRows]);

  // ── Worker health warnings ───────────────────
  const warnedWorkers = useMemo(
    () =>
      Array.from(selectedWorkers).filter((id) => {
        const s = sessions.find((sess) => sess.id === id);
        return s && WARN_HEALTH_STATUSES.has(s.healthStatus);
      }),
    [selectedWorkers, sessions]
  );

  // ── Worker toggle ────────────────────────────
  const toggleWorker = useCallback((id: string) => {
    setSelectedWorkers((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
    // Clear parking if it was the toggled session
    setParkingId((prev) => (prev === id ? '' : prev));
  }, []);

  const toggleParking = useCallback(
    (id: string) => {
      setParkingId((prev) => (prev === id ? '' : id));
    },
    []
  );

  // ── Deploy ───────────────────────────────────
  const handleDeploy = async () => {
    if (selectedWorkers.size === 0 || !parkingId) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch('http://localhost:3001/api/tools/bm-factory/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerIds: Array.from(selectedWorkers),
          parkingId,
          config: {
            bmsPerWorker,
            nameTemplate,
            createAdAccount,
          },
        }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!data.success) {
        setError(data.error ?? 'Failed to start BM Factory job');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setRunning(false);
    }
  };

  const totalBMs = selectedWorkers.size * bmsPerWorker;
  const canDeploy = selectedWorkers.size > 0 && !!parkingId && !running;

  return (
    <div className="p-8 flex flex-col gap-6 h-full overflow-y-auto bg-background">

      {/* ── Header ── */}
      <ContentCard padding="sm">
        <div className="flex items-center justify-between">
          <h1 className="text-display font-semibold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[24px]">business</span>
            BM Factory
          </h1>
          <div className="flex items-center gap-3">
            <span className="font-data-mono text-data-mono text-on-surface-variant text-[11px]">
              <span className="material-symbols-outlined text-[12px] align-middle mr-0.5">schedule</span>
              60–180s between actions per worker
            </span>
            <span className="font-data-mono text-data-mono text-on-surface-variant">
              System: ONLINE | Sessions: {sessions.length}
            </span>
          </div>
        </div>
      </ContentCard>

      {/* ── Error banner ── */}
      {error && (
        <div className="px-3 py-2 bg-error/10 border border-error/30 rounded text-error font-body-sm text-body-sm flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[16px]">error</span>
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto material-symbols-outlined text-[14px] hover:opacity-70"
          >
            close
          </button>
        </div>
      )}

      {/* ── Worker health warnings ── */}
      {warnedWorkers.length > 0 && (
        <div className="px-3 py-2 bg-tertiary/10 border border-tertiary/30 rounded text-tertiary font-body-sm text-[11px] flex items-start gap-2 shrink-0">
          <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">warning</span>
          <span>
            {warnedWorkers.length} selected worker{warnedWorkers.length > 1 ? 's are' : ' is'} checkpoint/restricted.
            These accounts may fail BM creation and will be skipped automatically.
          </span>
        </div>
      )}

      {/* ── Configuration panel ── */}
      <div className="grid grid-cols-12 gap-6 shrink-0">

        {/* Worker Selection */}
        <ContentCard padding="sm" className="col-span-4 flex flex-col h-[440px] !p-0 overflow-hidden">
          <div className="h-8 border-b border-outline-variant flex items-center px-3 justify-between bg-surface-container shrink-0">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              Worker Accounts
            </span>
            <span className="font-data-mono text-data-mono text-primary text-[10px]">
              {selectedWorkers.size} Selected
            </span>
          </div>
          <SearchableSessionList
            sessions={workerCandidates}
            selectedIds={selectedWorkers}
            onToggle={toggleWorker}
            placeholder="Search workers..."
            showBmCount={false}
          />
        </ContentCard>

        {/* Parking Account */}
        <ContentCard padding="sm" className="col-span-3 flex flex-col h-[440px] !p-0 overflow-hidden">
          <div className="h-8 border-b border-outline-variant flex items-center px-3 justify-between bg-surface-container shrink-0">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              Parking Account
            </span>
            {parkingId && (
              <span className="font-data-mono text-data-mono text-secondary text-[10px]">1 Selected</span>
            )}
          </div>
          <SearchableSessionList
            sessions={sessions.filter((s) => !selectedWorkers.has(s.id))}
            selectedIds={parkingSet}
            onToggle={toggleParking}
            placeholder="Search parking..."
            showBmCount={true}
          />
        </ContentCard>

        {/* Config */}
        <ContentCard padding="sm" className="col-span-5 flex flex-col h-[440px] !p-0 overflow-hidden">
          <div className="h-8 border-b border-outline-variant flex items-center px-3 bg-surface-container shrink-0">
            <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
              Job Configuration
            </span>
          </div>

          <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto scrollbar-hide">

            {/* BMs per worker + total */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1">
                  BMs per Worker
                </label>
                <input
                  className="w-full h-8 ide-input px-2 font-data-mono text-data-mono rounded"
                  type="number"
                  min={MIN_BMS_PER_WORKER}
                  max={MAX_BMS_PER_WORKER}
                  value={bmsPerWorker}
                  onChange={(e) =>
                    setBmsPerWorker(
                      Math.min(MAX_BMS_PER_WORKER, Math.max(MIN_BMS_PER_WORKER, parseInt(e.target.value) || MIN_BMS_PER_WORKER))
                    )
                  }
                />
                <span className="text-[9px] text-on-surface-variant font-data-mono mt-0.5 block">
                  Range: {MIN_BMS_PER_WORKER}–{MAX_BMS_PER_WORKER}
                </span>
              </div>
              <div>
                <label className="block font-label-caps text-label-caps text-on-surface-variant mb-1">
                  Total BMs
                </label>
                <div className="w-full h-8 ide-input px-2 font-data-mono text-data-mono rounded flex items-center text-primary">
                  {totalBMs > 0 ? totalBMs : '—'}
                </div>
                <span className="text-[9px] text-on-surface-variant font-data-mono mt-0.5 block">
                  {selectedWorkers.size} workers × {bmsPerWorker}
                </span>
              </div>
            </div>

            {/* Name template */}
            <div>
              <div className="flex justify-between items-end mb-1">
                <label className="block font-label-caps text-label-caps text-on-surface-variant">
                  BM Naming Template
                </label>
                <span className="font-data-mono text-[9px] text-primary">
                  Supports {'{random}'}
                </span>
              </div>
              <input
                className="w-full h-8 ide-input px-2 font-data-mono text-data-mono text-primary rounded"
                type="text"
                value={nameTemplate}
                onChange={(e) => setNameTemplate(e.target.value)}
                placeholder="AdOps {random} Media"
              />
            </div>

            {/* Auto-create ad account toggle */}
            <div className="flex items-center justify-between p-3 bg-surface-container rounded-card border border-outline-variant">
              <div>
                <div className="font-label-caps text-label-caps text-on-surface">
                  Auto-Create Ad Account Slot
                </div>
                <div className="font-body-sm text-[10px] text-on-surface-variant mt-0.5">
                  Creates an ad account inside each new BM
                </div>
              </div>
              <button
                onClick={() => setCreateAdAccount((v) => !v)}
                aria-pressed={createAdAccount}
                aria-label="Toggle auto-create ad account"
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                  createAdAccount ? 'bg-primary-container' : 'bg-surface-container-high'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-on-surface transition-transform ${
                    createAdAccount ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>

            {/* Info callout */}
            <div className="p-3 bg-surface-container rounded-card border border-outline-variant flex gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0 mt-0.5">info</span>
              <p className="font-body-sm text-[10px] text-on-surface-variant leading-relaxed">
                Workers create BMs at business.facebook.com, then invite the parking account as Admin.
                The system polls for acceptance every 15s (max 10 min). Restricted workers are skipped automatically.
                A randomized delay of <strong className="text-on-surface">60–180s</strong> is applied between consecutive actions per worker.
              </p>
            </div>
          </div>

          {/* Deploy footer */}
          <div className="p-3 border-t border-outline-variant bg-surface-container-lowest flex justify-end gap-2 shrink-0">
            <button
              onClick={handleDeploy}
              disabled={!canDeploy}
              className="h-8 px-6 bg-primary-container text-on-primary font-semibold font-body-sm flex items-center gap-2 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-opacity"
            >
              <span className="material-symbols-outlined text-[16px]">rocket_launch</span>
              {running ? 'Deploying...' : `Deploy ${totalBMs > 0 ? totalBMs : ''} BMs`}
            </button>
          </div>
        </ContentCard>
      </div>

      {/* ── Job Summary ── */}
      {jobRows.length > 0 && (
        <div className="grid grid-cols-4 gap-6 shrink-0">
          {[
            { label: 'Total Created', value: summary.total, icon: 'business', color: 'text-on-surface' },
            { label: 'Transferred', value: summary.transferred, icon: 'check_circle', color: 'text-secondary' },
            { label: 'Failed', value: summary.failed, icon: 'error', color: 'text-error' },
            { label: 'Pending', value: summary.pending, icon: 'hourglass_empty', color: 'text-tertiary' },
          ].map(({ label, value, icon, color }) => (
            <ContentCard
              key={label}
              padding="sm"
              className="flex items-center gap-2"
            >
              <span className={`material-symbols-outlined text-[18px] ${color}`}>{icon}</span>
              <div>
                <div className={`font-data-mono text-[18px] font-bold leading-none ${color}`}>{value}</div>
                <div className="font-label-caps text-label-caps text-on-surface-variant text-[9px] mt-0.5 uppercase">
                  {label}
                </div>
              </div>
            </ContentCard>
          ))}
        </div>
      )}

      {/* ── Live Job Table ── */}
      <ContentCard padding="sm" className="flex-1 flex flex-col min-h-[200px] !p-0 overflow-hidden">
        <div className="h-8 border-b border-outline-variant flex items-center px-3 justify-between bg-surface-container shrink-0">
          <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">
            Live Job Progress
          </span>
          <span className="font-data-mono text-data-mono text-on-surface-variant text-[10px] flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse inline-block" />
            Auto-refresh 5s
          </span>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-left border-collapse whitespace-nowrap">
            <thead className="sticky top-0 bg-surface-container border-b border-outline-variant z-10">
              <tr>
                {[
                  'BM Name',
                  'BM ID',
                  'Creating Worker',
                  'Current Admin',
                  'Ad Account Slots',
                  'Restriction Status',
                  'Transfer Status',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-1 font-label-caps text-label-caps text-on-surface-variant"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-data-mono text-data-mono">
              {jobRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-on-surface-variant">
                    No BM jobs yet. Configure and deploy above.
                  </td>
                </tr>
              )}
              {jobRows.map((row) => (
                <tr
                  key={row.id}
                  className="h-[28px] border-b border-outline-variant hover:bg-surface-container-low transition-colors"
                >
                  <td className="px-3 py-1 text-on-surface">{row.bmName}</td>
                  <td className="px-3 py-1 text-on-surface-variant text-[10px]">
                    {row.bmId || '—'}
                  </td>
                  <td className="px-3 py-1 text-on-surface-variant">{row.workerName}</td>
                  <td className="px-3 py-1 text-on-surface-variant">{row.currentAdmin}</td>
                  <td className="px-3 py-1 text-center text-on-surface-variant">
                    {row.adAccountSlots > 0 ? row.adAccountSlots : '—'}
                  </td>
                  <td className="px-3 py-1">
                    <span className="text-[10px] text-on-surface-variant">
                      {row.restrictionStatus}
                    </span>
                  </td>
                  <td className="px-3 py-1">
                    <div
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border text-[9px] uppercase tracking-wider ${transferStatusClasses(row.transferStatus)}`}
                    >
                      <span className="material-symbols-outlined text-[10px]">
                        {transferStatusIcon(row.transferStatus)}
                      </span>
                      {row.transferStatus}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ContentCard>
    </div>
  );
}
