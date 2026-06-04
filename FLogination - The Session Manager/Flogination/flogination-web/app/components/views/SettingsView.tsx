'use client';
import { useEffect, useState, useCallback } from 'react';
import { useStore } from '../../../../../src/store';
import type { AppSettings } from '../../../../../src/types';
import { ContentCard } from '../ui/ContentCard';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const API_BASE = 'http://localhost:3001/api';

/** Duration (ms) before a test-result status message auto-clears. */
const STATUS_CLEAR_MS = 6_000;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Deep-sets a dot-path value on a plain object clone.
 * e.g. deepSet(obj, 'ai.provider', 'openai') → { ai: { provider: 'openai', ... }, ... }
 */
function deepSet<T extends object>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const next = { ...obj } as Record<string, unknown>;
  let cur = next;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = { ...(cur[keys[i]] as object) };
    cur = cur[keys[i]] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
  return next as T;
}

// ─────────────────────────────────────────────
// SELECTOR CACHE TYPES
// ─────────────────────────────────────────────

interface SelectorCacheEntry {
  id: string;
  elementKey: string;
  cssSelector: string;
  lastVerified: number;
  healCount: number;
}

// ─────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────

function Toast({ message, type, onDismiss }: { message: string; type: 'success' | 'error'; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, STATUS_CLEAR_MS);
    return () => clearTimeout(id);
  }, [onDismiss]);
  return (
    <div className={`fixed bottom-[72px] right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded shadow-lg border font-body-sm text-body-sm transition-all
      ${type === 'success' ? 'bg-secondary/10 border-secondary/30 text-secondary' : 'bg-error/10 border-error/30 text-error'}`}>
      <span className="material-symbols-outlined text-[16px]">{type === 'success' ? 'check_circle' : 'error'}</span>
      {message}
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100">
        <span className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────
// SECTION WRAPPER
// ─────────────────────────────────────────────

function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface-container-lowest p-4 flex flex-col gap-4 border border-outline-variant rounded">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>
        <h2 className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">{title}</h2>
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────
// FIELD COMPONENTS
// ─────────────────────────────────────────────

const INP = 'w-full bg-surface-container-lowest border border-outline-variant h-[28px] px-2 font-data-mono text-data-mono text-on-surface focus:border-primary focus:outline-none placeholder:text-on-surface-variant/40 transition-colors rounded';
const LBL = 'font-body-sm text-body-sm text-on-surface block mb-1';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={LBL}>{label}</label>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <div onClick={() => onChange(!checked)}
        className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${checked ? 'bg-primary' : 'bg-surface-container-high border border-outline-variant'}`}>
        <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${checked ? 'left-4 bg-surface-container-lowest' : 'left-0.5 bg-outline'}`} />
      </div>
      <span className="font-body-sm text-body-sm text-on-surface">{label}</span>
    </label>
  );
}

function TestButton({
  label, onClick, status,
}: {
  label: string;
  onClick: () => void;
  status: string;
}) {
  const isOk  = status.startsWith('✅');
  const isErr = status.startsWith('❌');
  return (
    <div className="flex items-center gap-2">
      <button onClick={onClick}
        className="h-[28px] px-3 border border-outline-variant bg-transparent text-on-surface hover:bg-surface-container-high transition-colors flex items-center gap-1 font-body-sm text-body-sm rounded">
        <span className="material-symbols-outlined text-[14px]">bolt</span>
        {label}
      </button>
      {status && (
        <span className={`font-data-mono text-[10px] ${isOk ? 'text-secondary' : isErr ? 'text-error' : 'text-on-surface-variant'}`}>
          {status}
        </span>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// SELECTOR CACHE VIEWER
// ─────────────────────────────────────────────

function SelectorCacheViewer() {
  const [entries, setEntries] = useState<SelectorCacheEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/selector-cache`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { entries?: SelectorCacheEntry[] };
      setEntries(data.entries ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    try {
      await fetch(`${API_BASE}/selector-cache/${id}`, { method: 'DELETE' });
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch { /* ignore */ }
  };

  return (
    <Section icon="manage_search" title="Selector Cache">
      <div className="flex items-center justify-between">
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Self-healing CSS selectors cached by the AI repair engine.
        </p>
        <button onClick={load} disabled={loading}
          className="h-[24px] px-3 border border-outline-variant text-on-surface font-body-sm text-body-sm rounded hover:bg-surface-container-high flex items-center gap-1 disabled:opacity-50">
          <span className={`material-symbols-outlined text-[13px] ${loading ? 'animate-spin' : ''}`}>refresh</span>
          Refresh
        </button>
      </div>
      {error && <p className="text-error font-body-sm text-body-sm">{error}</p>}
      {entries.length === 0 && !loading && (
        <p className="text-on-surface-variant font-body-sm text-body-sm italic">No cached selectors.</p>
      )}
      {entries.length > 0 && (
        <div className="overflow-x-auto border border-outline-variant rounded">
          <table className="w-full text-left font-data-mono text-data-mono text-[10px]">
            <thead>
              <tr className="bg-surface-container-high text-on-surface-variant">
                <th className="px-2 py-1.5">Element Key</th>
                <th className="px-2 py-1.5">CSS Selector</th>
                <th className="px-2 py-1.5">Last Verified</th>
                <th className="px-2 py-1.5 text-right">Heals</th>
                <th className="px-2 py-1.5 w-[40px]"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.id} className="border-t border-outline-variant hover:bg-surface-container-low">
                  <td className="px-2 py-1 text-primary font-semibold">{e.elementKey}</td>
                  <td className="px-2 py-1 text-on-surface-variant truncate max-w-[200px]" title={e.cssSelector}>{e.cssSelector}</td>
                  <td className="px-2 py-1 text-on-surface-variant">
                    {e.lastVerified ? new Date(e.lastVerified).toLocaleString() : '—'}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <span className={e.healCount > 0 ? 'text-tertiary font-bold' : 'text-on-surface-variant'}>{e.healCount}</span>
                  </td>
                  <td className="px-2 py-1 text-center">
                    <button onClick={() => handleDelete(e.id)} title="Delete entry"
                      className="text-on-surface-variant hover:text-error transition-colors">
                      <span className="material-symbols-outlined text-[13px]">delete</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────
// TAB DEFINITIONS
// ─────────────────────────────────────────────

interface TabDef {
  id: string;
  label: string;
  icon: string;
  title: string;
  subtitle: string;
}

const TABS: TabDef[] = [
  { id: 'general',        label: 'General',        icon: 'tune',         title: 'General',          subtitle: 'Core application settings and defaults.' },
  { id: 'ai-gateway',     label: 'AI Gateway',     icon: 'psychology',   title: 'AI Gateway',       subtitle: 'Configure your AI provider, API key, and model.' },
  { id: 'agent-bridge',   label: 'Agent Bridge',   icon: 'hub',          title: 'Agent Bridge',     subtitle: 'External agent control API settings.' },
  { id: 'mongodb',        label: 'MongoDB',        icon: 'storage',      title: 'MongoDB Datastore', subtitle: 'Optional MongoDB connection for extended storage.' },
  { id: 'n8n',            label: 'n8n Webhooks',   icon: 'webhook',      title: 'n8n Webhooks',     subtitle: 'Webhook base URL for n8n automation flows.' },
  { id: 'stealth',        label: 'Stealth',        icon: 'security',     title: 'Stealth & Evasion', subtitle: 'Browser fingerprint and proxy kill-switch settings.' },
  { id: 'inbox',          label: 'Inbox',          icon: 'inbox',        title: 'Inbox',            subtitle: 'Message polling interval and inbox behaviour.' },
  { id: 'grid-layout',    label: 'Grid Layout',    icon: 'grid_view',    title: 'Grid Layout',      subtitle: 'Configure the browser tile grid dimensions.' },
  { id: 'hibernation',    label: 'Hibernation',    icon: 'bedtime',      title: 'Hibernation',      subtitle: 'Suspend idle browser contexts to conserve RAM.' },
  { id: 'selector-cache', label: 'Selector Cache', icon: 'manage_search', title: 'Selector Cache',  subtitle: 'Self-healing CSS selectors cached by the AI repair engine.' },
];

// ─────────────────────────────────────────────
// MAIN VIEW
// ─────────────────────────────────────────────

/**
 * SettingsView — full application configuration panel.
 *
 * Two-panel layout (3/9 split):
 *  Left  — vertical tab navigation with upgrade prompt
 *  Right — section header + form content + save bar + sync status
 *
 * Sections:
 *  1. AI Gateway       — provider, API key, model, free model, test connection
 *  2. Agent Bridge     — enable toggle, port, API key
 *  3. MongoDB          — URI, test connection
 *  4. n8n Webhooks     — base URL, send test webhook
 *  5. Stealth          — max scrape parallel, memory cap, proxy kill switch
 *  6. Inbox            — poll interval
 *  7. Grid Layout      — cols, rows
 *  8. Hibernation      — enable toggle
 *  9. Selector Cache   — table with delete per entry
 *
 * All fields are wired to a local draft copy of AppSettings.
 * "Save Configuration" calls saveSettings() with the full draft.
 * "Discard" resets the draft to the last fetched settings.
 */
export function SettingsView() {
  const { settings, fetchSettings, saveSettings, testMongoConnection, testN8nWebhook } = useStore();

  const [local,      setLocal]      = useState<AppSettings | null>(null);
  const [dirty,      setDirty]      = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [activeTab,  setActiveTab]  = useState<string>('general');

  // Test-result status strings
  const [aiStatus,    setAiStatus]    = useState('');
  const [mongoStatus, setMongoStatus] = useState('');
  const [n8nStatus,   setN8nStatus]   = useState('');

  // Load on mount
  useEffect(() => { fetchSettings(); }, []);

  // Populate local draft once settings arrive (only on first load)
  useEffect(() => {
    if (settings && !local) setLocal({ ...settings });
  }, [settings]);

  /** Updates a dot-path field in the local draft and marks dirty. */
  const update = (path: string, value: unknown) => {
    if (!local) return;
    setLocal(prev => deepSet(prev!, path, value));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!local) return;
    setSaving(true);
    try {
      await saveSettings(local);
      setDirty(false);
      setToast({ message: 'Settings saved successfully.', type: 'success' });
    } catch (e: unknown) {
      setToast({ message: e instanceof Error ? e.message : 'Save failed', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    if (settings) { setLocal({ ...settings }); setDirty(false); }
  };

  // ── Test handlers ────────────────────────────

  const handleTestAI = async () => {
    if (!local) return;
    setAiStatus('Testing...');
    try {
      const res = await fetch(`${API_BASE}/ai/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: local.ai.provider, apiKey: local.ai.apiKey, model: local.ai.model }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      setAiStatus(data.success ? '✅ Connected' : `❌ ${data.error ?? 'Failed'}`);
    } catch (e: unknown) {
      setAiStatus(`❌ ${e instanceof Error ? e.message : 'Error'}`);
    }
  };

  const handleTestMongo = async () => {
    if (!local?.mongoUri) return;
    setMongoStatus('Testing...');
    const r = await testMongoConnection(local.mongoUri);
    setMongoStatus(r.success ? '✅ Connected' : `❌ ${r.error}`);
  };

  const handleTestN8n = async () => {
    if (!local?.n8nBaseUrl) return;
    setN8nStatus('Testing...');
    const r = await testN8nWebhook(local.n8nBaseUrl);
    setN8nStatus(r.success ? '✅ Sent' : `❌ ${r.error}`);
  };

  if (!local) {
    return (
      <div className="flex items-center justify-center h-full text-on-surface-variant font-body-sm">
        <span className="material-symbols-outlined animate-spin mr-2">sync</span>
        Loading settings...
      </div>
    );
  }

  const activeTabDef = TABS.find(t => t.id === activeTab) ?? TABS[0];

  return (
    <div className="grid grid-cols-12 gap-6 p-8 h-full overflow-hidden bg-background">

      {/* ── LEFT PANEL — vertical tab navigation ── */}
      <div className="col-span-3 flex flex-col gap-2">
        {TABS.map(tab => (
          tab.id === activeTab ? (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="bg-surface-container-lowest border border-outline-variant rounded-card p-3 flex items-center justify-between text-primary font-medium cursor-pointer w-full text-left"
            >
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                <span className="font-body-sm text-body-sm">{tab.label}</span>
              </div>
              <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          ) : (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="p-3 flex items-center text-on-surface-variant hover:bg-surface-container rounded-card cursor-pointer w-full text-left gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
              <span className="font-body-sm text-body-sm">{tab.label}</span>
            </button>
          )
        ))}

        {/* Upgrade prompt */}
        <div className="mt-auto pt-2">
          <ContentCard padding="sm">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary">info</span>
              <span className="font-body-sm text-body-sm text-on-surface-variant">Upgrade to Pro</span>
            </div>
          </ContentCard>
        </div>
      </div>

      {/* ── RIGHT PANEL — scrollable content ── */}
      <div className="col-span-9 overflow-y-auto flex flex-col gap-4">

        {/* Section header */}
        <ContentCard padding="md">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-[22px] text-primary">{activeTabDef.icon}</span>
            <div>
              <h1 className="font-headline-sm text-headline-sm text-on-surface">{activeTabDef.title}</h1>
              <p className="font-body-sm text-body-sm text-on-surface-variant">{activeTabDef.subtitle}</p>
            </div>
          </div>
        </ContentCard>

        {/* ── AI Gateway ─────────────────────── */}
        {(activeTab === 'general' || activeTab === 'ai-gateway') && (
          <ContentCard padding="md">
            <Section icon="psychology" title="AI Gateway">
              <Field label="Provider">
                <select className={INP} value={local.ai.provider} onChange={e => update('ai.provider', e.target.value)}>
                  <option value="openrouter">OpenRouter</option>
                  <option value="deepseek">DeepSeek</option>
                  <option value="openai">OpenAI</option>
                  <option value="glm">GLM</option>
                </select>
              </Field>
              <Field label="API Key">
                <input className={INP} type="password" value={local.ai.apiKey}
                  onChange={e => update('ai.apiKey', e.target.value)} placeholder="sk-..." />
              </Field>
              <Field label="Model">
                <input className={INP} type="text" value={local.ai.model}
                  onChange={e => update('ai.model', e.target.value)} placeholder="gpt-4o" />
              </Field>
              <Field label="Free Model (selector healing)">
                <input className={INP} type="text" value={local.ai.freeModel}
                  onChange={e => update('ai.freeModel', e.target.value)} placeholder="openrouter/auto" />
              </Field>
              <Toggle label="Enable AI" checked={local.ai.enabled} onChange={v => update('ai.enabled', v)} />
              <TestButton label="Test Connection" onClick={handleTestAI} status={aiStatus} />
            </Section>
          </ContentCard>
        )}

        {/* ── Agent Bridge ───────────────────── */}
        {(activeTab === 'general' || activeTab === 'agent-bridge') && (
          <ContentCard padding="md">
            <Section icon="hub" title="Agent Bridge">
              <Toggle label="Enable Agent Bridge" checked={local.agentBridge.enabled}
                onChange={v => update('agentBridge.enabled', v)} />
              <Field label="Port">
                <input className={INP} type="number" value={local.agentBridge.port}
                  onChange={e => update('agentBridge.port', parseInt(e.target.value))} />
              </Field>
              <Field label="API Key">
                <input className={INP} type="password" value={local.agentBridge.apiKey}
                  onChange={e => update('agentBridge.apiKey', e.target.value)} placeholder="Bridge API key" />
              </Field>
              <div>
                <label className={LBL}>Allowed Origins (one per line)</label>
                <textarea
                  className="w-full bg-surface-container-lowest border border-outline-variant px-2 py-1.5 font-data-mono text-data-mono text-on-surface focus:border-primary focus:outline-none placeholder:text-on-surface-variant/40 transition-colors rounded resize-none h-20 text-[11px]"
                  value={local.agentBridge.allowedOrigins.join('\n')}
                  onChange={e => update('agentBridge.allowedOrigins', e.target.value.split('\n').filter(Boolean))}
                  placeholder="https://my-agent.example.com"
                />
              </div>
            </Section>
          </ContentCard>
        )}

        {/* ── MongoDB ────────────────────────── */}
        {(activeTab === 'general' || activeTab === 'mongodb') && (
          <ContentCard padding="md">
            <Section icon="storage" title="MongoDB Datastore">
              <p className="font-body-sm text-body-sm text-on-surface-variant -mt-2">
                Leave empty to use SQLite only.
              </p>
              <Field label="Connection URI">
                <input className={INP} type="password" value={local.mongoUri}
                  onChange={e => update('mongoUri', e.target.value)} placeholder="mongodb+srv://user:pass@cluster.mongodb.net/db" />
              </Field>
              <TestButton label="Test Connection" onClick={handleTestMongo} status={mongoStatus} />
            </Section>
          </ContentCard>
        )}

        {/* ── n8n Webhooks ───────────────────── */}
        {(activeTab === 'general' || activeTab === 'n8n') && (
          <ContentCard padding="md">
            <Section icon="webhook" title="n8n Webhooks">
              <p className="font-body-sm text-body-sm text-on-surface-variant -mt-2">
                Leave empty to disable all webhook calls.
              </p>
              <Field label="Webhook Base URL">
                <input className={INP} type="text" value={local.n8nBaseUrl}
                  onChange={e => update('n8nBaseUrl', e.target.value)} placeholder="https://n8n.internal" />
              </Field>
              <TestButton label="Send Test Webhook" onClick={handleTestN8n} status={n8nStatus} />
            </Section>
          </ContentCard>
        )}

        {/* ── Stealth ────────────────────────── */}
        {(activeTab === 'general' || activeTab === 'stealth') && (
          <ContentCard padding="md">
            <Section icon="security" title="Stealth &amp; Evasion">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Max Scrape Parallel">
                  <input className={INP} type="number" min={1} max={10} value={local.maxScrapeParallel}
                    onChange={e => update('maxScrapeParallel', parseInt(e.target.value))} />
                </Field>
                <Field label="Memory Cap (MB)">
                  <input className={INP} type="number" value={local.memoryCapMb}
                    onChange={e => update('memoryCapMb', parseInt(e.target.value))} />
                </Field>
              </div>
              <Toggle label="Stealth Mode" checked={local.stealthMode} onChange={v => update('stealthMode', v)} />
              <Toggle label="Block WebRTC Leaks" checked={local.webRTCBlocked} onChange={v => update('webRTCBlocked', v)} />
              <Toggle label="Proxy Kill Switch" checked={local.proxyKillSwitch} onChange={v => update('proxyKillSwitch', v)} />
            </Section>
          </ContentCard>
        )}

        {/* ── Inbox ──────────────────────────── */}
        {(activeTab === 'general' || activeTab === 'inbox') && (
          <ContentCard padding="md">
            <Section icon="inbox" title="Inbox">
              <Field label="Poll Interval (ms)">
                <input className={INP} type="number" min={5000} step={1000} value={local.inboxPollIntervalMs}
                  onChange={e => update('inboxPollIntervalMs', parseInt(e.target.value))} />
              </Field>
              <p className="font-data-mono text-[10px] text-on-surface-variant">
                How often the inbox checks for new messages. Minimum 5000ms recommended.
              </p>
            </Section>
          </ContentCard>
        )}

        {/* ── Grid Layout ────────────────────── */}
        {(activeTab === 'general' || activeTab === 'grid-layout') && (
          <ContentCard padding="md">
            <Section icon="grid_view" title="Grid Layout">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Columns (1–6)">
                  <input className={INP} type="number" min={1} max={6} value={local.gridLayout.cols}
                    onChange={e => update('gridLayout.cols', parseInt(e.target.value))} />
                </Field>
                <Field label="Rows (1–6)">
                  <input className={INP} type="number" min={1} max={6} value={local.gridLayout.rows}
                    onChange={e => update('gridLayout.rows', parseInt(e.target.value))} />
                </Field>
              </div>
              <p className="font-data-mono text-[10px] text-on-surface-variant">
                Grid view shows {local.gridLayout.cols} × {local.gridLayout.rows} = {local.gridLayout.cols * local.gridLayout.rows} browser tiles.
              </p>
            </Section>
          </ContentCard>
        )}

        {/* ── Hibernation ────────────────────── */}
        {(activeTab === 'general' || activeTab === 'hibernation') && (
          <ContentCard padding="md">
            <Section icon="bedtime" title="Hibernation">
              <Toggle label="Enable Hibernation" checked={local.hibernationEnabled}
                onChange={v => update('hibernationEnabled', v)} />
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Suspends idle browser contexts to conserve RAM. Sessions wake automatically on demand.
              </p>
            </Section>
          </ContentCard>
        )}

        {/* ── Selector Cache — full width ────── */}
        {(activeTab === 'general' || activeTab === 'selector-cache') && (
          <ContentCard padding="md">
            <SelectorCacheViewer />
          </ContentCard>
        )}

        {/* ── Save bar ───────────────────────── */}
        <ContentCard padding="sm">
          <div className="flex items-center gap-3">
            <span className={`font-data-mono text-data-mono text-[11px] mr-auto ${dirty ? 'text-tertiary' : 'text-on-surface-variant'}`}>
              {dirty ? '● Unsaved changes' : 'No unsaved changes'}
            </span>
            <button onClick={handleDiscard} disabled={!dirty}
              className="h-[32px] px-4 border border-outline-variant bg-surface-container-lowest text-on-surface font-body-sm text-body-sm rounded-button hover:bg-surface-container disabled:opacity-40 transition-colors">
              Discard
            </button>
            <button onClick={handleSave} disabled={!dirty || saving}
              className="h-[32px] px-6 bg-primary-container text-on-primary font-body-sm font-semibold rounded-button flex items-center gap-2 hover:opacity-90 disabled:opacity-50 transition-opacity">
              <span className="material-symbols-outlined text-[16px]">{saving ? 'hourglass_empty' : 'save'}</span>
              {saving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </ContentCard>

        {/* ── Sync status info card ──────────── */}
        <ContentCard padding="sm">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-primary">info</span>
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              {dirty
                ? 'You have unsaved changes. Save to apply them to the running system.'
                : 'All settings are in sync with the running system.'}
            </span>
          </div>
        </ContentCard>

      </div>{/* end right panel */}

      {/* Toast */}
      {toast && (
        <Toast message={toast.message} type={toast.type} onDismiss={() => setToast(null)} />
      )}

    </div>
  );
}
