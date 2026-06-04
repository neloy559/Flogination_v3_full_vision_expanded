'use client';
import { useState } from 'react';
import { useStore } from '../../../../../../src/store';
import { ContentCard } from '../../ui/ContentCard';
import { StatusBadge } from '../../ui/StatusBadge';
import { LogPanel } from '../../ui/LogPanel';

type Stance = 'url_promotion' | 'reels_commenting' | 'page_review';

/** Campaign type tab definition */
interface CampaignTab {
  id: Stance;
  label: string;
}

const CAMPAIGN_TABS: CampaignTab[] = [
  { id: 'url_promotion',    label: 'URL Promotion' },
  { id: 'reels_commenting', label: 'Reels Commenting' },
  { id: 'page_review',      label: 'Page Review' },
];

export function CommentMarketingView() {
  const { sessions } = useStore();
  const [stance, setStance] = useState<Stance>('url_promotion');
  const [targets, setTargets] = useState('');
  const [content, setContent] = useState('{Awesome|Great|Incredible} post! Check out {our link|this site}: https://example.com/promo');
  const [promoUrl, setPromoUrl] = useState('');
  const [timing, setTiming] = useState<'burst' | 'drip'>('burst');
  const [dripHours, setDripHours] = useState(24);
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState({ delivered: 0, failed: 0, rateLimited: 0 });

  const liveSessions = sessions.filter(s => s.healthStatus === 'live');

  const handleDeploy = async () => {
    if (!targets.trim() || liveSessions.length === 0) return;
    setRunning(true);
    try {
      await fetch('/api/tools/comment-engine/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stance,
          sessionIds: liveSessions.map(s => s.id),
          targets: targets.split('\n').filter(t => t.trim()),
          contentTemplate: content,
          promoUrl: promoUrl || undefined,
          timing,
          dripHours: timing === 'drip' ? dripHours : undefined,
        }),
      });
    } catch (e) { console.error(e); }
    setRunning(false);
  };

  const stances: Array<{ id: Stance; icon: string; label: string; desc: string }> = [
    { id: 'url_promotion',   icon: 'link',    label: 'URL Promotion',    desc: 'Broad broadcast' },
    { id: 'reels_commenting', icon: 'movie',  label: 'Reels Commenting', desc: 'High visibility' },
    { id: 'page_review',     icon: 'reviews', label: 'Page Review',      desc: 'Targeted trust' },
  ];

  return (
    <div className="grid grid-cols-12 gap-6 p-8 h-full overflow-hidden bg-background">

      {/* ── Left Panel ─────────────────────────────────────────────────────── */}
      <div className="col-span-7 flex flex-col gap-4 overflow-y-auto">

        {/* Campaign Type Tabs */}
        <ContentCard>
          <div className="flex items-center gap-2 flex-wrap">
            {CAMPAIGN_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setStance(tab.id)}
                className={
                  stance === tab.id
                    ? 'bg-primary-container text-on-primary rounded-badge px-4 py-1.5 text-label-md font-medium transition-colors'
                    : 'bg-surface-container text-on-surface-variant rounded-badge px-4 py-1.5 text-label-md transition-colors hover:bg-surface-container-high'
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
        </ContentCard>

        {/* Stance Selector */}
        <ContentCard>
          <div className="flex items-center gap-2 mb-4">
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">radar</span>
            <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wide">Engagement Stance</h2>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {stances.map(s => (
              <button
                key={s.id}
                onClick={() => setStance(s.id)}
                className={`border rounded-card p-3 cursor-pointer flex flex-col items-center justify-center gap-2 text-center transition-colors relative overflow-hidden ${
                  stance === s.id
                    ? 'border-primary bg-primary/10'
                    : 'border-outline-variant bg-surface-container-low hover:border-outline'
                }`}
              >
                {stance === s.id && (
                  <div className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary-container animate-pulse" />
                )}
                <span className={`material-symbols-outlined text-[24px] ${stance === s.id ? 'text-primary' : 'text-on-surface-variant'}`}>
                  {s.icon}
                </span>
                <div className={`text-body-md font-semibold ${stance === s.id ? 'text-primary' : 'text-on-surface'}`}>
                  {s.label}
                </div>
                <div className="text-[10px] text-on-surface-variant font-mono">{s.desc}</div>
              </button>
            ))}
          </div>
        </ContentCard>

        {/* Payload Configuration */}
        <ContentCard className="flex-1">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">edit_document</span>
              <h2 className="text-label-md font-semibold text-on-surface uppercase tracking-wide">Payload Configuration</h2>
            </div>
            <span className="text-[10px] text-on-surface-variant font-mono">Spin Syntax: ON</span>
          </div>

          <div className="flex flex-col gap-4">
            {/* Target Endpoints */}
            <div className="flex flex-col gap-1.5">
              <label className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                Target Endpoints (One per line)
              </label>
              <textarea
                className="w-full h-24 bg-surface-container-lowest border border-outline-variant rounded-button p-2 font-mono text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                placeholder={'https://facebook.com/posts/xxx\nviral marketing tips'}
                value={targets}
                onChange={e => setTargets(e.target.value)}
              />
            </div>

            {/* Promo URL — only for URL Promotion stance */}
            {stance === 'url_promotion' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-label-sm text-on-surface-variant uppercase tracking-wider">Promo URL</label>
                <input
                  className="w-full h-9 bg-surface-container-lowest border border-outline-variant rounded-button px-3 font-mono text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="https://example.com/promo"
                  value={promoUrl}
                  onChange={e => setPromoUrl(e.target.value)}
                />
              </div>
            )}

            {/* Comment Body */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-end">
                <label className="text-label-sm text-on-surface-variant uppercase tracking-wider">
                  Comment Body (Supports Spin Syntax)
                </label>
                <button className="text-[11px] text-primary hover:underline">Test Spin</button>
              </div>
              <textarea
                className="w-full min-h-[80px] bg-surface-container-lowest border border-outline-variant rounded-button p-2 font-mono text-[13px] text-on-surface focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                value={content}
                onChange={e => setContent(e.target.value)}
              />
            </div>

            {/* Delivery Mode */}
            <div className="flex flex-col gap-1.5">
              <label className="text-label-sm text-on-surface-variant uppercase tracking-wider">Delivery Mode</label>
              <div className="flex bg-surface-container-highest rounded-button p-0.5 border border-outline-variant">
                <button
                  onClick={() => setTiming('burst')}
                  className={`flex-1 py-1.5 rounded-button text-body-md text-center transition-colors ${
                    timing === 'burst'
                      ? 'bg-surface-container-lowest border border-outline-variant text-on-surface shadow-elevated'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  Burst
                </button>
                <button
                  onClick={() => setTiming('drip')}
                  className={`flex-1 py-1.5 rounded-button text-body-md text-center transition-colors ${
                    timing === 'drip'
                      ? 'bg-surface-container-lowest border border-outline-variant text-on-surface shadow-elevated'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  Drip-Feed
                </button>
              </div>
            </div>

            {/* Drip hours slider — only when drip mode is active */}
            {timing === 'drip' && (
              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <label className="text-label-sm text-on-surface-variant uppercase tracking-wider">Distribution Window</label>
                  <span className="text-label-sm text-primary font-mono">{dripHours} Hrs</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={72}
                  value={dripHours}
                  onChange={e => setDripHours(parseInt(e.target.value))}
                  className="w-full h-1 bg-surface-container-highest rounded-full appearance-none cursor-pointer accent-primary-container"
                />
                <div className="flex justify-between text-[10px] text-on-surface-variant font-mono">
                  <span>1h</span>
                  <span>72h</span>
                </div>
              </div>
            )}
          </div>
        </ContentCard>

        {/* Start Campaign Button */}
        <button
          onClick={handleDeploy}
          disabled={running || !targets.trim()}
          className="bg-primary-container text-on-primary rounded-full w-full py-3 text-body-md font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {running ? 'Deploying Campaign...' : 'Start Campaign'}
        </button>
      </div>

      {/* ── Right Panel ────────────────────────────────────────────────────── */}
      <div className="col-span-5 flex flex-col gap-4">

        {/* Job Status Card */}
        <ContentCard>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-label-md font-semibold text-on-surface">Job Status</h2>
            <StatusBadge status={running ? 'running' : 'idle'} />
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-container rounded-card p-3 flex flex-col gap-1">
              <span className="text-label-sm text-on-surface-variant">Delivered</span>
              <span className="text-headline-md font-semibold text-on-surface">{stats.delivered}</span>
            </div>
            <div className="bg-surface-container rounded-card p-3 flex flex-col gap-1">
              <span className="text-label-sm text-on-surface-variant">Failed</span>
              <span className="text-headline-md font-semibold text-error">{stats.failed}</span>
            </div>
            <div className="bg-surface-container rounded-card p-3 flex flex-col gap-1">
              <span className="text-label-sm text-on-surface-variant">Rate-Limited</span>
              <span className="text-headline-md font-semibold text-tertiary">{stats.rateLimited}</span>
            </div>
            <div className="bg-surface-container rounded-card p-3 flex flex-col gap-1">
              <span className="text-label-sm text-on-surface-variant">Active Sessions</span>
              <span className="text-headline-md font-semibold text-on-surface">{liveSessions.length}</span>
            </div>
          </div>
        </ContentCard>

        {/* Live Process Log */}
        <ContentCard className="flex-1">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant">terminal</span>
            <h2 className="text-label-md font-semibold text-on-surface">Live Process Log</h2>
          </div>
          <LogPanel entries={[]} maxHeight="h-full" />
        </ContentCard>
      </div>
    </div>
  );
}
