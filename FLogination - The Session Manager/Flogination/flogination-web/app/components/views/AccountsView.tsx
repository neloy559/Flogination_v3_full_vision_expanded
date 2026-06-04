'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../../../../../src/store';
import type { Session, BMRecord, PageRecord, GroupRecord } from '../../../../../src/types';
import { ContentCard } from '../ui/ContentCard';
import { StatusBadge } from '../ui/StatusBadge';
import { ProgressBar } from '../ui/ProgressBar';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Height of each table row in pixels — required for CSS virtualization. */
const ROW_HEIGHT_PX = 32;

/** Number of extra rows to render above/below the visible window (overscan). */
const OVERSCAN_ROWS = 10;

/** Polling interval when any session is actively scraping. */
const SCRAPING_POLL_INTERVAL_MS = 3_000;

/** FB page titles that are NOT real profile names — filter these out. */
const FAKE_NAME_PATTERNS = [
  /^notifications$/i,
  /^chats?$/i,
  /^messages?$/i,
  /^facebook$/i,
  /^home$/i,
  /^feed$/i,
  /^watch$/i,
  /^marketplace$/i,
  /^groups?$/i,
  /^events?$/i,
  /^importing\.\.\.$/i,
];

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Returns true if the fbName looks like a real person/page name. */
function isRealName(name: string | undefined): boolean {
  if (!name || name.trim().length < 2) return false;
  if (/^account\s+\d+$/i.test(name.trim())) return false;
  return !FAKE_NAME_PATTERNS.some(p => p.test(name.trim()));
}

/** Returns display name — falls back to UID-based placeholder. */
function displayName(s: Session): string {
  if (isRealName(s.fbName)) return s.fbName;
  // pending_ prefix means UID not yet scraped
  if (s.uid && /^\d+$/.test(s.uid)) return `Account ${s.uid}`;
  return 'Importing...';
}

/** Safely parses a JSON string field — returns empty array on failure. */
function parseJsonArray<T>(raw: string | undefined | null): T[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as T[]; } catch { return []; }
}

// ─────────────────────────────────────────────
// HEALTH BADGE
// ─────────────────────────────────────────────

function HealthBadge({ status, verified }: { status: string; verified: boolean }) {
  const map: Record<string, string> = {
    live:           'bg-primary/10 text-primary border-primary/20',
    warming:        'bg-secondary/10 text-secondary border-secondary/20',
    checkpoint:     'bg-tertiary/10 text-tertiary border-tertiary/20',
    '2fa_required': 'bg-tertiary-container/10 text-tertiary-container border-tertiary-container/20',
    restricted:     'bg-orange-500/10 text-orange-400 border-orange-500/20',
    banned:         'bg-error/20 text-error border-error/30',
    dead:           'bg-error/10 text-error border-error/20',
  };
  const dot: Record<string, string> = {
    live:           'bg-primary animate-pulse-dot',
    warming:        'bg-secondary animate-pulse-dot',
    checkpoint:     'bg-tertiary',
    '2fa_required': 'bg-tertiary-container',
    restricted:     'bg-orange-400',
    banned:         'bg-error',
    dead:           'bg-error',
  };
  const label: Record<string, string> = {
    live: 'LIVE', warming: 'WARM', checkpoint: 'CHKPT',
    '2fa_required': '2FA', restricted: 'RESTR', banned: 'BANNED', dead: 'DEAD',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 px-1 rounded-[2px] text-[9px] font-bold uppercase border ${map[status] ?? 'bg-surface-container text-on-surface-variant border-outline-variant'} ${!verified ? 'opacity-50' : ''}`}
      title={!verified ? 'Health not yet verified — scrape pending' : undefined}
    >
      <span className={`w-1 h-1 rounded-full ${dot[status] ?? 'bg-outline'}`} />
      {label[status] ?? status}
      {!verified && <span className="text-[7px] opacity-70">?</span>}
    </span>
  );
}

// ─────────────────────────────────────────────
// SCRAPING BADGE
// ─────────────────────────────────────────────

function ScrapingBadge({ status }: { status: string }) {
  if (status === 'scraping') return (
    <div className="flex items-center gap-1 text-tertiary">
      <span className="material-symbols-outlined text-[14px] animate-spin">sync</span>
      <span className="text-[10px]">Scraping</span>
    </div>
  );
  if (status === 'done') return (
    <div className="flex items-center gap-1 text-primary">
      <span className="material-symbols-outlined text-[14px]">done_all</span>
      <span className="text-[10px]">Done</span>
    </div>
  );
  if (status === 'failed') return (
    <div className="flex items-center gap-1 text-error">
      <span className="material-symbols-outlined text-[14px]">error</span>
      <span className="text-[10px]">Failed</span>
    </div>
  );
  return <span className="text-[10px] text-on-surface-variant">Pending</span>;
}

// ─────────────────────────────────────────────
// COPY BUTTON
// ─────────────────────────────────────────────

function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(value).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <button onClick={handleCopy} title={`Copy ${label ?? 'value'}`}
      className="ml-1 text-on-surface-variant hover:text-primary transition-colors shrink-0">
      <span className="material-symbols-outlined text-[12px]">{copied ? 'check' : 'content_copy'}</span>
    </button>
  );
}

// ─────────────────────────────────────────────
// INLINE FIELD EDITOR
// ─────────────────────────────────────────────

function EditableField({
  label, value, sessionId, field, type = 'text',
}: {
  label: string;
  value: string | number | undefined | null;
  sessionId: string;
  field: keyof Session;
  type?: 'text' | 'password';
}) {
  const { updateSession } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ''));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const displayVal = value !== undefined && value !== null && value !== '' ? String(value) : '—';

  const handleSave = async () => {
    if (draft === String(value ?? '')) { setEditing(false); return; }
    setSaving(true);
    await updateSession(sessionId, { [field]: draft } as Partial<Session>);
    setSaving(false);
    setEditing(false);
  };

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  return (
    <div className="flex justify-between items-center border-b border-outline-variant pb-1 min-h-[24px]">
      <span className="text-on-surface-variant shrink-0 mr-2">{label}</span>
      {editing ? (
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <input ref={inputRef} type={type} value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
            className="flex-1 min-w-0 h-5 px-1 bg-surface-container-highest border border-primary rounded text-[10px] text-on-surface font-data-mono outline-none"
          />
          <button onClick={handleSave} disabled={saving} className="text-primary hover:opacity-80">
            <span className="material-symbols-outlined text-[12px]">{saving ? 'hourglass_empty' : 'check'}</span>
          </button>
          <button onClick={() => setEditing(false)} className="text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined text-[12px]">close</span>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-on-surface truncate text-right">
            {type === 'password' && displayVal !== '—' ? '••••••••' : displayVal}
          </span>
          <button onClick={() => { setDraft(String(value ?? '')); setEditing(true); }}
            className="text-on-surface-variant hover:text-primary shrink-0">
            <span className="material-symbols-outlined text-[11px]">edit</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// PER-ROW ACTION MENU
// ─────────────────────────────────────────────

function RowActionMenu({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const { launchSession, checkHealth, scrapeSession, deleteSession } = useStore();
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const actions: Array<{ icon: string; label: string; danger?: boolean; onClick: () => void }> = [
    { icon: 'open_in_browser', label: 'Launch Browser',  onClick: () => { launchSession(session.id); onClose(); } },
    { icon: 'health_and_safety', label: 'Check Health', onClick: () => { checkHealth(session.id); onClose(); } },
    { icon: 'sync',             label: 'Re-scrape',      onClick: () => { scrapeSession(session.id); onClose(); } },
    { icon: 'delete',           label: 'Delete',         danger: true, onClick: () => { deleteSession(session.id); onClose(); } },
  ];

  return (
    <div ref={menuRef}
      className="absolute right-0 top-full mt-1 z-50 bg-surface-container-low border border-outline-variant rounded shadow-lg min-w-[160px] py-1">
      {actions.map(a => (
        <button key={a.label} onClick={e => { e.stopPropagation(); a.onClick(); }}
          className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] hover:bg-surface-container-high transition-colors ${a.danger ? 'text-error' : 'text-on-surface'}`}>
          <span className="material-symbols-outlined text-[14px]">{a.icon}</span>
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// BULK IMPORT MODAL
// ─────────────────────────────────────────────

function BulkImportModal({ onClose }: { onClose: () => void }) {
  const { bulkImport } = useStore();
  const [mode, setMode] = useState<'paste' | 'file'>('paste');
  const [pastedCookies, setPastedCookies] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; failed: number; errors: { row: number; reason: string }[] } | null>(null);
  const [error, setError] = useState('');

  const handleImport = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      const formData = new FormData();
      if (mode === 'file' && file) { formData.append('file', file); }
      else if (mode === 'paste' && pastedCookies.trim()) { formData.append('cookies', pastedCookies.trim()); }
      else { setError('Please paste cookies or select a file'); setLoading(false); return; }
      const res = await bulkImport(formData) as { imported?: number; failed?: number; errors?: { row: number; reason: string }[] };
      setResult({ imported: res.imported ?? 0, failed: res.failed ?? 0, errors: res.errors ?? [] });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Import failed';
      setError(msg.includes('fetch') ? 'Cannot connect to server. Make sure the app is running (npm run dev).' : msg);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-surface-container-low border border-outline-variant rounded w-[560px] flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between shrink-0">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">Bulk Import Sessions</h2>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        {!result ? (
          <>
            <div className="p-4 flex flex-col gap-4 overflow-y-auto">
              <div className="flex gap-1 bg-surface-container-high rounded p-1">
                {(['paste', 'file'] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`flex-1 h-7 rounded text-body-sm font-semibold transition-colors ${mode === m ? 'bg-primary-container text-surface-container-lowest' : 'text-on-surface-variant hover:text-on-surface'}`}>
                    {m === 'paste' ? 'Paste Cookies' : 'Upload CSV / XLSX'}
                  </button>
                ))}
              </div>
              {mode === 'paste' && (
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">One cookie string per line</label>
                  <textarea className="w-full h-48 ide-input p-2 font-data-mono text-data-mono rounded resize-none scrollbar-hide"
                    placeholder={"c_user=111; xs=aaa; datr=xxx;\nc_user=222; xs=bbb; datr=yyy;"}
                    value={pastedCookies} onChange={e => setPastedCookies(e.target.value)} />
                  <p className="font-data-mono text-data-mono text-on-surface-variant text-[10px] mt-1">
                    {pastedCookies.trim() ? `${pastedCookies.trim().split('\n').filter(l => l.trim()).length} cookies detected` : 'Paste multiple cookies, one per line'}
                  </p>
                </div>
              )}
              {mode === 'file' && (
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-2">CSV or XLSX file</label>
                  <div className="border-2 border-dashed border-outline-variant rounded p-6 text-center cursor-pointer hover:border-primary transition-colors"
                    onClick={() => document.getElementById('bulk-file-input')?.click()}>
                    <span className="material-symbols-outlined text-[32px] text-on-surface-variant block mb-2">upload_file</span>
                    {file
                      ? <p className="text-on-surface font-body-sm">{file.name} ({(file.size / 1024).toFixed(1)} KB)</p>
                      : <p className="text-on-surface-variant font-body-sm">Click to select or drag &amp; drop</p>}
                    <p className="text-on-surface-variant font-data-mono text-data-mono text-[10px] mt-1">Columns: cookie, uid, password, twoFactorSecret, email, phoneNumber</p>
                  </div>
                  <input id="bulk-file-input" type="file" accept=".csv,.xlsx" className="hidden"
                    onChange={e => setFile(e.target.files?.[0] ?? null)} />
                </div>
              )}
              {error && <p className="text-error font-body-sm text-body-sm">{error}</p>}
            </div>
            <div className="px-4 py-3 border-t border-outline-variant flex justify-end gap-2 shrink-0">
              <button onClick={onClose} className="h-8 px-4 border border-outline-variant text-on-surface font-body-sm rounded hover:bg-surface-container-high">Cancel</button>
              <button onClick={handleImport} disabled={loading || (mode === 'paste' ? !pastedCookies.trim() : !file)}
                className="h-8 px-6 bg-primary-container text-surface-container-lowest font-body-sm font-semibold rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">{loading ? 'hourglass_empty' : 'upload'}</span>
                {loading ? 'Importing...' : 'Import'}
              </button>
            </div>
          </>
        ) : (
          <div className="p-6 flex flex-col items-center gap-4">
            <span className={`material-symbols-outlined text-[48px] ${result.imported > 0 ? 'text-primary' : 'text-error'}`}>
              {result.imported > 0 ? 'check_circle' : 'error'}
            </span>
            <div className="text-center">
              <p className="font-headline-sm text-headline-sm text-on-surface">Import Complete</p>
              <p className="font-data-mono text-data-mono text-primary mt-1">{result.imported} imported successfully</p>
              {result.failed > 0 && <p className="font-data-mono text-data-mono text-error">{result.failed} failed</p>}
            </div>
            {result.errors.length > 0 && (
              <div className="w-full bg-surface-container-high rounded p-3 max-h-32 overflow-y-auto">
                {result.errors.map((e, i) => (
                  <p key={i} className="font-data-mono text-data-mono text-error text-[10px]">Row {e.row}: {e.reason}</p>
                ))}
              </div>
            )}
            <button onClick={onClose} className="h-8 px-6 bg-primary-container text-surface-container-lowest font-body-sm font-semibold rounded hover:opacity-90">Done</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ADD SESSION MODAL
// ─────────────────────────────────────────────

function AddSessionModal({ onClose }: { onClose: () => void }) {
  const { addSession: createSession } = useStore();
  const [pasteMode, setPasteMode] = useState(false);
  const [bulkCookies, setBulkCookies] = useState('');
  const [cookie, setCookie] = useState('');
  const [uid, setUid] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorSecret, setTwoFactorSecret] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (pasteMode) {
      // Universal cookie parser — handles all known export formats:
      // Format A: "UID Password c_user=...cookie..." (one per line)
      // Format B: "c_user=...;c_user=...;" (concatenated, no prefix)
      // Format C: plain "c_user=...;" per line

      const rawText = bulkCookies.trim();
      const entries: { uid: string; password: string; cookie: string }[] = [];

      // Detect format: if any line starts with digits followed by space and c_user=, it's Format A
      const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
      const isFormatA = lines.some(l => /^\d{10,}\s+\S+\s*c_user=/.test(l));

      if (isFormatA) {
        // Format A: each line = "UID Password c_user=...cookie..."
        for (const line of lines) {
          const cUserIdx = line.indexOf('c_user=');
          if (cUserIdx === -1) continue;
          const prefix = line.slice(0, cUserIdx).trim();
          const cookie = line.slice(cUserIdx);
          const parts = prefix.split(/\s+/);
          const uid = (parts.length >= 2 && /^\d{10,}$/.test(parts[0])) ? parts[0] : '';
          const password = (uid && parts.length >= 2) ? parts[1] : '';
          entries.push({ uid, password, cookie });
        }
      } else {
        // Format B/C: split on c_user= boundaries (works for both concatenated and per-line)
        const flat = rawText.replace(/\n/g, '').replace(/\r/g, '');
        const parts = flat.split(/(?=c_user=)/).map(s => s.replace(/^[;\s]+/, '').trim()).filter(s => s.includes('c_user='));
        for (const part of parts) {
          const uidMatch = part.match(/c_user=(\d+)/);
          entries.push({ uid: uidMatch ? uidMatch[1] : '', password: '', cookie: part });
        }
      }

      if (!entries.length) { setError('Paste at least one cookie'); return; }
      setLoading(true); setError('');
      let failed = 0;
      const errors: string[] = [];
      for (const entry of entries) {
        const res = await createSession({
          cookie: entry.cookie.trim(),
          uid: entry.uid || undefined,
          password: entry.password || undefined,
        });
        if (!res.success) {
          failed++;
          if (res.error) errors.push(res.error);
        }
      }
      setLoading(false);
      if (failed > 0) {
        const uniqueErrors = Array.from(new Set(errors));
        setError(`${failed} of ${entries.length} cookies failed${uniqueErrors.length ? ': ' + uniqueErrors[0] : ''}`);
      } else {
        onClose();
      }
      return;
    }
    if (!cookie.trim()) { setError('Cookie is required'); return; }
    setLoading(true); setError('');
    const res = await createSession({
      cookie: cookie.trim(),
      uid: uid.trim() || undefined,
      password: password || undefined,
      twoFactorSecret: twoFactorSecret || undefined,
      email: email || undefined,
      phoneNumber: phone || undefined,
    });
    setLoading(false);
    if (res.success) onClose();
    else setError(res.error ?? 'Failed to add session');
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-surface-container-low border border-outline-variant rounded w-[500px] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-outline-variant flex items-center justify-between">
          <h2 className="font-headline-sm text-headline-sm text-on-surface">Add Session</h2>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          {/* Mode toggle */}
          <div className="flex gap-1 bg-surface-container-high rounded p-1">
            {([false, true] as const).map(m => (
              <button key={String(m)} onClick={() => setPasteMode(m)}
                className={`flex-1 h-7 rounded text-body-sm font-semibold transition-colors ${pasteMode === m ? 'bg-primary-container text-surface-container-lowest' : 'text-on-surface-variant hover:text-on-surface'}`}>
                {m ? 'Paste Multiple' : 'Single Session'}
              </button>
            ))}
          </div>

          {pasteMode ? (
            <div>
              <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">One cookie per line</label>
              <textarea className="w-full h-40 ide-input p-2 font-data-mono text-data-mono rounded resize-none scrollbar-hide"
                placeholder={"c_user=111; xs=aaa;\nc_user=222; xs=bbb;"}
                value={bulkCookies} onChange={e => setBulkCookies(e.target.value)} />
              <p className="font-data-mono text-data-mono text-on-surface-variant text-[10px] mt-1">
                {bulkCookies.trim() ? (() => {
                  const lines = bulkCookies.trim().split('\n').map(l => l.trim()).filter(Boolean);
                  const isFormatA = lines.some(l => /^\d{10,}\s+\S+\s*c_user=/.test(l));
                  let count: number;
                  if (isFormatA) {
                    count = lines.filter(l => l.includes('c_user=')).length;
                  } else {
                    const flat = bulkCookies.replace(/\n/g, '');
                    count = (flat.match(/c_user=/g) || []).length;
                  }
                  return `${count} cookie${count !== 1 ? 's' : ''} detected`;
                })() : 'Paste cookies, one per line'}
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Cookie String <span className="text-error">*</span></label>
                <textarea className="w-full h-20 ide-input p-2 font-data-mono text-data-mono rounded resize-none scrollbar-hide"
                  placeholder="c_user=123456; xs=abc; datr=xyz; sb=..."
                  value={cookie} onChange={e => setCookie(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">UID</label>
                  <input className="w-full h-8 ide-input px-2 font-data-mono text-data-mono rounded" placeholder="123456789" value={uid} onChange={e => setUid(e.target.value)} />
                </div>
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">2FA Secret</label>
                  <input className="w-full h-8 ide-input px-2 font-data-mono text-data-mono rounded" placeholder="JBSWY3DPEHPK3PXP" value={twoFactorSecret} onChange={e => setTwoFactorSecret(e.target.value)} />
                </div>
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Password</label>
                  <input type="password" className="w-full h-8 ide-input px-2 font-data-mono text-data-mono rounded" value={password} onChange={e => setPassword(e.target.value)} />
                </div>
                <div>
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Email</label>
                  <input className="w-full h-8 ide-input px-2 font-data-mono text-data-mono rounded" placeholder="user@gmail.com" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="font-label-caps text-label-caps text-on-surface-variant block mb-1">Phone</label>
                  <input className="w-full h-8 ide-input px-2 font-data-mono text-data-mono rounded" placeholder="+1 555 000 0000" value={phone} onChange={e => setPhone(e.target.value)} />
                </div>
              </div>
            </>
          )}
          {error && <p className="text-error font-body-sm text-body-sm">{error}</p>}
          <p className="font-data-mono text-data-mono text-on-surface-variant text-[10px]">After adding, the auto-scraper will harvest all profile data in the background.</p>
        </div>
        <div className="px-4 py-3 border-t border-outline-variant flex justify-end gap-2">
          <button onClick={onClose} className="h-8 px-4 border border-outline-variant text-on-surface font-body-sm rounded hover:bg-surface-container-high">Cancel</button>
          <button onClick={handleSubmit} disabled={loading || (pasteMode ? !bulkCookies.trim() : !cookie.trim())}
            className="h-8 px-6 bg-primary-container text-surface-container-lowest font-body-sm font-semibold rounded hover:opacity-90 disabled:opacity-50 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">{loading ? 'hourglass_empty' : 'add'}</span>
            {loading ? 'Adding...' : 'Add Session'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// EXPANDABLE SECTION (used in detail panel)
// ─────────────────────────────────────────────

function ExpandableSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-outline-variant rounded overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 bg-surface-container-high hover:bg-surface-container-highest transition-colors">
        <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">{title}</span>
        <div className="flex items-center gap-2">
          <span className="font-data-mono text-data-mono text-primary font-bold">{count}</span>
          <span className="material-symbols-outlined text-[14px] text-on-surface-variant">{open ? 'expand_less' : 'expand_more'}</span>
        </div>
      </button>
      {open && <div className="overflow-x-auto">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────
// DETAIL PANEL
// ─────────────────────────────────────────────

function DetailPanel({ session, onClose }: { session: Session; onClose: () => void }) {
  const { launchSession, closeSession, checkHealth, scrapeSession, deleteSession } = useStore();
  const [showCookie, setShowCookie] = useState(false);

  const bms     = parseJsonArray<BMRecord>(session.bmData);
  const pages   = parseJsonArray<PageRecord>(session.ownedPagesData);
  const groups  = parseJsonArray<GroupRecord>(session.joinedGroupsData);

  return (
    <div className="w-[340px] bg-surface-container-low border-l border-outline-variant flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-outline-variant flex items-center justify-between bg-surface-container-lowest">
        <h2 className="font-headline-sm text-headline-sm text-primary truncate">{displayName(session)}</h2>
        <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 font-data-mono text-data-mono">
        {/* Action buttons */}
        <div className="flex gap-1">
          <button onClick={() => session.isRunning ? closeSession(session.id) : launchSession(session.id)}
            className="flex-1 h-7 bg-primary-container text-surface-container-lowest rounded text-[11px] font-semibold hover:opacity-90">
            {session.isRunning ? 'Close' : 'Launch'}
          </button>
          <button onClick={() => checkHealth(session.id)}
            className="flex-1 h-7 border border-outline-variant text-on-surface rounded text-[11px] hover:bg-surface-container-high">
            Check Health
          </button>
          <button onClick={() => scrapeSession(session.id)}
            className="flex-1 h-7 border border-outline-variant text-on-surface rounded text-[11px] hover:bg-surface-container-high">
            Re-scrape
          </button>
        </div>
        <button onClick={() => { deleteSession(session.id); onClose(); }}
          className="w-full h-7 border border-error/30 text-error rounded text-[11px] hover:bg-error/10 flex items-center justify-center gap-1">
          <span className="material-symbols-outlined text-[14px]">delete</span> Delete Session
        </button>

        {/* Health */}
        <div className="flex justify-between items-center border-b border-outline-variant pb-1">
          <span className="text-on-surface-variant">Health</span>
          <div className="flex items-center gap-1">
            <HealthBadge status={session.healthStatus} verified={session.scrapingStatus === 'done'} />
            {session.lastCheck
              ? <span className="text-[9px] text-on-surface-variant">{new Date(session.lastCheck).toLocaleTimeString()}</span>
              : <span className="text-[9px] text-on-surface-variant italic">unverified</span>}
          </div>
        </div>

        {/* Editable fields */}
        <EditableField label="FB Name"    value={isRealName(session.fbName) ? session.fbName : ''} sessionId={session.id} field="fbName" />
        <EditableField label="UID"        value={session.uid}             sessionId={session.id} field="uid" />
        <EditableField label="Email"      value={session.email}           sessionId={session.id} field="email" />
        <EditableField label="Phone"      value={session.phoneNumber}     sessionId={session.id} field="phoneNumber" />
        <EditableField label="Country"    value={session.country}         sessionId={session.id} field="country" />
        <EditableField label="Password"   value={session.password}        sessionId={session.id} field="password" type="password" />
        <EditableField label="2FA Secret" value={session.twoFactorSecret} sessionId={session.id} field="twoFactorSecret" />

        {/* Read-only scraped fields */}
        {([
          ['Gender',    session.gender],
          ['Created',   session.creationDate],
          ['Friends',   session.friendsCount?.toLocaleString()],
          ['BM Count',  session.bmCount],
          ['Groups',    session.groupsJoinedCount],
          ['Pro Mode',  session.professionalMode ? 'Yes' : 'No'],
          ['Monetized', session.monetizationStatus ? 'Yes' : 'No'],
          ['Ad Account', session.adAccountId],
          ['Currency',  session.currency],
          ['Scraped',   session.scrapedAt ? new Date(session.scrapedAt).toLocaleString() : null],
        ] as [string, string | number | null | undefined][]).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => (
          <div key={String(k)} className="flex justify-between border-b border-outline-variant pb-1">
            <span className="text-on-surface-variant">{k}</span>
            <span className="text-on-surface truncate ml-2">{String(v)}</span>
          </div>
        ))}

        {/* Cookie */}
        <div className="border-b border-outline-variant pb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-on-surface-variant">Cookie</span>
            <div className="flex items-center gap-1">
              <CopyButton value={session.cookie} label="cookie" />
              <button onClick={() => setShowCookie(v => !v)} className="text-on-surface-variant hover:text-primary">
                <span className="material-symbols-outlined text-[12px]">{showCookie ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
          </div>
          {showCookie
            ? <div className="bg-surface-container-highest rounded p-2 text-[9px] text-on-surface-variant break-all max-h-24 overflow-y-auto scrollbar-hide">{session.cookie}</div>
            : <div className="text-[9px] text-on-surface-variant italic">Click eye to reveal • Click copy to copy</div>}
        </div>

        {/* Profile URL */}
        {session.profileUrl && (
          <div className="flex justify-between items-center border-b border-outline-variant pb-1">
            <span className="text-on-surface-variant">Profile</span>
            <div className="flex items-center gap-1">
              <a href={session.profileUrl} target="_blank" rel="noreferrer"
                className="text-primary hover:underline text-[10px] truncate max-w-[140px]">
                {session.profileUrl.replace('https://www.facebook.com/', 'fb.com/')}
              </a>
              <CopyButton value={session.profileUrl} label="profile URL" />
            </div>
          </div>
        )}

        {/* Expandable: Business Managers */}
        <ExpandableSection title="Business Managers" count={bms.length}>
          <table className="w-full text-[10px] font-data-mono">
            <thead><tr className="bg-surface-container-highest text-on-surface-variant">
              <th className="px-2 py-1 text-left">Name</th>
              <th className="px-2 py-1 text-left">ID</th>
              <th className="px-2 py-1 text-left">Role</th>
              <th className="px-2 py-1 text-right">Ad Accts</th>
            </tr></thead>
            <tbody>
              {bms.length === 0
                ? <tr><td colSpan={4} className="px-2 py-2 text-center text-on-surface-variant">No BMs scraped</td></tr>
                : bms.map((bm, i) => (
                  <tr key={i} className="border-t border-outline-variant">
                    <td className="px-2 py-1 truncate max-w-[80px]">{bm.name}</td>
                    <td className="px-2 py-1 text-on-surface-variant">{bm.id}</td>
                    <td className="px-2 py-1 text-secondary">{bm.role}</td>
                    <td className="px-2 py-1 text-right text-primary font-bold">{bm.adAccountCount}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </ExpandableSection>

        {/* Expandable: Pages */}
        <ExpandableSection title="Owned Pages" count={pages.length}>
          <table className="w-full text-[10px] font-data-mono">
            <thead><tr className="bg-surface-container-highest text-on-surface-variant">
              <th className="px-2 py-1 text-left">Name</th>
              <th className="px-2 py-1 text-left">Category</th>
              <th className="px-2 py-1 text-right">Likes</th>
            </tr></thead>
            <tbody>
              {pages.length === 0
                ? <tr><td colSpan={3} className="px-2 py-2 text-center text-on-surface-variant">No pages scraped</td></tr>
                : pages.map((pg, i) => (
                  <tr key={i} className="border-t border-outline-variant">
                    <td className="px-2 py-1 truncate max-w-[100px]">
                      <a href={pg.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{pg.name}</a>
                    </td>
                    <td className="px-2 py-1 text-on-surface-variant truncate">{pg.category}</td>
                    <td className="px-2 py-1 text-right">{pg.likes.toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </ExpandableSection>

        {/* Expandable: Groups */}
        <ExpandableSection title="Joined Groups" count={groups.length}>
          <table className="w-full text-[10px] font-data-mono">
            <thead><tr className="bg-surface-container-highest text-on-surface-variant">
              <th className="px-2 py-1 text-left">Name</th>
              <th className="px-2 py-1 text-left">Role</th>
              <th className="px-2 py-1 text-right">Members</th>
            </tr></thead>
            <tbody>
              {groups.length === 0
                ? <tr><td colSpan={3} className="px-2 py-2 text-center text-on-surface-variant">No groups scraped</td></tr>
                : groups.map((g, i) => (
                  <tr key={i} className="border-t border-outline-variant">
                    <td className="px-2 py-1 truncate max-w-[100px]">
                      <a href={g.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{g.name}</a>
                    </td>
                    <td className="px-2 py-1 text-secondary">{g.role}</td>
                    <td className="px-2 py-1 text-right">{g.memberCount.toLocaleString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </ExpandableSection>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SORT TYPES
// ─────────────────────────────────────────────

type SortKey = 'fbName' | 'healthStatus' | 'scrapingStatus' | 'country' | 'friendsCount' | 'bmCount' | 'pagesFollowingCount' | 'groupsJoinedCount';
type SortDir = 'asc' | 'desc';

function sortSessions(sessions: Session[], key: SortKey, dir: SortDir): Session[] {
  return [...sessions].sort((a, b) => {
    let av: string | number = '';
    let bv: string | number = '';
    if (key === 'fbName') { av = displayName(a).toLowerCase(); bv = displayName(b).toLowerCase(); }
    else if (key === 'friendsCount' || key === 'bmCount' || key === 'pagesFollowingCount' || key === 'groupsJoinedCount') {
      av = (a[key] as number) ?? 0; bv = (b[key] as number) ?? 0;
    } else {
      av = (a[key] as string) ?? ''; bv = (b[key] as string) ?? '';
    }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ─────────────────────────────────────────────
// SORTABLE HEADER CELL
// ─────────────────────────────────────────────

function SortTh({
  label, sortKey, current, dir, onSort, className,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey | null;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = current === sortKey;
  return (
    <th className={`cursor-pointer select-none hover:text-on-surface transition-colors ${className ?? ''}`}
      onClick={() => onSort(sortKey)}>
      <span className="inline-flex items-center gap-0.5">
        {label}
        {active && (
          <span className="material-symbols-outlined text-[10px] text-primary">
            {dir === 'asc' ? 'arrow_upward' : 'arrow_downward'}
          </span>
        )}
      </span>
    </th>
  );
}

// ─────────────────────────────────────────────
// VIRTUALIZED TABLE BODY
// ─────────────────────────────────────────────

/**
 * Renders only the rows visible in the scroll viewport plus OVERSCAN_ROWS above/below.
 * Uses a single scrollable container with a tall spacer div — no external library needed.
 */
function VirtualTableBody({
  rows,
  selectedIds,
  selectedSessionId,
  onToggleSelect,
  onRowClick,
  proxies,
}: {
  rows: Session[];
  selectedIds: Set<string>;
  selectedSessionId: string | null;
  onToggleSelect: (id: string, e: React.MouseEvent) => void;
  onRowClick: (id: string) => void;
  proxies: { id: string; host: string }[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    setContainerHeight(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const totalHeight = rows.length * ROW_HEIGHT_PX;
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT_PX) - OVERSCAN_ROWS);
  const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT_PX) + OVERSCAN_ROWS * 2;
  const endIdx = Math.min(rows.length, startIdx + visibleCount);
  const visibleRows = rows.slice(startIdx, endIdx);
  const offsetTop = startIdx * ROW_HEIGHT_PX;

  return (
    <div ref={containerRef} className="flex-1 overflow-auto bg-surface" onScroll={handleScroll}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        <table className="w-full text-left border-collapse dense-table font-data-mono text-data-mono"
          style={{ position: 'absolute', top: offsetTop, left: 0, right: 0 }}>
          <tbody>
            {visibleRows.map(s => {
              const healthVerified = s.scrapingStatus === 'done' || (s.lastCheck != null && s.lastCheck > 0);
              const proxy = proxies.find(p => p.id === s.proxyId);
              const isSelected = s.id === selectedSessionId;
              return (
                <tr key={s.id}
                  style={{ height: ROW_HEIGHT_PX }}
                  onClick={() => onRowClick(s.id)}
                  className={`border-b border-outline-variant hover:bg-surface-container-low cursor-pointer ${isSelected ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}>
                  {/* Checkbox */}
                  <td className="w-[32px] text-center px-1" onClick={e => onToggleSelect(s.id, e)}>
                    <input type="checkbox" checked={selectedIds.has(s.id)} onChange={() => {}}
                      className="w-3 h-3 rounded-[2px] border-outline-variant bg-surface-container-lowest text-primary cursor-pointer pointer-events-none" />
                  </td>
                  {/* Avatar */}
                  <td className="w-[28px]">
                    <div className="w-5 h-5 rounded-full bg-surface-container-highest border border-outline-variant flex items-center justify-center text-[8px] font-bold text-on-surface-variant">
                      {displayName(s).charAt(0).toUpperCase()}
                    </div>
                  </td>
                  {/* FB Name */}
                  <td className="min-w-[120px] text-on-surface font-medium truncate max-w-[160px]">{displayName(s)}</td>
                  {/* UID */}
                  <td className="w-[120px] text-on-surface-variant truncate">{s.uid && /^\d+$/.test(s.uid) ? s.uid : <span className="opacity-40">—</span>}</td>
                  {/* Health */}
                  <td className="w-[80px]"><HealthBadge status={s.healthStatus} verified={healthVerified} /></td>
                  {/* Scraping */}
                  <td className="w-[80px]"><ScrapingBadge status={s.scrapingStatus} /></td>
                  {/* Country */}
                  <td className="w-[50px] text-on-surface-variant">{s.country !== 'Unknown' ? s.country : <span className="opacity-40">—</span>}</td>
                  {/* Friends */}
                  <td className="w-[50px] text-right text-on-surface">{s.friendsCount > 0 ? s.friendsCount.toLocaleString() : <span className="opacity-40">—</span>}</td>
                  {/* BMs */}
                  <td className="w-[36px] text-right text-primary font-bold">{s.bmCount ?? 0}</td>
                  {/* Pages */}
                  <td className="w-[36px] text-right text-on-surface">{s.pagesFollowingCount ?? 0}</td>
                  {/* Groups */}
                  <td className="w-[36px] text-right text-on-surface">{s.groupsJoinedCount ?? 0}</td>
                  {/* Pro Mode */}
                  <td className="w-[40px] text-center">
                    {s.professionalMode
                      ? <span className="material-symbols-outlined text-[12px] text-primary">verified</span>
                      : <span className="opacity-30 text-[10px]">—</span>}
                  </td>
                  {/* Monetization */}
                  <td className="w-[44px] text-center">
                    {s.monetizationStatus
                      ? <span className="material-symbols-outlined text-[12px] text-secondary">monetization_on</span>
                      : <span className="opacity-30 text-[10px]">—</span>}
                  </td>
                  {/* Ad Account */}
                  <td className="w-[80px] text-on-surface-variant truncate text-[10px]">
                    {s.adAccountId ? <span className="text-tertiary">{s.adAccountId}</span> : <span className="opacity-40">—</span>}
                  </td>
                  {/* Proxy */}
                  <td className="w-[80px] text-on-surface-variant truncate text-[10px]">
                    {proxy ? <span className="text-secondary">{proxy.host}</span> : <span className="opacity-40">—</span>}
                  </td>
                  {/* Last Scraped */}
                  <td className="w-[80px] text-on-surface-variant text-[10px]">
                    {s.scrapedAt ? new Date(s.scrapedAt).toLocaleTimeString() : '—'}
                  </td>
                  {/* Actions menu */}
                  <td className="w-[32px] text-center relative" onClick={e => e.stopPropagation()}>
                    <button onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === s.id ? null : s.id); }}
                      className="text-on-surface-variant hover:text-on-surface p-0.5 rounded hover:bg-surface-container-high">
                      <span className="material-symbols-outlined text-[14px]">more_vert</span>
                    </button>
                    {openMenuId === s.id && (
                      <RowActionMenu session={s} onClose={() => setOpenMenuId(null)} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN VIEW
// ─────────────────────────────────────────────

/**
 * AccountsView — full-featured session management table.
 *
 * Features:
 * - Summary bar with color-coded health/scraping counts
 * - Search (fbName, uid, email, phone) + country filter dropdown
 * - Virtualized table for 1000+ rows (CSS overflow + fixed row height)
 * - Column sort on click
 * - Multi-select with checkboxes + bulk action bar
 * - Per-row action menu (Launch, Check Health, Re-scrape, Delete)
 * - Row click → slide-in detail panel with expandable BM/Page/Group tables
 * - Add Session modal (single + paste-multiple modes)
 * - Bulk Import modal (paste cookies or upload CSV/XLSX)
 * - Polls every 3s only when any session is actively scraping
 */
export function AccountsView() {
  const {
    sessions, fetchSessions, scrapeSession, deleteSession,
    selectedSessionId, setSelectedSession, proxies, fetchProxies,
  } = useStore();

  const [search, setSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [healthFilter, setHealthFilter] = useState<'all' | 'active' | 'restricted' | 'checkpoint'>('all');
  const [gridView, setGridView] = useState(false);

  // Initial load
  useEffect(() => {
    fetchSessions();
    fetchProxies();
  }, []);

  // Poll every 3s only while at least one session is actively scraping.
  // Stops automatically when all scraping finishes — avoids idle polling overhead.
  useEffect(() => {
    const hasScraping = sessions.some(s => s.scrapingStatus === 'scraping');
    if (!hasScraping) return;
    const id = setInterval(fetchSessions, SCRAPING_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sessions]);

  // ── Derived country list for filter dropdown ──
  const countries = Array.from(new Set(sessions.map(s => s.country).filter(c => c && c !== 'Unknown'))).sort();

  // ── Filter ──────────────────────────────────
  const filtered = sessions.filter(s => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      displayName(s).toLowerCase().includes(q) ||
      (s.uid ?? '').includes(q) ||
      (s.email ?? '').toLowerCase().includes(q) ||
      (s.phoneNumber ?? '').includes(q);
    const matchCountry = !countryFilter || s.country === countryFilter;
    const matchHealth = healthFilter === 'all' ||
      (healthFilter === 'active' && (s.healthStatus === 'live' || s.healthStatus === 'warming')) ||
      (healthFilter === 'restricted' && s.healthStatus === 'restricted') ||
      (healthFilter === 'checkpoint' && s.healthStatus === 'checkpoint');
    return matchSearch && matchCountry && matchHealth;
  });

  // ── Sort ─────────────────────────────────────
  const sorted = sortKey ? sortSessions(filtered, sortKey, sortDir) : filtered;

  // ── Summary counts ───────────────────────────
  const live       = sessions.filter(s => s.healthStatus === 'live').length;
  const checkpoint = sessions.filter(s => s.healthStatus === 'checkpoint').length;
  const restricted = sessions.filter(s => s.healthStatus === 'restricted').length;
  const dead       = sessions.filter(s => s.healthStatus === 'dead').length;
  const banned     = sessions.filter(s => s.healthStatus === 'banned').length;
  const warming    = sessions.filter(s => s.healthStatus === 'warming').length;
  const scraping   = sessions.filter(s => s.scrapingStatus === 'scraping').length;
  const failed     = sessions.filter(s => s.scrapingStatus === 'failed').length;

  // ── Checkbox logic ───────────────────────────
  const allFilteredIds = sorted.map(s => s.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selected.has(id));
  const someSelected = allFilteredIds.some(id => selected.has(id)) && !allSelected;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); allFilteredIds.forEach(id => n.delete(id)); return n; });
    } else {
      setSelected(prev => new Set([...Array.from(prev), ...allFilteredIds]));
    }
  };

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const selectedSession = sessions.find(s => s.id === selectedSessionId);
  const proxyList = proxies.map(p => ({ id: p.id, host: p.host }));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* ── Toolbar Row ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 px-5 py-3 bg-surface border-b border-outline-variant shrink-0">
        {/* Left: title + stat pills */}
        <div className="flex items-center gap-4">
          <h2 className="text-[18px] font-semibold text-on-surface">Accounts</h2>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-lg bg-surface-container-high border border-outline-variant text-[11px] font-semibold text-on-surface">
              Total: {sessions.length.toLocaleString()}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-surface-container-high border border-outline-variant text-[11px] font-semibold text-on-surface flex items-center gap-1.5">
              Live: {live} <span className="w-1.5 h-1.5 rounded-full bg-[#00b894]" />
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-surface-container-high border border-outline-variant text-[11px] font-semibold text-on-surface flex items-center gap-1.5">
              Checkpoint: {checkpoint} <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-surface-container-high border border-outline-variant text-[11px] font-semibold text-on-surface flex items-center gap-1.5">
              Dead: {dead + banned} <span className="w-1.5 h-1.5 rounded-full bg-error" />
            </span>
            {scraping > 0 && (
              <span className="px-2.5 py-1 rounded-lg bg-tertiary/10 border border-tertiary/20 text-[11px] font-semibold text-tertiary flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[12px] animate-spin">sync</span>
                Scraping: {scraping}
              </span>
            )}
          </div>
        </div>
        {/* Right: CTAs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBulkModal(true)}
            className="px-3 py-2 border border-outline-variant text-primary rounded-lg text-[13px] font-semibold hover:bg-surface-container transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">file_upload</span>
            Bulk Import
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-3 py-2 bg-primary-container text-on-primary rounded-lg text-[13px] font-semibold hover:opacity-90 transition-opacity flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[16px]">person_add</span>
            Add Account
          </button>
        </div>
      </div>

      {/* ── Sub-toolbar Row ──────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 px-5 py-2.5 bg-surface border-b border-outline-variant shrink-0">
        {/* Left: filter tabs + dropdowns */}
        <div className="flex items-center gap-3">
          {/* Pill group tabs */}
          <div className="flex p-1 bg-surface-container-high rounded-lg border border-outline-variant">
            {([
              { key: 'all',        label: 'All',        count: sessions.length },
              { key: 'active',     label: 'Active',     count: live + warming },
              { key: 'restricted', label: 'Restricted', count: restricted },
              { key: 'checkpoint', label: 'Checkpoint', count: checkpoint },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setHealthFilter(tab.key)}
                className={`px-3 py-1 text-[12px] font-medium rounded-md transition-colors ${
                  healthFilter === tab.key
                    ? 'bg-surface-container-lowest text-primary shadow-sm'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {tab.label}
                <span className={`ml-1.5 text-[10px] ${healthFilter === tab.key ? 'opacity-70' : 'opacity-50'}`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Country filter */}
          <select
            value={countryFilter}
            onChange={e => setCountryFilter(e.target.value)}
            className="bg-surface-container-lowest border border-outline-variant text-on-surface rounded-lg px-3 py-1.5 text-[13px] focus:border-primary outline-none"
          >
            <option value="">Country: All</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Sort dropdown */}
          <select
            value={sortKey ?? ''}
            onChange={e => { const v = e.target.value as SortKey | ''; if (v) { setSortKey(v); setSortDir('asc'); } else setSortKey(null); }}
            className="bg-surface-container-lowest border border-outline-variant text-on-surface rounded-lg px-3 py-1.5 text-[13px] focus:border-primary outline-none"
          >
            <option value="">Sort by…</option>
            <option value="fbName">Name</option>
            <option value="healthStatus">Health</option>
            <option value="friendsCount">Friends</option>
            <option value="bmCount">BMs</option>
            <option value="country">Country</option>
          </select>
        </div>

        {/* Right: search + view toggle */}
        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <span className="material-symbols-outlined absolute left-3 text-outline text-[16px]">search</span>
            <input
              className="bg-surface-container-lowest border border-outline-variant rounded-lg pl-9 pr-3 py-1.5 text-[13px] focus:border-primary focus:ring-1 focus:ring-primary/20 outline-none w-56"
              placeholder="Search name, UID, email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {/* View toggle */}
          <div className="flex p-1 bg-surface-container-high rounded-lg border border-outline-variant">
            <button
              onClick={() => setGridView(false)}
              className={`p-1.5 rounded-md transition-colors ${!gridView ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant'}`}
            >
              <span className="material-symbols-outlined text-[18px]">format_list_bulleted</span>
            </button>
            <button
              onClick={() => setGridView(true)}
              className={`p-1.5 rounded-md transition-colors ${gridView ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant'}`}
            >
              <span className="material-symbols-outlined text-[18px]">grid_view</span>
            </button>
          </div>
        </div>
      </div>
      {/* ── Bulk action bar ──────────────────────── */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-5 py-2 bg-primary/5 border-b border-primary/20 shrink-0">
          <span className="text-[13px] text-on-surface font-semibold">{selected.size} selected</span>
          <button onClick={() => { selected.forEach(id => scrapeSession(id)); }}
            className="h-7 px-3 border border-outline-variant bg-surface-container-lowest text-on-surface text-[12px] rounded-lg hover:bg-surface-container transition-colors flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px]">sync</span> Re-scrape
          </button>
          <button onClick={() => { selected.forEach(id => deleteSession(id)); setSelected(new Set()); }}
            className="h-7 px-3 border border-error/40 bg-transparent text-error text-[12px] rounded-lg hover:bg-error/10 transition-colors flex items-center gap-1">
            <span className="material-symbols-outlined text-[13px]">delete</span> Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-on-surface-variant hover:text-on-surface">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* ── Main Content ─────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden px-4 py-3 gap-4">

      {/* ── Grid View ───────────────────────────── */}
      {gridView && (
        <div className="grid grid-cols-3 gap-4">
          {sorted.map(s => {
            const healthVerified = s.scrapingStatus === 'done' || (s.lastCheck != null && s.lastCheck > 0);
            const proxy = proxyList.find(p => p.id === s.proxyId);
            const healthScore = s.healthStatus === 'live' ? 30 : s.healthStatus === 'warming' ? 50 : s.healthStatus === 'checkpoint' ? 70 : s.healthStatus === 'restricted' ? 85 : 95;
            return (
              <ContentCard
                key={s.id}
                hover
                className={`cursor-pointer ${s.id === selectedSessionId ? 'ring-2 ring-primary' : ''}`}
              >
                <div className="flex items-start justify-between mb-3" onClick={() => setSelectedSession(s.id === selectedSessionId ? null : s.id)}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-surface-container-high border border-outline-variant flex items-center justify-center text-body-md font-bold text-on-surface-variant">
                      {displayName(s).charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-body-md font-medium text-on-surface truncate max-w-[140px]">{displayName(s)}</p>
                      <p className="text-label-sm text-on-surface-variant font-mono">{s.uid || '—'}</p>
                    </div>
                  </div>
                  <StatusBadge
                    status={
                      s.healthStatus === 'live' ? 'live' :
                      s.healthStatus === 'checkpoint' ? 'checkpoint' :
                      s.healthStatus === 'restricted' ? 'restricted' :
                      s.healthStatus === 'dead' || s.healthStatus === 'banned' ? 'dead' : 'idle'
                    }
                    size="sm"
                  />
                </div>
                <div className="space-y-2" onClick={() => setSelectedSession(s.id === selectedSessionId ? null : s.id)}>
                  <div className="flex items-center justify-between text-label-sm">
                    <span className="text-on-surface-variant">Health Score</span>
                    <span className="text-on-surface font-medium">{100 - healthScore}%</span>
                  </div>
                  <ProgressBar value={100 - healthScore} />
                  <div className="flex items-center justify-between text-label-sm text-on-surface-variant mt-2">
                    <span className="font-mono">{proxy ? proxy.host : '—'}</span>
                    <span>{s.scrapedAt ? new Date(s.scrapedAt).toLocaleDateString() : '—'}</span>
                  </div>
                </div>
              </ContentCard>
            );
          })}
          {sorted.length === 0 && (
            <div className="col-span-3 flex items-center justify-center py-16 text-on-surface-variant text-body-md">
              {sessions.length === 0 ? 'No sessions yet. Click "Add Account" to import one.' : 'No sessions match your filters.'}
            </div>
          )}
        </div>
      )}

      {/* ── Table View ──────────────────────────── */}
      {!gridView && (
        <ContentCard padding="sm" className="rounded-xl flex flex-col overflow-hidden p-0">
          {/* Table + Detail Panel wrapper */}
          <div className="flex flex-1 overflow-hidden" style={{ minHeight: 400 }}>
            {/* Sticky header + virtualized body */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Sticky header */}
              <div className="bg-surface-container-high border-b border-outline-variant shrink-0 overflow-hidden">
                <table className="w-full text-left border-collapse dense-table font-data-mono text-data-mono">
                  <thead>
                    <tr className="font-label-caps text-label-caps text-on-surface-variant uppercase">
                      <th className="w-[32px] text-center px-1">
                        <input type="checkbox" checked={allSelected}
                          ref={el => { if (el) el.indeterminate = someSelected; }}
                          onChange={toggleSelectAll}
                          className="w-3 h-3 rounded-[2px] border-outline-variant bg-surface-container-lowest text-primary cursor-pointer" />
                      </th>
                      <th className="w-[28px]">Av</th>
                      <SortTh label="FB Name"  sortKey="fbName"            current={sortKey} dir={sortDir} onSort={handleSort} className="min-w-[120px]" />
                      <th className="w-[120px]">UID</th>
                      <SortTh label="Health"   sortKey="healthStatus"      current={sortKey} dir={sortDir} onSort={handleSort} className="w-[80px]" />
                      <SortTh label="Scraping" sortKey="scrapingStatus"    current={sortKey} dir={sortDir} onSort={handleSort} className="w-[80px]" />
                      <SortTh label="Geo"      sortKey="country"           current={sortKey} dir={sortDir} onSort={handleSort} className="w-[50px]" />
                      <SortTh label="Frnd"     sortKey="friendsCount"      current={sortKey} dir={sortDir} onSort={handleSort} className="w-[50px] text-right" />
                      <SortTh label="BM"       sortKey="bmCount"           current={sortKey} dir={sortDir} onSort={handleSort} className="w-[36px] text-right" />
                      <SortTh label="Pg"       sortKey="pagesFollowingCount" current={sortKey} dir={sortDir} onSort={handleSort} className="w-[36px] text-right" />
                      <SortTh label="Grp"      sortKey="groupsJoinedCount" current={sortKey} dir={sortDir} onSort={handleSort} className="w-[36px] text-right" />
                      <th className="w-[40px] text-center">Pro</th>
                      <th className="w-[44px] text-center">Mnt</th>
                      <th className="w-[80px]">Ad Acct</th>
                      <th className="w-[80px]">Proxy</th>
                      <th className="w-[80px]">Scraped</th>
                      <th className="w-[32px]"></th>
                    </tr>
                  </thead>
                </table>
              </div>

              {/* Empty state */}
              {sorted.length === 0 && (
                <div className="flex-1 flex items-center justify-center py-16 text-on-surface-variant text-body-md">
                  {sessions.length === 0
                    ? 'No sessions yet. Click "Add Account" to import one.'
                    : 'No sessions match your filters.'}
                </div>
              )}

              {/* Virtualized rows */}
              {sorted.length > 0 && (
                <VirtualTableBody
                  rows={sorted}
                  selectedIds={selected}
                  selectedSessionId={selectedSessionId}
                  onToggleSelect={toggleSelect}
                  onRowClick={id => setSelectedSession(id === selectedSessionId ? null : id)}
                  proxies={proxyList}
                />
              )}
            </div>

            {/* Slide-in detail panel */}
            {selectedSession && (
              <DetailPanel session={selectedSession} onClose={() => setSelectedSession(null)} />
            )}
          </div>

          {/* Pagination footer */}
          <div className="border-t border-outline-variant px-5 py-3 flex items-center justify-between bg-surface-container-lowest shrink-0">
            <span className="text-label-md text-on-surface-variant">
              Showing {sorted.length.toLocaleString()} of {sessions.length.toLocaleString()} accounts
            </span>
            <div className="flex items-center gap-2 text-label-md text-on-surface-variant">
              <span className="font-mono">{live} live</span>
              <span>·</span>
              <span className="font-mono">{checkpoint} checkpoint</span>
              <span>·</span>
              <span className="font-mono">{restricted} restricted</span>
              <span>·</span>
              <span className="font-mono">{dead + banned} dead</span>
            </div>
          </div>
        </ContentCard>
      )}

      {showAddModal  && <AddSessionModal  onClose={() => setShowAddModal(false)} />}
      {showBulkModal && <BulkImportModal  onClose={() => { setShowBulkModal(false); fetchSessions(); }} />}
      </div>
    </div>
  );
}
