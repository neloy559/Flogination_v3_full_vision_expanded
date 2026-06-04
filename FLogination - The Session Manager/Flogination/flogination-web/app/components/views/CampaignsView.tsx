'use client';
import React, { useEffect, useState, useRef } from 'react';
import { useStore } from '../../../../../src/store';
import type { Campaign, CampaignTask, CampaignType, CampaignStatus } from '../../../../../src/types';
import { ContentCard } from '../ui/ContentCard';
import { ProgressBar } from '../ui/ProgressBar';
import { StatusBadge } from '../ui/StatusBadge';
import type { StatusValue } from '../ui/StatusBadge';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Poll interval while any campaign is running. */
const RUNNING_POLL_INTERVAL_MS = 5_000;

/** Tasks shown per page in the detail panel. */
const TASKS_PER_PAGE = 20;

// ─────────────────────────────────────────────
// TYPE BADGE (maps CampaignType → display label)
// ─────────────────────────────────────────────

const TYPE_LABELS: Record<CampaignType, string> = {
  group_hunter:      'Group Hunter',
  comment_engine:    'Comment Engine',
  page_factory:      'Page Factory',
  bm_factory:        'BM Factory',
  content_amplifier: 'Content Amplifier',
};

/**
 * Maps a CampaignType to a display label with a neutral pill style.
 * Uses inline styling to keep it visually distinct from status badges.
 */
function TypeBadge({ type }: { type: CampaignType }) {
  return (
    <span
      className="inline-flex items-center px-[10px] py-[3px] rounded-badge text-label-sm font-semibold whitespace-nowrap"
      style={{ backgroundColor: '#5341cd15', color: '#5341cd' }}
    >
      {TYPE_LABELS[type] ?? type}
    </span>
  );
}

// ─────────────────────────────────────────────
// STATUS BADGE ADAPTER
// Maps CampaignStatus → StatusValue for StatusBadge
// ─────────────────────────────────────────────

/**
 * Maps a CampaignStatus string to a StatusValue accepted by StatusBadge.
 * 'cancelled' and 'completed' are not in StatusValue, so we map them.
 */
function toCampaignStatusValue(status: CampaignStatus): StatusValue {
  switch (status) {
    case 'running':   return 'running';
    case 'paused':    return 'paused';
    case 'failed':    return 'failed';
    case 'draft':     return 'draft';
    case 'completed': return 'complete';
    case 'cancelled': return 'idle';
    default:          return 'idle';
  }
}

// ─────────────────────────────────────────────
// DETAIL PANEL ERROR BOUNDARY
// Wraps DetailPanel so table stays functional if panel fails
// ─────────────────────────────────────────────

class DetailPanelErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

// ─────────────────────────────────────────────
// DETAIL PANEL
// ─────────────────────────────────────────────

interface DetailPanelProps {
  campaign: Campaign;
  tasks: CampaignTask[];
  onClose: () => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string) => void;
}

/**
 * Slide-in side panel showing campaign task list and overall progress.
 * Rendered fixed on the right side of the viewport.
 */
function DetailPanel({ campaign, tasks, onClose, onPause, onResume, onCancel }: DetailPanelProps) {
  const [taskPage, setTaskPage] = useState(0);

  const doneTasks  = tasks.filter(t => t.status === 'done').length;
  const totalTasks = tasks.length;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const pagedTasks = tasks.slice(taskPage * TASKS_PER_PAGE, (taskPage + 1) * TASKS_PER_PAGE);
  const totalPages = Math.max(1, Math.ceil(totalTasks / TASKS_PER_PAGE));

  return (
    <div className="w-96 bg-surface-container-lowest border-l border-outline-variant shadow-elevated flex flex-col h-full overflow-hidden">

      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant flex-shrink-0">
        <div className="min-w-0 flex-1 mr-3">
          <h2 className="text-headline-md font-semibold text-on-surface truncate">{campaign.name}</h2>
          <div className="flex items-center gap-2 mt-1">
            <TypeBadge type={campaign.type} />
            <StatusBadge status={toCampaignStatusValue(campaign.status)} size="sm" />
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-on-surface-variant hover:text-on-surface transition-colors flex-shrink-0"
          aria-label="Close detail panel"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      {/* Overall progress */}
      <div className="px-5 py-4 border-b border-outline-variant flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-label-md text-on-surface-variant">Overall Progress</span>
          <span className="text-label-md font-semibold text-on-surface">{progressPct}%</span>
        </div>
        <ProgressBar value={progressPct} />
        <div className="flex items-center justify-between mt-2">
          <span className="text-label-sm text-on-surface-variant">{doneTasks} / {totalTasks} tasks done</span>
        </div>
      </div>

      {/* Campaign actions */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-outline-variant flex-shrink-0">
        {campaign.status === 'running' && (
          <button
            onClick={() => onPause(campaign.id)}
            className="flex items-center gap-1.5 text-label-md text-on-surface-variant hover:text-on-surface transition-colors px-3 py-1.5 rounded-button hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[16px]">pause</span>
            Pause
          </button>
        )}
        {campaign.status === 'paused' && (
          <button
            onClick={() => onResume(campaign.id)}
            className="flex items-center gap-1.5 text-label-md text-on-surface-variant hover:text-on-surface transition-colors px-3 py-1.5 rounded-button hover:bg-surface-container"
          >
            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
            Resume
          </button>
        )}
        {(campaign.status === 'running' || campaign.status === 'paused') && (
          <button
            onClick={() => onCancel(campaign.id)}
            className="flex items-center gap-1.5 text-label-md text-error hover:opacity-80 transition-opacity px-3 py-1.5 rounded-button hover:bg-error/5"
          >
            <span className="material-symbols-outlined text-[16px]">stop</span>
            Cancel
          </button>
        )}
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {pagedTasks.length === 0 ? (
          <div className="py-10 text-center text-on-surface-variant text-body-md">
            No tasks found
          </div>
        ) : (
          <div className="divide-y divide-outline-variant">
            {pagedTasks.map(task => (
              <div key={task.id} className="px-5 py-3 flex items-start gap-3 hover:bg-surface-container-low transition-colors">
                {/* Status dot */}
                <span
                  className="mt-0.5 flex-shrink-0 w-2 h-2 rounded-full"
                  style={{
                    backgroundColor:
                      task.status === 'done'    ? '#00b894' :
                      task.status === 'running' ? '#5341cd' :
                      task.status === 'failed'  ? '#e17055' :
                      task.status === 'skipped' ? '#fdcb6e' :
                      '#c8c4d7',
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-body-md text-on-surface truncate">{task.action}</p>
                  <p className="text-label-sm text-on-surface-variant mt-0.5 capitalize">{task.status}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-outline-variant flex-shrink-0">
          <button
            onClick={() => setTaskPage(p => Math.max(0, p - 1))}
            disabled={taskPage === 0}
            className="text-label-sm text-on-surface-variant hover:text-on-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <span className="text-label-sm text-on-surface-variant">
            {taskPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setTaskPage(p => Math.min(totalPages - 1, p + 1))}
            disabled={taskPage >= totalPages - 1}
            className="text-label-sm text-on-surface-variant hover:text-on-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN VIEW
// ─────────────────────────────────────────────

/**
 * Campaigns view — filterable table of automation campaigns with a
 * click-to-detail side panel. Polls every 5 s while any campaign is running.
 */
export function CampaignsView() {
  const {
    campaigns,
    campaignTasks,
    selectedCampaignId,
    fetchCampaigns,
    pauseCampaign,
    resumeCampaign,
    cancelCampaign,
    deleteCampaign,
    setSelectedCampaign,
    fetchCampaignTasks,
  } = useStore();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [typeFilter, setTypeFilter]     = useState<CampaignType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | 'all'>('all');

  // ── Polling ───────────────────────────────────────────────────────────────
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetchCampaigns();
  }, []);

  useEffect(() => {
    const hasRunning = campaigns.some(c => c.status === 'running');
    if (hasRunning) {
      pollRef.current = setInterval(fetchCampaigns, RUNNING_POLL_INTERVAL_MS);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [campaigns]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const filtered = campaigns.filter(c => {
    if (typeFilter   !== 'all' && c.type   !== typeFilter)   return false;
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    return true;
  });

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId) ?? null;

  // ── Row click handler ─────────────────────────────────────────────────────
  const handleRowClick = async (campaign: Campaign) => {
    if (selectedCampaignId === campaign.id) {
      setSelectedCampaign(null);
      return;
    }
    setSelectedCampaign(campaign.id);
    await fetchCampaignTasks(campaign.id);
  };

  // ── Action handlers ───────────────────────────────────────────────────────
  const handlePause  = async (id: string) => { await pauseCampaign(id);  };
  const handleResume = async (id: string) => { await resumeCampaign(id); };
  const handleCancel = async (id: string) => { await cancelCampaign(id); };
  const handleDelete = async (id: string) => {
    if (selectedCampaignId === id) setSelectedCampaign(null);
    await deleteCampaign(id);
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <ContentCard className="m-6 mb-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-display font-semibold text-on-surface">Campaigns</h1>
            <p className="text-body-md text-on-surface-variant mt-1">Manage automation campaigns</p>
          </div>
          <button className="bg-primary-container text-on-primary rounded-button px-5 py-[10px] text-body-md font-medium hover:opacity-90 transition-opacity flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">add</span>
            New Campaign
          </button>
        </div>
      </ContentCard>

      {/* ── Filter Bar ──────────────────────────────────────────────────── */}
      <div className="px-6 pt-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Type filter */}
          <div className="flex items-center gap-1">
            <span className="text-label-sm text-on-surface-variant mr-1">Type:</span>
            {(['all', 'group_hunter', 'comment_engine', 'page_factory', 'bm_factory', 'content_amplifier'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-badge text-label-sm font-medium transition-colors ${
                  typeFilter === t
                    ? 'bg-primary-container text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {t === 'all' ? 'All Types' : TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div className="w-px h-5 bg-outline-variant" />

          {/* Status filter */}
          <div className="flex items-center gap-1">
            <span className="text-label-sm text-on-surface-variant mr-1">Status:</span>
            {(['all', 'running', 'paused', 'completed', 'failed', 'draft'] as const).map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-badge text-label-sm font-medium transition-colors ${
                  statusFilter === s
                    ? 'bg-primary-container text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {s === 'all' ? 'All Statuses' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {/* Result count */}
          <span className="ml-auto text-label-sm text-on-surface-variant">
            {filtered.length} campaign{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* ── Main content area (table + optional detail panel) ───────────── */}
      <div className="flex flex-1 overflow-hidden mx-6 mb-6 mt-4 gap-0">

        {/* Campaigns Table */}
        <ContentCard className="flex-1 overflow-hidden !p-0">

          {/* Rows */}
          <div className="p-3 flex flex-col overflow-y-auto" style={{ maxHeight: 'calc(100% - 44px)' }}>
            {filtered.length === 0 && (
              <div className="py-16 text-center text-on-surface-variant text-body-md">
                {campaigns.length === 0 ? 'No campaigns yet' : 'No campaigns match the current filters'}
              </div>
            )}
            {filtered.map(c => (
              <div
                key={c.id}
                onClick={() => handleRowClick(c)}
                className={`card-row grid grid-cols-[2fr_1.2fr_1fr_1.5fr_1fr] items-center cursor-pointer group ${
                  selectedCampaignId === c.id ? 'selected' : ''
                }`}
              >
                {/* Campaign Name */}
                <div className="px-4 py-3">
                  <p className="text-body-md font-medium text-on-surface truncate">{c.name}</p>
                  <p className="text-label-sm text-on-surface-variant mt-0.5 font-mono">{c.id.slice(0, 8)}…</p>
                </div>

                {/* Type Badge */}
                <div className="px-4 py-3">
                  <TypeBadge type={c.type} />
                </div>

                {/* Status Badge */}
                <div className="px-4 py-3">
                  <StatusBadge status={toCampaignStatusValue(c.status)} size="sm" />
                </div>

                {/* Progress Bar */}
                <div className="px-4 py-3">
                  <ProgressBar
                    value={
                      c.status === 'completed' ? 100 :
                      c.status === 'running'   ? 50  :
                      c.status === 'failed'    ? 80  :
                      0
                    }
                  />
                </div>

                {/* Actions */}
                <div
                  className="px-4 py-3 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={e => e.stopPropagation()}
                >
                  {c.status === 'running' && (
                    <button
                      onClick={() => handlePause(c.id)}
                      className="text-on-surface-variant hover:text-primary transition-colors p-1 rounded"
                      title="Pause campaign"
                    >
                      <span className="material-symbols-outlined text-[18px]">pause</span>
                    </button>
                  )}
                  {c.status === 'paused' && (
                    <button
                      onClick={() => handleResume(c.id)}
                      className="text-on-surface-variant hover:text-primary transition-colors p-1 rounded"
                      title="Resume campaign"
                    >
                      <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                    </button>
                  )}
                  {(c.status === 'running' || c.status === 'paused') && (
                    <button
                      onClick={() => handleCancel(c.id)}
                      className="text-on-surface-variant hover:text-error transition-colors p-1 rounded"
                      title="Cancel campaign"
                    >
                      <span className="material-symbols-outlined text-[18px]">stop</span>
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="text-on-surface-variant hover:text-error transition-colors p-1 rounded"
                    title="Delete campaign"
                  >
                    <span className="material-symbols-outlined text-[18px]">delete</span>
                  </button>
                  <button
                    className="text-on-surface-variant hover:text-on-surface transition-colors p-1 rounded"
                    title="More actions"
                  >
                    <span className="material-symbols-outlined text-[18px]">more_vert</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </ContentCard>

        {/* ── Detail Side Panel ──────────────────────────────────────────── */}
        {selectedCampaign && (
          <DetailPanelErrorBoundary>
            <DetailPanel
              campaign={selectedCampaign}
              tasks={campaignTasks}
              onClose={() => setSelectedCampaign(null)}
              onPause={handlePause}
              onResume={handleResume}
              onCancel={handleCancel}
            />
          </DetailPanelErrorBoundary>
        )}
      </div>
    </div>
  );
}
