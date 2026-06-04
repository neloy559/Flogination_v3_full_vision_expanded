'use client';
import { useState } from 'react';
import { useStore } from '../../../../../../src/store';
import { ContentCard } from '../../ui/ContentCard';
import { StatusBadge } from '../../ui/StatusBadge';

type Mode = 'post_seeder' | 'video_watch_farm';

// ─── Mock watcher data shape for Video Watch Farm grid ────────────────────────
interface WatcherCard {
  id: string;
  accountName: string;
  status: 'running' | 'idle' | 'failed';
  progress: number; // 0–100
}

export function ContentAmplifierView() {
  const { sessions, sessionsByCountry } = useStore();
  const [mode, setMode] = useState<Mode>('post_seeder');
  const [targetUrl, setTargetUrl] = useState('');
  const [likeEnabled, setLikeEnabled] = useState(true);
  const [reactEnabled, setReactEnabled] = useState(true);
  const [commentEnabled, setCommentEnabled] = useState(false);
  const [shareEnabled, setShareEnabled] = useState(true);
  const [saveEnabled, setSaveEnabled] = useState(true);
  const [watchDuration, setWatchDuration] = useState(85);
  const [concurrentWatchers, setConcurrentWatchers] = useState(3);
  const [videoUrls, setVideoUrls] = useState('');
  const [running, setRunning] = useState(false);

  const liveSessions = sessions.filter(s => s.healthStatus === 'live');
  const totalFollowers = sessions.reduce((sum, s) => sum + (s.friendsCount ?? 0), 0);

  // Derive active watcher cards from live sessions (up to concurrentWatchers count)
  const activeWatchers: WatcherCard[] = liveSessions.slice(0, concurrentWatchers).map(s => ({
    id: s.id,
    accountName: s.fbName ?? s.id,
    status: running ? 'running' : 'idle',
    progress: running ? Math.floor(Math.random() * 80) + 10 : 0,
  }));

  const handleStart = async () => {
    if (!targetUrl.trim() && mode === 'post_seeder') return;
    if (!videoUrls.trim() && mode === 'video_watch_farm') return;
    setRunning(true);
    try {
      await fetch('/api/tools/content-amplifier/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          sessionIds: liveSessions.map(s => s.id),
          targetUrl,
          actions: { like: likeEnabled, react: reactEnabled, comment: commentEnabled, share: shareEnabled, save: saveEnabled },
          watchDuration: mode === 'video_watch_farm' ? watchDuration : undefined,
          concurrentWatchers: mode === 'video_watch_farm' ? concurrentWatchers : undefined,
          videoUrls: mode === 'video_watch_farm' ? videoUrls : undefined,
        }),
      });
    } catch (e) { console.error(e); }
    setRunning(false);
  };

  // ─── Shared pill tab classes ───────────────────────────────────────────────
  const activeTab = 'bg-primary-container text-on-primary-container rounded-badge px-4 py-1.5 text-label-md font-medium transition-all';
  const inactiveTab = 'bg-surface-container text-on-surface-variant rounded-badge px-4 py-1.5 text-label-md transition-all hover:bg-surface-container-high';

  return (
    <div className="p-8 flex flex-col gap-6 h-full overflow-y-auto bg-background">

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <ContentCard padding="md">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-headline-md font-semibold text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary-container text-[22px]">volume_up</span>
              Content Amplifier
            </h1>
            <p className="text-body-md text-on-surface-variant mt-1">
              Automated engagement and watch-time generation protocol.
            </p>
          </div>

          {/* ── Mode Tabs ──────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMode('post_seeder')}
              className={mode === 'post_seeder' ? activeTab : inactiveTab}
            >
              Post Seeder
            </button>
            <button
              onClick={() => setMode('video_watch_farm')}
              className={mode === 'video_watch_farm' ? activeTab : inactiveTab}
            >
              Video Watch Farm
            </button>
          </div>
        </div>
      </ContentCard>

      {/* ── POST SEEDER MODE ─────────────────────────────────────────────────── */}
      {mode === 'post_seeder' && (
        <div className="grid grid-cols-3 gap-6">

          {/* Left: Configuration (2/3) */}
          <div className="col-span-2 flex flex-col gap-4">

            {/* Content / Target URL */}
            <ContentCard padding="md">
              <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wider mb-4">
                Target Configuration
              </h2>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-label-sm text-on-surface-variant block mb-1.5">
                    Target Post URL
                  </label>
                  <input
                    className="w-full bg-surface-container-lowest border border-outline-variant text-on-surface text-body-md rounded-button px-3 h-9 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                    type="text"
                    placeholder="https://facebook.com/posts/..."
                    value={targetUrl}
                    onChange={e => setTargetUrl(e.target.value)}
                  />
                </div>

                {/* Content textarea */}
                <div>
                  <label className="text-label-sm text-on-surface-variant block mb-1.5">
                    Content / Comment Template
                  </label>
                  <textarea
                    className="w-full bg-surface-container-lowest border border-outline-variant text-on-surface text-body-md rounded-button px-3 py-2 h-24 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                    placeholder="Enter comment or content template..."
                  />
                </div>
              </div>
            </ContentCard>

            {/* Post Targets */}
            <ContentCard padding="md">
              <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wider mb-4">
                Post Targets
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-label-sm text-on-surface-variant block mb-2">
                    Engagement Actions
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        ['Like', likeEnabled, setLikeEnabled],
                        ['React', reactEnabled, setReactEnabled],
                        ['Comment', commentEnabled, setCommentEnabled],
                        ['Share', shareEnabled, setShareEnabled],
                        ['Save', saveEnabled, setSaveEnabled],
                      ] as [string, boolean, (v: boolean) => void][]
                    ).map(([label, val, setter]) => (
                      <label
                        key={label}
                        className="flex items-center gap-2 bg-surface-container border border-outline-variant px-2.5 py-1 rounded-badge cursor-pointer hover:border-primary-container transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={val}
                          onChange={e => setter(e.target.checked)}
                          className="form-checkbox bg-transparent border-outline-variant text-primary-container focus:ring-0 rounded-sm w-3 h-3"
                        />
                        <span className="text-label-sm text-on-surface">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-label-sm text-on-surface-variant block mb-2">
                    React Distribution
                  </label>
                  <select className="w-full bg-surface-container-lowest border border-outline-variant text-on-surface text-body-md rounded-button h-9 px-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors appearance-none">
                    <option>Mixed (Randomized)</option>
                    <option>Heavy Love (80% Heart)</option>
                    <option>Supportive (Care/Like)</option>
                  </select>
                </div>
              </div>
            </ContentCard>

            {/* Accounts Selector */}
            <ContentCard padding="md">
              <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wider mb-4">
                Accounts
              </h2>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-body-md text-on-surface-variant">Active accounts available:</span>
                  <span className="text-body-md font-semibold text-on-surface">{liveSessions.length}</span>
                </div>
                <span className="text-label-sm text-on-surface-variant">
                  {sessions.length} total sessions
                </span>
              </div>
            </ContentCard>

            {/* Schedule Configuration */}
            <ContentCard padding="md">
              <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wider mb-4">
                Schedule Configuration
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-label-sm text-on-surface-variant block mb-1.5">
                    Cron Schedule
                  </label>
                  <input
                    className="w-full bg-surface-container-lowest border border-outline-variant text-on-surface text-body-md rounded-button px-3 h-9 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                    type="text"
                    defaultValue="0 0 * * * (Daily Midnight UTC)"
                  />
                </div>
                <div>
                  <label className="text-label-sm text-on-surface-variant block mb-1.5">
                    Delay Between Actions (ms)
                  </label>
                  <input
                    className="w-full bg-surface-container-lowest border border-outline-variant text-on-surface text-body-md rounded-button px-3 h-9 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                    type="number"
                    defaultValue={1500}
                    min={500}
                    max={10000}
                  />
                </div>
              </div>
            </ContentCard>
          </div>

          {/* Right: Execution + Monetization (1/3) */}
          <div className="flex flex-col gap-4">

            {/* Execution Engine */}
            <ContentCard padding="md">
              <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wider mb-4">
                Execution Engine
              </h2>
              <div className="flex flex-col gap-3 mb-4">
                <div className="flex justify-between items-center">
                  <span className="text-body-md text-on-surface-variant">Active Accounts</span>
                  <span className="text-body-md font-semibold text-on-surface">{liveSessions.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-body-md text-on-surface-variant">Total Sessions</span>
                  <span className="text-body-md font-semibold text-on-surface">{sessions.length}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-body-md text-on-surface-variant">Status</span>
                  <StatusBadge status={running ? 'running' : 'idle'} size="sm" />
                </div>
              </div>
              <button
                onClick={handleStart}
                disabled={running || !targetUrl.trim()}
                className="w-full bg-primary-container text-on-primary-container font-semibold text-label-md rounded-button h-10 hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[18px]">bolt</span>
                {running ? 'Running...' : 'Initiate Campaign'}
              </button>
            </ContentCard>

            {/* Monetization Tracker */}
            <ContentCard padding="md" className="flex-1">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wider">
                  Monetization Progress
                </h2>
                <span className="material-symbols-outlined text-on-surface-variant text-[18px]">monetization_on</span>
              </div>
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-end">
                    <span className="text-body-md text-on-surface-variant">Followers</span>
                    <span className="text-body-md text-on-surface">
                      <span className="text-primary font-semibold">{Math.min(totalFollowers, 10000).toLocaleString()}</span>
                      <span className="text-on-surface-variant"> / 10,000</span>
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-container border border-outline-variant rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${Math.min((totalFollowers / 10000) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-end">
                    <span className="text-body-md text-on-surface-variant">Watch Hours (365d)</span>
                    <span className="text-body-md text-on-surface">
                      <span className="text-tertiary font-semibold">0</span>
                      <span className="text-on-surface-variant"> / 4,000</span>
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-surface-container border border-outline-variant rounded-full overflow-hidden">
                    <div className="h-full bg-tertiary" style={{ width: '0%' }} />
                  </div>
                </div>
                <p className="text-center text-label-sm text-on-surface-variant">
                  Est. completion: —
                </p>
              </div>
            </ContentCard>
          </div>
        </div>
      )}

      {/* ── VIDEO WATCH FARM MODE ─────────────────────────────────────────────── */}
      {mode === 'video_watch_farm' && (
        <div className="flex flex-col gap-4">

          {/* Configuration row */}
          <div className="grid grid-cols-3 gap-4">

            {/* Video URLs input */}
            <ContentCard padding="md" className="col-span-2">
              <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wider mb-4">
                Video URLs
              </h2>
              <textarea
                className="w-full bg-surface-container-lowest border border-outline-variant text-on-surface text-body-md rounded-button px-3 py-2 h-28 resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
                placeholder="Paste video URLs, one per line..."
                value={videoUrls}
                onChange={e => setVideoUrls(e.target.value)}
              />
            </ContentCard>

            {/* Controls */}
            <ContentCard padding="md">
              <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wider mb-4">
                Watch Settings
              </h2>
              <div className="flex flex-col gap-4">
                {/* Watch Duration Slider */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="text-label-sm text-on-surface-variant">Watch Duration</label>
                    <span className="text-label-sm font-semibold text-on-surface">{watchDuration}%</span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={watchDuration}
                    onChange={e => setWatchDuration(parseInt(e.target.value))}
                    className="w-full h-1.5 bg-surface-container rounded-full appearance-none cursor-pointer accent-primary-container"
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-on-surface-variant">50%</span>
                    <span className="text-[10px] text-on-surface-variant">100%</span>
                  </div>
                </div>

                {/* Concurrent Watchers Counter */}
                <div>
                  <label className="text-label-sm text-on-surface-variant block mb-1.5">
                    Concurrent Watchers
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setConcurrentWatchers(v => Math.max(1, v - 1))}
                      className="w-8 h-8 rounded-button bg-surface-container border border-outline-variant text-on-surface flex items-center justify-center hover:bg-surface-container-high transition-colors"
                    >
                      −
                    </button>
                    <span className="flex-1 text-center text-body-md font-semibold text-on-surface">
                      {concurrentWatchers}
                    </span>
                    <button
                      onClick={() => setConcurrentWatchers(v => Math.min(liveSessions.length || 10, v + 1))}
                      className="w-8 h-8 rounded-button bg-surface-container border border-outline-variant text-on-surface flex items-center justify-center hover:bg-surface-container-high transition-colors"
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Start button */}
                <button
                  onClick={handleStart}
                  disabled={running || !videoUrls.trim()}
                  className="w-full bg-primary-container text-on-primary-container font-semibold text-label-md rounded-button h-10 hover:opacity-90 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                >
                  <span className="material-symbols-outlined text-[18px]">play_arrow</span>
                  {running ? 'Running...' : 'Start Farm'}
                </button>
              </div>
            </ContentCard>
          </div>

          {/* Active Watcher Cards Grid */}
          <ContentCard padding="md">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wider">
                Active Watchers
              </h2>
              <StatusBadge status={running ? 'running' : 'idle'} size="sm" />
            </div>

            {activeWatchers.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant gap-2">
                <span className="material-symbols-outlined text-[32px]">smart_display</span>
                <p className="text-body-md">No active sessions available. Add accounts to start watching.</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                {activeWatchers.map(watcher => (
                  <ContentCard key={watcher.id} padding="sm" hover className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-label-md font-medium text-on-surface truncate max-w-[120px]">
                        {watcher.accountName}
                      </span>
                      <StatusBadge status={watcher.status} size="sm" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between items-center">
                        <span className="text-label-sm text-on-surface-variant">Progress</span>
                        <span className="text-label-sm font-semibold text-on-surface">{watcher.progress}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary-container transition-all"
                          style={{ width: `${watcher.progress}%` }}
                        />
                      </div>
                    </div>
                  </ContentCard>
                ))}
              </div>
            )}
          </ContentCard>

          {/* Monetization Tracker (compact row) */}
          <ContentCard padding="md">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wider">
                Monetization Progress
              </h2>
              <span className="material-symbols-outlined text-on-surface-variant text-[18px]">monetization_on</span>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-end">
                  <span className="text-body-md text-on-surface-variant">Followers</span>
                  <span className="text-body-md text-on-surface">
                    <span className="text-primary font-semibold">{Math.min(totalFollowers, 10000).toLocaleString()}</span>
                    <span className="text-on-surface-variant"> / 10,000</span>
                  </span>
                </div>
                <div className="w-full h-1.5 bg-surface-container border border-outline-variant rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.min((totalFollowers / 10000) * 100, 100)}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-end">
                  <span className="text-body-md text-on-surface-variant">Watch Hours (365d)</span>
                  <span className="text-body-md text-on-surface">
                    <span className="text-tertiary font-semibold">0</span>
                    <span className="text-on-surface-variant"> / 4,000</span>
                  </span>
                </div>
                <div className="w-full h-1.5 bg-surface-container border border-outline-variant rounded-full overflow-hidden">
                  <div className="h-full bg-tertiary" style={{ width: '0%' }} />
                </div>
              </div>
            </div>
          </ContentCard>
        </div>
      )}
    </div>
  );
}
