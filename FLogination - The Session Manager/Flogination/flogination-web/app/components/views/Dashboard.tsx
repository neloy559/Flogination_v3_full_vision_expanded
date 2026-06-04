'use client';
import { useEffect, useState, useCallback } from 'react';
import { useStore } from '../../../../../src/store';
import { ContentCard } from '../ui/ContentCard';
import { ProgressBar } from '../ui/ProgressBar';
import { StatusBadge } from '../ui/StatusBadge';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface SystemMemory {
  usedMb: number;
  totalMb: number;
  pct: number;
}

interface SystemHealth {
  cpu: {
    model: string;
    cores: number;
    usagePercent: number;
  };
  ram: {
    totalMB: number;
    usedMB: number;
    freeMB: number;
    usagePercent: number;
  };
  disk: {
    totalGB: number;
    freeGB: number;
    usagePercent: number;
  };
  instances: {
    currentActive: number;
    headlessNormal: number;
    headlessPressure: number;
    headlessRisk: number;
    headedNormal: number;
    headedPressure: number;
    headedRisk: number;
    status: 'healthy' | 'pressure' | 'risk' | 'critical';
  };
}

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Poll intervals in milliseconds — named constants per code style. */
const SESSION_POLL_MS        = 5_000;
const COUNTRY_POLL_MS        = 30_000;
const CAMPAIGN_POLL_MS       = 5_000;
/** Polling interval for the system health endpoint (CPU, RAM, Disk, instances). */
const SYSTEM_HEALTH_POLL_MS  = 10_000;
const LOGS_POLL_MS           = 15_000;
const LOGS_LIMIT             = 10;

/** Estimated RAM cost per headless browser instance (MB). */
const RAM_PER_HEADLESS_MB = 175;
/** Estimated RAM cost per headed browser instance (MB). */
const RAM_PER_HEADED_MB   = 350;

/** Campaign type → human-readable badge label. */
const CAMPAIGN_TYPE_LABELS: Record<string, string> = {
  group_hunter:      'Groups',
  comment_engine:    'Comments',
  page_factory:      'Pages',
  bm_factory:        'BM',
  content_amplifier: 'Content',
};

/**
 * Returns the Tailwind fill class for a resource usage bar.
 * Green below 65 %, yellow 65–84 %, red 85 %+.
 *
 * @param pct - Usage percentage (0–100).
 * @returns Tailwind background color class string.
 *
 * @example
 * getBarColor(50)  // → 'bg-[#3fb950]'
 * getBarColor(70)  // → 'bg-tertiary'
 * getBarColor(90)  // → 'bg-error'
 */
function getBarColor(pct: number): string {
  if (pct >= 85) return 'bg-error';
  if (pct >= 65) return 'bg-tertiary';
  return 'bg-[#3fb950]';
}

/** Maps instance status values to display icon, label, and Tailwind color class. */
const STATUS_CONFIG = {
  healthy:  { icon: '✅', label: 'System healthy',  color: 'text-[#3fb950]' },
  pressure: { icon: '⚠️', label: 'Memory pressure', color: 'text-tertiary'  },
  risk:     { icon: '🔴', label: 'High risk',        color: 'text-error'     },
  critical: { icon: '🚨', label: 'Critical',         color: 'text-error'     },
} as const satisfies Record<string, { icon: string; label: string; color: string }>;

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────

/**
 * Main Dashboard view — shows account health stats, session bank by country,
 * active campaigns, memory usage, and recent activity logs.
 *
 * All data is polled from the Express API via the Zustand store.
 * No external chart libraries — all visuals are pure CSS/Tailwind.
 */
export function Dashboard() {
  const {
    sessions,
    sessionsByCountry,
    campaigns,
    logs,
    fetchSessions,
    fetchByCountry,
    fetchCampaigns,
    fetchLogs,
    pauseCampaign,
    setView,
  } = useStore();

  const [health, setHealth] = useState<SystemHealth | null>(null);

  /**
   * Fetches system health metrics from the API.
   * On success, updates the health state. On failure, retains the last known state.
   */
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('http://localhost:3001/api/system/health');
      if (res.ok) {
        const data = await res.json() as SystemHealth;
        setHealth(data);
      }
      // On non-ok response, silently retain previous state
    } catch {
      // Server not ready or network error — silently retain last data
    }
  }, []);

  // ── Initial fetches + polling setup ───────
  useEffect(() => {
    // Immediate fetches on mount
    fetchSessions();
    fetchByCountry();
    fetchCampaigns();
    fetchLogs(undefined, LOGS_LIMIT);
    fetchHealth();

    // Polling intervals
    const t1 = setInterval(fetchSessions,  SESSION_POLL_MS);
    const t2 = setInterval(fetchByCountry, COUNTRY_POLL_MS);
    const t3 = setInterval(fetchCampaigns, CAMPAIGN_POLL_MS);
    const t4 = setInterval(fetchHealth,    SYSTEM_HEALTH_POLL_MS);
    const t5 = setInterval(() => fetchLogs(undefined, LOGS_LIMIT), LOGS_POLL_MS);

    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
      clearInterval(t4);
      clearInterval(t5);
    };
  }, []);

  // ── Derived stats ──────────────────────────
  const total      = sessions.length;
  const live       = sessions.filter(s => s.healthStatus === 'live').length;
  const checkpoint = sessions.filter(s => s.healthStatus === 'checkpoint').length;
  const restricted = sessions.filter(s => s.healthStatus === 'restricted').length;
  const dead       = sessions.filter(s => s.healthStatus === 'dead').length;
  const scraping   = sessions.filter(s => s.scrapingStatus === 'scraping').length;
  const failed     = sessions.filter(s => s.scrapingStatus === 'failed').length;

  const runningCampaigns = campaigns.filter(c => c.status === 'running');

  // ── Stat card definitions (4 cards per redesign spec) ──────────────────────
  const statCards = [
    { label: 'Total',      value: total,      color: 'text-primary',      icon: 'group',        dot: null },
    { label: 'Live',       value: live,       color: 'text-[#00b894]',    icon: 'check_circle', dot: 'bg-[#00b894] animate-pulse' },
    { label: 'Checkpoint', value: checkpoint, color: 'text-[#fdcb6e]',    icon: 'warning',      dot: 'bg-[#fdcb6e]' },
    { label: 'Dead',       value: dead,       color: 'text-error',        icon: 'cancel',       dot: 'bg-error' },
  ] as const;

  return (
    <div className="p-5 flex flex-col gap-4 overflow-y-auto h-full bg-background">

      {/* ── 2. STAT CARDS ROW ────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {statCards.map(stat => (
          <div
            key={stat.label}
            className="bg-surface-container-lowest border border-outline-variant rounded-xl p-4 flex flex-col gap-1 shadow-card cursor-pointer hover:border-primary/30 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-semibold text-outline uppercase tracking-widest">{stat.label}</span>
              {stat.dot && <span className={`w-2 h-2 rounded-full ${stat.dot}`} />}
            </div>
            <div className="flex items-end justify-between">
              <span className={`text-[26px] font-bold leading-none ${stat.color}`}>{stat.value.toLocaleString()}</span>
              <span className={`material-symbols-outlined text-[20px] ${stat.color} opacity-60`}>{stat.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* ── 3. MIDDLE ROW (Session Bank 60% + Active Campaigns 40%) ─ */}
      <div className="grid grid-cols-5 gap-4">

        {/* SESSION BANK BY COUNTRY — col-span-3 (60%) */}
        <ContentCard className="col-span-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold text-on-surface">Session Bank</h2>
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">language</span>
          </div>

          {sessionsByCountry.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-body-md text-on-surface-variant">No sessions yet</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {sessionsByCountry.map((row) => {
                const livePct  = row.total > 0 ? Math.round((row.live       / row.total) * 100) : 0;
                const cpPct    = row.total > 0 ? Math.round((row.checkpoint / row.total) * 100) : 0;
                const rstPct   = row.total > 0 ? Math.round((row.restricted / row.total) * 100) : 0;
                const deadPct  = row.total > 0 ? Math.round((row.dead       / row.total) * 100) : 0;
                // Health score: weight live sessions most heavily
                const healthPct = livePct;

                return (
                  <div
                    key={row.country}
                    className="flex items-center gap-3 hover:bg-surface-container rounded-button px-2 py-1.5 transition-colors cursor-pointer"
                    onClick={() => setView('accounts')}
                  >
                    {/* Flag + country */}
                    <div className="flex items-center gap-2 w-32 shrink-0">
                      <span className="text-[16px]">{row.flag}</span>
                      <span className="text-label-md text-on-surface truncate">{row.country}</span>
                    </div>
                    {/* Count */}
                    <span className="text-label-md font-semibold text-on-surface w-8 text-right shrink-0">{row.total}</span>
                    {/* Health bar */}
                    <div className="flex-1">
                      <ProgressBar value={healthPct} />
                    </div>
                    {/* Action */}
                    <button className="text-on-surface-variant hover:text-on-surface transition-colors shrink-0">
                      <span className="material-symbols-outlined text-[16px]">more_vert</span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </ContentCard>

        {/* ACTIVE CAMPAIGNS — col-span-2 (40%) */}
        <ContentCard className="col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold text-on-surface">Active Campaigns</h2>
            <button
              onClick={() => setView('campaigns')}
              className="text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-[18px]">open_in_new</span>
            </button>
          </div>

          {runningCampaigns.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-body-md text-on-surface-variant">No running campaigns</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {runningCampaigns.map(c => {
                // Parse progress from campaign config blob
                let progressPct   = 0;
                let progressLabel = 'Running';
                try {
                  const cfg = JSON.parse(c.config ?? '{}') as {
                    progress?: { pct?: number; done?: number; total?: number };
                  };
                  if (cfg.progress?.pct !== undefined) {
                    progressPct   = cfg.progress.pct;
                    progressLabel = `${cfg.progress.done ?? 0}/${cfg.progress.total ?? '?'}`;
                  }
                } catch {
                  // Config not parseable — use indeterminate
                }

                const typeLabel = CAMPAIGN_TYPE_LABELS[c.type] ?? c.type;

                return (
                  <div key={c.id} className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-label-md text-on-surface truncate">{c.name}</span>
                        <StatusBadge status="running" size="sm" />
                      </div>
                      <button
                        onClick={() => pauseCampaign(c.id)}
                        title="Pause campaign"
                        className="text-on-surface-variant hover:text-tertiary transition-colors shrink-0 ml-2"
                      >
                        <span className="material-symbols-outlined text-[16px]">pause</span>
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <ProgressBar value={progressPct} />
                      </div>
                      <span className="text-label-sm text-on-surface-variant shrink-0">{progressLabel}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ContentCard>
      </div>

      {/* ── 4. BOTTOM ROW (Device Capacity 50% + Recent Logs 50%) ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* DEVICE CAPACITY */}
        <ContentCard>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold text-on-surface">Device Capacity</h2>
            <span className="material-symbols-outlined text-[18px] text-tertiary">memory</span>
          </div>

          {/* Device specs */}
          <p className="text-label-sm text-on-surface-variant mb-3 truncate">
            {health
              ? `${health.cpu.model} · ${health.cpu.cores} cores · ${Math.round(health.ram.totalMB / 1024)}GB RAM`
              : '— · — cores · —GB RAM'
            }
          </p>

          {/* Resource bars */}
          <div className="flex flex-col gap-3 mb-3">
            {/* CPU */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-label-md text-on-surface-variant">CPU</span>
                <span className="text-label-sm text-on-surface-variant">
                  {health ? `${health.cpu.usagePercent}%` : '--'}
                </span>
              </div>
              <ProgressBar value={health?.cpu.usagePercent ?? 0} />
            </div>

            {/* RAM */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-label-md text-on-surface-variant">RAM</span>
                <span className="text-label-sm text-on-surface-variant">
                  {health
                    ? `${health.ram.usagePercent}% · ${(health.ram.usedMB / 1024).toFixed(1)}/${(health.ram.totalMB / 1024).toFixed(0)} GB`
                    : '--'
                  }
                </span>
              </div>
              <ProgressBar value={health?.ram.usagePercent ?? 0} />
            </div>

            {/* Disk */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-label-md text-on-surface-variant">Disk</span>
                <span className="text-label-sm text-on-surface-variant">
                  {health
                    ? `${health.disk.usagePercent}% · ${health.disk.freeGB} GB free`
                    : '--'
                  }
                </span>
              </div>
              <ProgressBar value={health?.disk.usagePercent ?? 0} />
            </div>
          </div>

          {/* Instance Load Analysis */}
          <div className="border-t border-outline-variant pt-4">
            <p className="text-label-md font-semibold text-on-surface mb-3">Instance Load Analysis</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-surface-container rounded-button p-2">
                <div className="text-label-sm text-[#3fb950] font-semibold">Normal</div>
                <div className="text-headline-md font-semibold text-on-surface">
                  {health ? health.instances.headlessNormal : '--'}
                </div>
                <div className="text-label-sm text-on-surface-variant">headless</div>
              </div>
              <div className="bg-surface-container rounded-button p-2">
                <div className="text-label-sm text-tertiary font-semibold">Pressure</div>
                <div className="text-headline-md font-semibold text-on-surface">
                  {health ? health.instances.headlessPressure : '--'}
                </div>
                <div className="text-label-sm text-on-surface-variant">headless</div>
              </div>
              <div className="bg-surface-container rounded-button p-2">
                <div className="text-label-sm text-error font-semibold">Risk</div>
                <div className="text-headline-md font-semibold text-on-surface">
                  {health ? health.instances.headlessRisk : '--'}
                </div>
                <div className="text-label-sm text-on-surface-variant">headless</div>
              </div>
            </div>

            {/* Status row */}
            <div className="flex items-center gap-2 mt-3">
              <span className="text-label-sm text-on-surface-variant">
                ● {health ? health.instances.currentActive : '—'} running
              </span>
              {health ? (
                <span className={`text-label-sm ${STATUS_CONFIG[health.instances.status].color}`}>
                  | {STATUS_CONFIG[health.instances.status].icon} {STATUS_CONFIG[health.instances.status].label}
                </span>
              ) : (
                <span className="text-label-sm text-on-surface-variant">| — System status</span>
              )}
            </div>

            {/* Settings link */}
            <button
              onClick={() => setView('settings')}
              className="text-label-sm text-on-surface-variant hover:text-on-surface transition-colors mt-1 text-left"
            >
              Max parallel: {health ? health.instances.headlessNormal : '—'} → Change in Settings
            </button>
          </div>
        </ContentCard>

        {/* RECENT LOGS */}
        <ContentCard>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold text-on-surface">Recent Logs</h2>
            <div className="flex items-center gap-2">
              <span className="text-label-sm text-on-surface-variant">last {LOGS_LIMIT}</span>
              <button
                onClick={() => setView('logs')}
                className="text-on-surface-variant hover:text-on-surface transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">open_in_full</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            {logs.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <span className="text-body-md text-on-surface-variant">No activity yet</span>
              </div>
            )}
            {logs.map(log => {
              const isError = log.action?.toLowerCase().includes('error') || log.action?.toLowerCase().includes('fail');
              return (
                <div
                  key={log.id}
                  className={`flex items-start gap-3 py-2 rounded-button hover:bg-surface-container transition-colors ${isError ? 'border-l-4 border-l-red-500 pl-3' : 'px-2'}`}
                >
                  {/* Level badge */}
                  <div className="shrink-0 mt-0.5">
                    {isError
                      ? <StatusBadge status="failed" size="sm" />
                      : <StatusBadge status="running" size="sm" />
                    }
                  </div>
                  {/* Message */}
                  <div className="flex-1 min-w-0">
                    <p className="text-label-md text-on-surface truncate">
                      {log.action.replace(/_/g, ' ')}
                    </p>
                    <p className="text-label-sm text-on-surface-variant truncate">{log.details}</p>
                  </div>
                  {/* Timestamp */}
                  <span className="text-label-sm text-on-surface-variant shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              );
            })}
          </div>
        </ContentCard>
      </div>

      {/* ── 5. FLOATING ACTION BUTTON ────────────────────────────── */}
      <button className="fixed bottom-8 right-8 w-14 h-14 rounded-full bg-primary-container text-on-primary shadow-elevated flex items-center justify-center hover:opacity-90 transition-opacity z-50">
        <span className="material-symbols-outlined text-[24px]">add</span>
      </button>

    </div>
  );
}
