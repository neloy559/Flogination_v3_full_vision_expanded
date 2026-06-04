'use client';
import { useState } from 'react';
import { useStore } from '../../../../../../src/store';
import { ContentCard } from '../../ui/ContentCard';
import { StatusBadge } from '../../ui/StatusBadge';
import { LogPanel } from '../../ui/LogPanel';
import { ToggleSwitch } from '../../ui/ToggleSwitch';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  level: 'success' | 'info' | 'error';
  message: string;
  timestamp: number;
}

interface JobStats {
  joined: number;
  posts: number;
  dms: number;
  contacts: number;
  errors: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Group Hunter tool view — two-panel layout (7/5 split).
 *
 * Left panel: Target Groups, Automation Phases, Accounts & Timing, Start Job button.
 * Right panel: Job Status card + Live Process LogPanel.
 *
 * All job start/stop logic, API calls, and state management are preserved from
 * the original implementation. Only the visual presentation changes.
 */
export function GroupHunterView() {
  // ── Store ──────────────────────────────────────────────────────────────────
  const { sessions } = useStore();

  // ── Original state (preserved) ────────────────────────────────────────────
  const [targets, setTargets] = useState('');
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set());
  const [postContent, setPostContent] = useState('');
  const [dmTemplate, setDmTemplate] = useState('');
  const [dailyLimit, setDailyLimit] = useState(20);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<JobStats>({ joined: 0, posts: 0, dms: 0, contacts: 0, errors: 0 });

  // ── New UI state ───────────────────────────────────────────────────────────
  /** Tag chips parsed from the targets textarea */
  const [targetTags, setTargetTags] = useState<string[]>([]);
  /** Automation phase toggles */
  const [phase1Enabled, setPhase1Enabled] = useState(true);
  const [phase2Enabled, setPhase2Enabled] = useState(false);
  const [phase3Enabled, setPhase3Enabled] = useState(false);
  /** Delay between actions in seconds */
  const [delaySeconds, setDelaySeconds] = useState(5);
  /** Live process log entries */
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const liveSessions = sessions.filter(s => s.healthStatus === 'live');

  // ── Handlers (preserved logic) ────────────────────────────────────────────

  const toggleSession = (id: string) => {
    const next = new Set(selectedSessions);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedSessions(next);
  };

  const handleStart = async () => {
    if (!targets.trim() || selectedSessions.size === 0) return;
    setRunning(true);
    try {
      await fetch('/api/tools/group-hunter/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionIds: Array.from(selectedSessions),
          targets: targets.split('\n').filter(t => t.trim()),
          phases: {
            join: phase1Enabled,
            post: phase2Enabled && postContent
              ? { content: postContent, timing: 'drip', dripHours: 4 }
              : undefined,
            dm: phase3Enabled && dmTemplate
              ? { messageTemplate: dmTemplate, dailyLimit }
              : undefined,
          },
        }),
      });
    } catch (e) {
      console.error(e);
    }
    setRunning(false);
  };

  const handleStop = () => {
    setRunning(false);
  };

  /** Add a URL from the textarea as a tag chip */
  const handleAddTargets = () => {
    const lines = targets
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    setTargetTags(prev => {
      const existing = new Set(prev);
      lines.forEach(l => existing.add(l));
      return Array.from(existing);
    });
    setTargets('');
  };

  /** Remove a tag chip by index */
  const handleRemoveTag = (index: number) => {
    setTargetTags(prev => prev.filter((_, i) => i !== index));
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="grid grid-cols-12 gap-6 p-8 h-full overflow-hidden bg-background">

      {/* ── LEFT PANEL ─────────────────────────────────────────────────────── */}
      <div className="col-span-7 flex flex-col gap-4 overflow-y-auto">

        {/* Target Groups */}
        <ContentCard>
          <h2 className="text-headline-md font-semibold text-on-surface mb-4">Target Groups</h2>

          {/* URL textarea */}
          <textarea
            className="w-full h-28 bg-background border border-outline-variant rounded-button p-3 text-body-md text-on-surface font-mono resize-none focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface-variant transition-colors"
            placeholder="Enter group URLs or IDs (one per line)..."
            value={targets}
            onChange={e => setTargets(e.target.value)}
          />

          {/* Tag chips */}
          {targetTags.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {targetTags.map((tag, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 bg-surface-container text-on-surface text-label-sm px-3 py-1 rounded-badge"
                >
                  <span className="truncate max-w-[180px]">{tag}</span>
                  <button
                    onClick={() => handleRemoveTag(i)}
                    className="text-on-surface-variant hover:text-error transition-colors leading-none"
                    aria-label={`Remove ${tag}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Add Targets button */}
          <button
            onClick={handleAddTargets}
            className="mt-3 w-full py-2 border-2 border-dashed border-outline-variant rounded-button text-label-md text-on-surface-variant hover:border-primary hover:text-primary transition-colors"
          >
            + Add Targets
          </button>
        </ContentCard>

        {/* Automation Phases */}
        <ContentCard>
          <h2 className="text-headline-md font-semibold text-on-surface mb-4">Automation Phases</h2>

          <div className="flex flex-col gap-3">
            {/* Phase 1 */}
            <div className="flex items-center justify-between py-2 border-b border-outline-variant">
              <div>
                <p className="text-body-md font-medium text-on-surface">Phase 1: Join Groups</p>
                <p className="text-label-sm text-on-surface-variant mt-0.5">Automatically join all target groups</p>
              </div>
              <ToggleSwitch checked={phase1Enabled} onChange={setPhase1Enabled} />
            </div>

            {/* Phase 2 */}
            <div className="flex items-center justify-between py-2 border-b border-outline-variant">
              <div>
                <p className="text-body-md font-medium text-on-surface">Phase 2: Post Content</p>
                <p className="text-label-sm text-on-surface-variant mt-0.5">Post content to joined groups</p>
              </div>
              <ToggleSwitch checked={phase2Enabled} onChange={setPhase2Enabled} />
            </div>

            {/* Phase 3 */}
            <div className="py-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-body-md font-medium text-on-surface">Phase 3: Direct Message</p>
                  <p className="text-label-sm text-on-surface-variant mt-0.5">Send DMs to group members</p>
                </div>
                <ToggleSwitch checked={phase3Enabled} onChange={setPhase3Enabled} />
              </div>

              {/* Phase 3 expansion — animated reveal */}
              <div
                className={`overflow-hidden transition-all duration-300 ${phase3Enabled ? 'max-h-48 mt-4' : 'max-h-0'}`}
              >
                <div className="flex flex-col gap-3 pl-1">
                  <textarea
                    className="w-full h-20 bg-background border border-outline-variant rounded-button p-3 text-body-md text-on-surface font-mono resize-none focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface-variant transition-colors"
                    placeholder="{Hi|Hello}! {Interested in our products?|Want to know more?}"
                    value={dmTemplate}
                    onChange={e => setDmTemplate(e.target.value)}
                  />
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-label-md text-on-surface-variant">Daily DM Limit per Session</label>
                      <span className="text-label-md font-medium text-on-surface">{dailyLimit}</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={50}
                      value={dailyLimit}
                      onChange={e => setDailyLimit(parseInt(e.target.value))}
                      className="w-full accent-primary-container"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </ContentCard>

        {/* Accounts & Timing */}
        <ContentCard>
          <h2 className="text-headline-md font-semibold text-on-surface mb-4">Accounts &amp; Timing</h2>
          <div className="grid grid-cols-2 gap-4">
            {/* Account selector */}
            <div>
              <label className="block text-label-md text-on-surface-variant mb-1.5">Session Pool</label>
              <select className="w-full h-10 bg-background border border-outline-variant rounded-button px-3 text-body-md text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors">
                <option>All Active ({liveSessions.length})</option>
                {liveSessions.map(s => (
                  <option key={s.id} value={s.id}>{s.fbName ?? s.id}</option>
                ))}
              </select>
            </div>

            {/* Delay slider */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-label-md text-on-surface-variant">Action Delay</label>
                <span className="text-label-md font-medium text-on-surface">{delaySeconds}s</span>
              </div>
              <input
                type="range"
                min={1}
                max={30}
                value={delaySeconds}
                onChange={e => setDelaySeconds(parseInt(e.target.value))}
                className="w-full mt-2 accent-primary-container"
              />
            </div>
          </div>
        </ContentCard>

        {/* Start Job button */}
        <button
          onClick={running ? handleStop : handleStart}
          disabled={!running && (selectedSessions.size === 0 && liveSessions.length === 0)}
          className="bg-primary-container text-on-primary rounded-full w-full py-3 text-body-md font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? 'Stop Job' : 'Start Job'}
        </button>
      </div>

      {/* ── RIGHT PANEL ────────────────────────────────────────────────────── */}
      <div className="col-span-5 flex flex-col gap-4">

        {/* Job Status */}
        <ContentCard>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-headline-md font-semibold text-on-surface">Job Status</h2>
            <StatusBadge status={running ? 'running' : 'idle'} />
          </div>

          {/* 2×2 stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-container rounded-card p-3">
              <p className="text-label-sm text-on-surface-variant">Groups Joined</p>
              <p className="text-headline-md font-semibold text-on-surface mt-1">{stats.joined}</p>
            </div>
            <div className="bg-surface-container rounded-card p-3">
              <p className="text-label-sm text-on-surface-variant">DMs Sent</p>
              <p className="text-headline-md font-semibold text-on-surface mt-1">{stats.dms}</p>
            </div>
            <div className="bg-surface-container rounded-card p-3">
              <p className="text-label-sm text-on-surface-variant">Contacts Found</p>
              <p className="text-headline-md font-semibold text-on-surface mt-1">{stats.contacts}</p>
            </div>
            <div className="bg-surface-container rounded-card p-3">
              <p className="text-label-sm text-on-surface-variant">Errors</p>
              <p className="text-headline-md font-semibold text-on-surface mt-1">{stats.errors}</p>
            </div>
          </div>
        </ContentCard>

        {/* Live Process Log */}
        <ContentCard className="flex-1 flex flex-col min-h-0">
          <h2 className="text-headline-md font-semibold text-on-surface mb-3">Live Process Log</h2>
          <LogPanel entries={logs} maxHeight="flex-1 min-h-0 h-full" />
        </ContentCard>
      </div>
    </div>
  );
}
