'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../../../../../../src/store';
import type { RecordedAction, WorkflowStep } from '../../../../../../src/types';

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

/** Frame rate options exposed in the toolbar. Value is the poll interval in ms. */
const FRAME_RATE_OPTIONS = [
  { label: '1fps',  value: 1000 as const },
  { label: '2fps',  value: 500  as const },
  { label: '5fps',  value: 200  as const },
] as const;

type FrameRate = typeof FRAME_RATE_OPTIONS[number]['value'];

/** Recording log poll interval when recording is active (ms). */
const RECORDING_POLL_MS = 2_000;

/** Assumed browser viewport dimensions used for coordinate scaling. */
const BROWSER_VIEWPORT_W = 1280;
const BROWSER_VIEWPORT_H = 720;

/** Express API base — all browser-recorder endpoints live here. */
const API_BASE = 'http://localhost:3001/api/tools/browser-recorder';

// ─────────────────────────────────────────────
// API HELPER
// ─────────────────────────────────────────────

/**
 * Typed fetch wrapper for browser-recorder API calls.
 * Throws on non-2xx with the server's error message.
 */
async function recorderFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error((data.error as string) ?? `API error ${res.status}`);
  return data as T;
}

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

interface FrameResponse   { success: boolean; data?: { frame: string; pageUrl?: string; pageTitle?: string } }
interface RecordResponse  { success: boolean; data?: { recordings: RecordedAction[]; count: number } }
interface AnalyzeResponse { success: boolean; data?: { steps: WorkflowStep[] }; error?: string }
interface GenericResponse { success: boolean; error?: string }
interface DebugResponse   { success: boolean; data?: { reply: string }; error?: string }

/** A single message in the Debugger Agent chat. */
interface DebugMessage {
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

// ─────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────

/**
 * Browser Recorder View — live browser stream with click/key forwarding,
 * action recording, and AI-powered workflow generation.
 *
 * Layout: 70% left (stream + toolbar) | 30% right (recording log + AI panel)
 */
export function BrowserRecorderView() {
  const { sessions } = useStore();

  // ── Core state ───────────────────────────────
  const [sessionId, setSessionId]         = useState<string | null>(null);
  const [isLaunched, setIsLaunched]       = useState(false);
  const [frameData, setFrameData]         = useState<string | null>(null);
  const [recordingLog, setRecordingLog]   = useState<RecordedAction[]>([]);
  const [analysisSteps, setAnalysisSteps] = useState<WorkflowStep[] | null>(null);
  const [frameRate, setFrameRate]         = useState<FrameRate>(500);
  const [workflowName, setWorkflowName]   = useState('');

  // ── Right panel tab ──────────────────────────
  type RightTab = 'log' | 'debugger' | 'analysis';
  const [rightTab, setRightTab] = useState<RightTab>('log');

  // ── Debugger Agent state ─────────────────────
  const [debugMessages, setDebugMessages] = useState<DebugMessage[]>([]);
  const [debugInput, setDebugInput]       = useState('');
  const [isDebugging, setIsDebugging]     = useState(false);
  const debugChatRef = useRef<HTMLDivElement>(null);

  // ── Page URL/title state (updated on each frame poll) ───────────────────
  const [pageUrl, setPageUrl]     = useState<string>('');
  const [pageTitle, setPageTitle] = useState<string>('');

  // ── UI state ─────────────────────────────────
  const [error, setError]         = useState<string | null>(null);
  const [status, setStatus]       = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving]       = useState(false);
  const [savedMsg, setSavedMsg]       = useState<string | null>(null);

  // ── Refs ─────────────────────────────────────
  const imgRef        = useRef<HTMLImageElement>(null);
  const logRef        = useRef<HTMLDivElement>(null);
  const framePollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const recPollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const panelRef      = useRef<HTMLDivElement>(null);

  // Auto-focus the stream panel when session launches so keydown works immediately
  useEffect(() => {
    if (isLaunched && panelRef.current) {
      panelRef.current.focus();
    }
  }, [isLaunched]);

  // ── Frame polling ────────────────────────────
  const startFramePoll = useCallback((sid: string, interval: FrameRate) => {
    if (framePollRef.current) clearInterval(framePollRef.current);
    framePollRef.current = setInterval(async () => {
      try {
        const data = await recorderFetch<FrameResponse>(`/frame/${sid}`);
        if (data.data?.frame) setFrameData(data.data.frame);
        if (data.data?.pageUrl)   setPageUrl(data.data.pageUrl);
        if (data.data?.pageTitle) setPageTitle(data.data.pageTitle);
      } catch { /* non-fatal — skip frame */ }
    }, interval);
  }, []);

  const stopFramePoll = useCallback(() => {
    if (framePollRef.current) { clearInterval(framePollRef.current); framePollRef.current = null; }
  }, []);

  // ── Recording log polling (independent, 2s) ──
  const startRecordingPoll = useCallback((sid: string) => {
    if (recPollRef.current) clearInterval(recPollRef.current);
    recPollRef.current = setInterval(async () => {
      try {
        const data = await recorderFetch<RecordResponse>(`/recordings/${sid}`);
        if (data.data?.recordings) setRecordingLog(data.data.recordings);
      } catch { /* non-fatal */ }
    }, RECORDING_POLL_MS);
  }, []);

  const stopRecordingPoll = useCallback(() => {
    if (recPollRef.current) { clearInterval(recPollRef.current); recPollRef.current = null; }
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { stopFramePoll(); stopRecordingPoll(); }, [stopFramePoll, stopRecordingPoll]);

  // ── Server connection check ──────────────────
  // Detects server restart — clears launched state if the recorder session is gone
  useEffect(() => {
    if (!isLaunched || !sessionId) return;
    const check = setInterval(async () => {
      try {
        // Check if our specific session still exists on the server
        const res = await fetch(`http://localhost:3001/api/tools/browser-recorder/recordings/${sessionId}`);
        if (res.status === 404) {
          // Session gone — server restarted or session was stopped externally
          stopFramePoll();
          stopRecordingPoll();
          setIsLaunched(false);
          setFrameData(null);
          setRecordingLog([]);
          setPageUrl('');
          setPageTitle('');
          // Don't show error — just silently reset to picker state
          setStatus('Session disconnected. Select a session and launch again.');
        }
      } catch { /* server unreachable — don't clear state, might be transient */ }
    }, 10_000);
    return () => clearInterval(check);
  }, [isLaunched, sessionId, stopFramePoll, stopRecordingPoll]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [recordingLog]);

  // Auto-scroll debugger chat to bottom on new messages
  useEffect(() => {
    if (debugChatRef.current) debugChatRef.current.scrollTop = debugChatRef.current.scrollHeight;
  }, [debugMessages]);

  // ── Toolbar actions ──────────────────────────

  const handleLaunch = async () => {
    if (!sessionId) { setError('Select a session first'); return; }
    setError(null); setStatus('Launching browser...');
    try {
      await recorderFetch<GenericResponse>('/start', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      setIsLaunched(true);
      setStatus('Recording — every action is captured automatically');
      // Start both polls immediately on launch — no toggle needed
      startFramePoll(sessionId, frameRate);
      startRecordingPoll(sessionId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Launch failed');
      setStatus(null);
    }
  };

  const handleStop = async () => {
    stopFramePoll();
    stopRecordingPoll();
    try {
      await recorderFetch<GenericResponse>('/stop', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
    } catch { /* best-effort */ }
    setIsLaunched(false);
    setFrameData(null);
    setPageUrl('');
    setPageTitle('');
    setStatus('Stopped');
  };

  const handleClear = async () => {
    if (sessionId && isLaunched) {
      try {
        await recorderFetch<GenericResponse>('/recording/clear', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        });
      } catch { /* non-fatal — clear local state regardless */ }
    }
    setRecordingLog([]);
    setAnalysisSteps(null);
    setWorkflowName('');
    setSavedMsg(null);
    setStatus('Log cleared');
  };

  const handleFrameRateChange = (rate: FrameRate) => {
    setFrameRate(rate);
    if (isLaunched && sessionId) startFramePoll(sessionId, rate);
  };

  // ── Click forwarding ─────────────────────────

  const handleStreamClick = async (e: React.MouseEvent<HTMLImageElement>) => {
    if (!isLaunched || !sessionId || !imgRef.current) return;
    // Ensure panel stays focused for keyboard input after click
    panelRef.current?.focus();
    const rect = imgRef.current.getBoundingClientRect();
    const scaleX = BROWSER_VIEWPORT_W / rect.width;
    const scaleY = BROWSER_VIEWPORT_H / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    try {
      await recorderFetch<GenericResponse>('/click', {
        method: 'POST',
        body: JSON.stringify({ sessionId, x, y }),
      });
    } catch { /* non-fatal */ }
  };

  // ── Keypress forwarding ───────────────────────

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isLaunched || !sessionId) return;
    // Don't swallow browser shortcuts
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const isPrintable = e.key.length === 1;
    try {
      await recorderFetch<GenericResponse>('/keypress', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          key: isPrintable ? '' : e.key,
          text: isPrintable ? e.key : '',
        }),
      });
    } catch { /* non-fatal */ }
  };

  // ── AI analysis ───────────────────────────────

  const handleAnalyze = async () => {
    if (recordingLog.length === 0) { setError('No recordings to analyze'); return; }
    setIsAnalyzing(true); setError(null);
    try {
      const data = await recorderFetch<AnalyzeResponse>('/analyze', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      if (data.success && data.data?.steps) {
        setAnalysisSteps(data.data.steps);
        setStatus('Analysis complete');
      } else {
        setError(data.error ?? 'Analysis failed');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleCopyJSON = () => {
    if (!analysisSteps) return;
    void navigator.clipboard.writeText(JSON.stringify(analysisSteps, null, 2));
  };

  const handleSaveWorkflow = async () => {
    if (!analysisSteps || !workflowName.trim()) { setError('Enter a workflow name first'); return; }
    setIsSaving(true); setError(null);
    try {
      await recorderFetch<GenericResponse>('/save-workflow', {
        method: 'POST',
        body: JSON.stringify({ sessionId, name: workflowName.trim(), steps: analysisSteps }),
      });
      setSavedMsg(`"${workflowName}" saved`);
      setWorkflowName('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  // ── Debugger Agent ────────────────────────────

  const handleDebugSend = async () => {
    const msg = debugInput.trim();
    if (!msg || !sessionId || isDebugging) return;

    // Append user message immediately
    const userMsg: DebugMessage = { role: 'user', content: msg, timestamp: Date.now() };
    setDebugMessages((prev) => [...prev, userMsg]);
    setDebugInput('');
    setIsDebugging(true);

    try {
      const data = await recorderFetch<DebugResponse>('/debug', {
        method: 'POST',
        body: JSON.stringify({ sessionId, message: msg }),
      });

      const reply = data.data?.reply ?? (data as unknown as { error?: string }).error ?? 'No response';
      const agentMsg: DebugMessage = { role: 'agent', content: reply, timestamp: Date.now() };
      setDebugMessages((prev) => [...prev, agentMsg]);
    } catch (e: unknown) {
      const errMsg: DebugMessage = {
        role: 'agent',
        content: `Error: ${e instanceof Error ? e.message : 'Request failed'}`,
        timestamp: Date.now(),
      };
      setDebugMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsDebugging(false);
    }
  };

  // ── Render ────────────────────────────────────

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-container-lowest border-b border-outline-variant shrink-0">
        <h1 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[18px]">videocam</span>
          Browser Recorder
        </h1>
        <div className="flex items-center gap-3">
          {isLaunched && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 bg-[#2a0d11] border border-[#4a1b22] rounded text-[#f85149] font-data-mono text-[11px] font-bold animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-[#f85149] inline-block" />
              REC
            </span>
          )}
          <span className="font-data-mono text-data-mono text-on-surface-variant">
            Sessions: {sessions.length}
          </span>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mx-3 mt-1.5 px-3 py-1.5 bg-[#2a0d11] border border-[#4a1b22] rounded text-[#f85149] font-body-sm text-[11px] flex items-center gap-2 shrink-0">
          <span className="material-symbols-outlined text-[14px]">error</span>
          {error}
          <button onClick={() => setError(null)} className="ml-auto material-symbols-outlined text-[13px] hover:opacity-70">close</button>
        </div>
      )}

      {/* ── Two-column body ── */}
      <div className="flex flex-1 overflow-hidden gap-0">

        {/* ════════════════════════════════════════
            LEFT COLUMN — 70% — Stream + Toolbar
            ════════════════════════════════════════ */}
        <div className="flex flex-col overflow-hidden" style={{ width: '70%' }}>

          {/* Toolbar */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-outline-variant bg-surface-container-low shrink-0 flex-wrap">

            {/* Session selector */}
            <select
              value={sessionId ?? ''}
              onChange={(e) => setSessionId(e.target.value || null)}
              disabled={isLaunched}
              className="h-7 ide-input px-2 font-data-mono text-[11px] rounded disabled:opacity-50 min-w-[160px]"
            >
              <option value="">— Select session —</option>
              {sessions.filter((s) => s.healthStatus === 'live').length === 0 ? (
                <option value="" disabled>No live sessions available</option>
              ) : (
                sessions
                  .filter((s) => s.healthStatus === 'live')
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.fbName} · {s.uid?.slice(0, 12) ?? s.id.slice(0, 8)}
                    </option>
                  ))
              )}
            </select>

            {/* Launch / Stop */}
            {!isLaunched ? (
              <button
                onClick={handleLaunch}
                disabled={!sessionId}
                className="h-7 px-3 bg-primary-container text-surface-container-lowest font-body-sm text-[11px] font-semibold flex items-center gap-1 rounded hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                Launch
              </button>
            ) : (
              <button
                onClick={handleStop}
                className="h-7 px-3 bg-[#2a0d11] border border-[#4a1b22] text-[#f85149] font-body-sm text-[11px] font-semibold flex items-center gap-1 rounded hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-[14px]">stop</span>
                Stop
              </button>
            )}

            {/* Clear */}
            <button
              onClick={handleClear}
              className="h-7 px-2 border border-outline-variant text-on-surface-variant font-body-sm text-[11px] flex items-center gap-1 rounded hover:bg-surface-container-high transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
              Clear
            </button>

            {/* Frame rate selector */}
            <div className="ml-auto flex items-center gap-1">
              <span className="font-label-caps text-label-caps text-on-surface-variant text-[9px] uppercase mr-1">FPS</span>
              {FRAME_RATE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleFrameRateChange(opt.value)}
                  className={`h-6 px-2 rounded text-[10px] font-data-mono transition-colors ${
                    frameRate === opt.value
                      ? 'bg-primary-container text-surface-container-lowest font-bold'
                      : 'bg-surface-container border border-outline-variant text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Stream panel — 16:9, focusable for keydown */}
          <div
            ref={panelRef}
            className="flex-1 bg-[#0a0a0a] flex items-center justify-center overflow-hidden outline-none"
            tabIndex={0}
            onKeyDown={handleKeyDown}
          >
            {!isLaunched ? (
              <div className="flex flex-col items-center gap-3 text-on-surface-variant">
                <span className="material-symbols-outlined text-[56px] opacity-20">videocam_off</span>
                <p className="font-body-sm text-[12px] text-on-surface-variant opacity-60">No session active</p>
                {status && <p className="font-data-mono text-[10px] text-primary">{status}</p>}
              </div>
            ) : frameData ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={`data:image/png;base64,${frameData}`}
                alt="Live browser stream"
                className="w-full cursor-crosshair select-none"
                style={{ aspectRatio: '16/9', objectFit: 'contain', maxHeight: '100%' }}
                onClick={handleStreamClick}
                draggable={false}
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-on-surface-variant">
                <span className="material-symbols-outlined text-[48px] animate-pulse opacity-40">hourglass_empty</span>
                <p className="font-body-sm text-[12px] opacity-60">Waiting for first frame...</p>
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="px-3 py-1 border-t border-outline-variant bg-surface-container-low flex items-center gap-2 shrink-0 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isLaunched ? 'bg-[#3fb950]' : 'bg-outline-variant'}`} />
            <span className="font-data-mono text-[10px] text-on-surface-variant shrink-0">
              {isLaunched ? 'Connected' : 'Disconnected'}
            </span>
            {isLaunched && pageUrl && (
              <span
                className="font-data-mono text-[10px] text-primary truncate min-w-0 flex-1"
                title={pageTitle ? `${pageTitle} — ${pageUrl}` : pageUrl}
              >
                {pageUrl.replace('https://www.facebook.com', 'fb.com')}
              </span>
            )}
            {!isLaunched && status && <span className="font-data-mono text-[10px] text-primary ml-1 truncate">{status}</span>}
            {isLaunched && (
              <span className="ml-auto shrink-0 font-data-mono text-[10px] text-[#f85149] font-bold animate-pulse flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#f85149] inline-block" />
                REC — {recordingLog.length} actions
              </span>
            )}
          </div>
        </div>

        {/* ════════════════════════════════════════
            RIGHT COLUMN — 30% — Tabs: Log | Debugger | Analysis
            ════════════════════════════════════════ */}
        <div className="flex flex-col border-l border-outline-variant overflow-hidden" style={{ width: '30%' }}>

          {/* Tab bar */}
          <div className="flex border-b border-outline-variant bg-surface-container-highest shrink-0">
            {([
              { id: 'log',      label: 'Log',      icon: 'list_alt'      },
              { id: 'debugger', label: 'Debugger',  icon: 'bug_report'    },
              { id: 'analysis', label: 'Analysis',  icon: 'auto_awesome'  },
            ] as { id: RightTab; label: string; icon: string }[]).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setRightTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-1 h-8 font-label-caps text-[9px] uppercase tracking-wider transition-colors ${
                  rightTab === tab.id
                    ? 'text-primary border-b-2 border-primary bg-surface-container-low'
                    : 'text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                <span className="material-symbols-outlined text-[13px]">{tab.icon}</span>
                {tab.label}
                {tab.id === 'log' && recordingLog.length > 0 && (
                  <span className="ml-0.5 px-1 py-0.5 bg-primary-container text-surface-container-lowest rounded-full text-[8px] font-bold leading-none">
                    {recordingLog.length}
                  </span>
                )}
                {tab.id === 'debugger' && debugMessages.length > 0 && (
                  <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-[#3fb950] inline-block" />
                )}
              </button>
            ))}
          </div>

          {/* ── TAB: Recording Log ── */}
          {rightTab === 'log' && (
            <div ref={logRef} className="flex-1 overflow-y-auto scrollbar-hide">
              {recordingLog.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-8 text-on-surface-variant opacity-40">
                  <span className="material-symbols-outlined text-[28px]">list_alt</span>
                  <p className="font-body-sm text-[11px] mt-1">
                    {isLaunched ? 'Waiting for actions...' : 'No actions recorded'}
                  </p>
                </div>
              ) : (
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-surface-container-low border-b border-outline-variant z-10">
                    <tr>
                      {['#', 'Type', 'Selector', 'Text', 'Time'].map((h) => (
                        <th key={h} className="px-2 py-1 font-label-caps text-label-caps text-on-surface-variant text-[9px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="font-data-mono text-[10px]">
                    {recordingLog.map((action) => {
                      const typeColor =
                        action.actionType === 'click'    ? 'bg-[#0d1f2a] text-[#58a6ff] border-[#1b3a4a]' :
                        action.actionType === 'type'     ? 'bg-[#0d2a1a] text-[#3fb950] border-[#1b4a2a]' :
                                                           'bg-[#2b1a0d] text-[#ffba42] border-[#4a321b]';
                      const displayText = action.value ?? action.elementText ?? '';
                      const ts = new Date(action.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                      return (
                        <tr key={`${action.step}-${action.timestamp}`} className="border-b border-outline-variant hover:bg-surface-container-highest transition-colors">
                          <td className="px-2 py-1 text-on-surface-variant">{action.step}</td>
                          <td className="px-2 py-1">
                            <span className={`inline-flex px-1 py-0.5 rounded-sm border text-[8px] uppercase tracking-wider ${typeColor}`}>
                              {action.actionType}
                            </span>
                          </td>
                          <td className="px-2 py-1 text-on-surface-variant truncate max-w-[70px]" title={action.selector}>
                            {action.selector || (action.url ? action.url.replace('https://www.facebook.com', 'fb.com') : '—')}
                          </td>
                          <td className="px-2 py-1 text-on-surface truncate max-w-[60px]" title={displayText}>
                            {displayText || '—'}
                          </td>
                          <td className="px-2 py-1 text-on-surface-variant text-[9px]">{ts}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* ── TAB: Debugger Agent ── */}
          {rightTab === 'debugger' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Chat messages */}
              <div ref={debugChatRef} className="flex-1 overflow-y-auto p-2 flex flex-col gap-2 scrollbar-hide">
                {debugMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-on-surface-variant opacity-40 py-6 gap-2">
                    <span className="material-symbols-outlined text-[32px]">bug_report</span>
                    <p className="font-body-sm text-[11px] text-center px-4">
                      Ask the Debugger Agent anything about the current session.
                    </p>
                    <p className="font-data-mono text-[9px] text-center px-4 opacity-70">
                      It sees your live screenshot + action log.
                    </p>
                  </div>
                ) : (
                  debugMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex flex-col gap-0.5 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div className={`flex items-center gap-1 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                        <span className={`text-[9px] font-label-caps uppercase ${msg.role === 'user' ? 'text-primary' : 'text-[#3fb950]'}`}>
                          {msg.role === 'user' ? 'You' : 'Agent'}
                        </span>
                        <span className="text-[8px] text-on-surface-variant font-data-mono">
                          {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className={`max-w-[90%] px-2.5 py-1.5 rounded text-[11px] font-body-sm whitespace-pre-wrap break-words ${
                        msg.role === 'user'
                          ? 'bg-primary-container text-on-primary-container rounded-tr-none'
                          : 'bg-surface-container border border-outline-variant text-on-surface rounded-tl-none'
                      }`}>
                        {msg.content}
                      </div>
                    </div>
                  ))
                )}
                {isDebugging && (
                  <div className="flex items-start gap-1">
                    <div className="bg-surface-container border border-outline-variant rounded rounded-tl-none px-3 py-2 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="border-t border-outline-variant p-2 flex flex-col gap-1.5 shrink-0 bg-surface-container-lowest">
                {!isLaunched && (
                  <p className="font-data-mono text-[9px] text-on-surface-variant opacity-60 text-center">
                    Launch a session to enable the Debugger Agent
                  </p>
                )}
                <div className="flex gap-1.5">
                  <textarea
                    value={debugInput}
                    onChange={(e) => setDebugInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleDebugSend();
                      }
                    }}
                    disabled={!isLaunched || isDebugging}
                    placeholder={isLaunched ? 'Ask the agent... (Enter to send, Shift+Enter for newline)' : 'Launch a session first'}
                    rows={2}
                    className="flex-1 ide-input px-2 py-1.5 font-body-sm text-[11px] rounded resize-none disabled:opacity-40"
                  />
                  <button
                    onClick={() => void handleDebugSend()}
                    disabled={!isLaunched || !debugInput.trim() || isDebugging}
                    className="px-2 bg-primary-container text-surface-container-lowest rounded flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity"
                    title="Send (Enter)"
                  >
                    <span className="material-symbols-outlined text-[16px]">send</span>
                  </button>
                </div>
                <p className="font-data-mono text-[8px] text-on-surface-variant opacity-50">
                  Agent sees: live screenshot + last 20 actions
                </p>
              </div>
            </div>
          )}

          {/* ── TAB: AI Analysis ── */}
          {rightTab === 'analysis' && (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Header with analyze button */}
              <div className="h-8 border-b border-outline-variant flex items-center px-3 justify-between bg-surface-container-highest shrink-0">
                <span className="font-label-caps text-label-caps text-on-surface-variant uppercase">Workflow Generator</span>
                <button
                  onClick={handleAnalyze}
                  disabled={recordingLog.length === 0 || isAnalyzing}
                  className="h-6 px-2 bg-surface-container border border-outline-variant text-on-surface font-body-sm text-[10px] flex items-center gap-1 rounded hover:bg-surface-container-high disabled:opacity-40 transition-colors"
                >
                  {isAnalyzing
                    ? <span className="material-symbols-outlined text-[12px] animate-spin">progress_activity</span>
                    : <span className="material-symbols-outlined text-[12px] text-primary">auto_awesome</span>
                  }
                  {isAnalyzing ? 'Analyzing...' : 'Generate Workflow'}
                </button>
              </div>

              {/* Generated steps */}
              <div className="flex-1 overflow-y-auto p-2 scrollbar-hide">
                {!analysisSteps ? (
                  <div className="flex flex-col items-center justify-center h-full text-on-surface-variant opacity-40 py-6">
                    <span className="material-symbols-outlined text-[28px]">auto_awesome</span>
                    <p className="font-body-sm text-[11px] mt-1 text-center">
                      Record actions then click Generate Workflow
                    </p>
                  </div>
                ) : (
                  <ol className="flex flex-col gap-1.5">
                    {analysisSteps.map((step, i) => (
                      <li key={i} className="bg-surface-container-low border border-outline-variant rounded p-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[9px] bg-primary-container text-surface-container-lowest px-1.5 py-0.5 rounded-full font-bold shrink-0">
                            {i + 1}
                          </span>
                          <span className="font-data-mono text-[11px] text-on-surface font-semibold truncate">{step.stepName}</span>
                          <span className={`ml-auto text-[8px] px-1 py-0.5 rounded shrink-0 ${
                            step.actionType === 'click'    ? 'bg-[#0d1f2a] text-[#58a6ff]' :
                            step.actionType === 'type'     ? 'bg-[#0d2a1a] text-[#3fb950]' :
                                                             'bg-[#2b1a0d] text-[#ffba42]'
                          }`}>
                            {step.actionType}
                          </span>
                        </div>
                        <p className="font-data-mono text-[9px] text-on-surface-variant truncate" title={step.selector}>
                          {step.selector}
                        </p>
                        <p className="font-body-sm text-[10px] text-on-surface-variant mt-0.5">{step.description}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Save workflow controls */}
              {analysisSteps && (
                <div className="border-t border-outline-variant p-2 flex flex-col gap-1.5 shrink-0 bg-surface-container-lowest">
                  <div className="flex gap-1.5">
                    <button
                      onClick={handleCopyJSON}
                      className="h-7 px-2 border border-outline-variant text-on-surface-variant font-body-sm text-[10px] flex items-center gap-1 rounded hover:bg-surface-container-high transition-colors"
                    >
                      <span className="material-symbols-outlined text-[12px]">content_copy</span>
                      Copy as JSON
                    </button>
                  </div>
                  <input
                    type="text"
                    value={workflowName}
                    onChange={(e) => setWorkflowName(e.target.value)}
                    placeholder="Workflow name..."
                    className="h-7 ide-input px-2 font-data-mono text-[11px] rounded"
                  />
                  <button
                    onClick={handleSaveWorkflow}
                    disabled={!workflowName.trim() || isSaving}
                    className="h-7 px-3 bg-primary-container text-surface-container-lowest font-body-sm text-[11px] font-semibold flex items-center justify-center gap-1 rounded hover:opacity-90 disabled:opacity-40 transition-opacity"
                  >
                    <span className="material-symbols-outlined text-[13px]">save</span>
                    {isSaving ? 'Saving...' : 'Save as Workflow'}
                  </button>
                  {savedMsg && (
                    <p className="font-data-mono text-[10px] text-[#3fb950] flex items-center gap-1">
                      <span className="material-symbols-outlined text-[12px]">check_circle</span>
                      {savedMsg}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
