'use client';
import { useEffect, useState } from 'react';
import { useStore } from '../../../../../src/store';
import { ContentCard } from '../ui/ContentCard';
import { StatusBadge } from '../ui/StatusBadge';

export function ProxiesView() {
  const {
    proxies,
    sessionsByCountry,
    fetchProxies,
    fetchByCountry: fetchSessionsByCountry,
    bulkAddProxies,
    testProxy,
    deleteProxy,
  } = useStore();

  const [bulkText, setBulkText] = useState('');
  const [testing, setTesting] = useState<string | null>(null);

  useEffect(() => {
    fetchProxies();
    fetchSessionsByCountry();
  }, []);

  const handleBulkAdd = async () => {
    if (!bulkText.trim()) return;
    await bulkAddProxies(bulkText);
    setBulkText('');
  };

  const handleTest = async (proxy: typeof proxies[0]) => {
    setTesting(proxy.id);
    await testProxy(proxy.id);
    setTesting(null);
  };

  return (
    <div className="p-8 flex flex-col gap-6 h-full overflow-y-auto bg-background">

      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <ContentCard>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-display font-semibold text-on-surface">Proxies</h1>
            <p className="text-body-md text-on-surface-variant mt-1">
              Manage global proxy pools and assignment rules.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button className="bg-surface-container-lowest border border-outline-variant text-on-surface rounded-button px-5 py-[10px] text-body-md hover:bg-surface-container transition-colors flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">network_ping</span>
              Test All
            </button>
            <button className="bg-primary-container text-on-primary rounded-button px-5 py-[10px] text-body-md font-medium hover:opacity-90 transition-opacity flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">add</span>
              Add Proxies
            </button>
          </div>
        </div>
      </ContentCard>

      {/* ── Proxies Table ────────────────────────────────────────────────── */}
      <ContentCard padding="sm">
        {/* Table header */}
        <div className="flex items-center justify-between px-2 pb-3 border-b border-outline-variant mb-0">
          <span className="text-label-md font-semibold text-on-surface">Proxy List</span>
          <span className="text-label-sm text-on-surface-variant">{proxies.length} entries</span>
        </div>

        {/* Rows */}
        <div className="p-3 flex flex-col gap-1">
          {proxies.length === 0 && (
            <div className="px-3 py-10 text-center text-on-surface-variant text-body-md">
              No proxies added yet
            </div>
          )}
          {proxies.map(p => (
            <div
              key={p.id}
              className="card-row grid grid-cols-[2fr_1.5fr_1fr_1.5fr_1fr_1fr] items-center group"
            >
              {/* Proxy IP — monospace */}
              <div className="px-3 py-2.5 font-mono text-body-md text-on-surface">
                {p.host}:{p.port}
              </div>

              {/* Country — flag emoji + name */}
              <div className="px-3 py-2.5 text-body-md text-on-surface flex items-center gap-1.5">
                {(() => {
                  const match = sessionsByCountry.find(r => r.country === p.country);
                  return match
                    ? <><span>{match.flag}</span><span>{match.country}</span></>
                    : <span className="text-on-surface-variant">—</span>;
                })()}
              </div>

              {/* Status Badge */}
              <div className="px-3 py-2.5">
                <StatusBadge status="active" size="sm" />
              </div>

              {/* Assigned Account */}
              <div className="px-3 py-2.5 text-body-md text-on-surface-variant">
                —
              </div>

              {/* Protocol */}
              <div className="px-3 py-2.5 text-body-md text-on-surface-variant uppercase font-mono">
                {p.protocol}
              </div>

              {/* Actions */}
              <div className="px-3 py-2.5 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleTest(p)}
                  className="text-on-surface-variant hover:text-primary transition-colors"
                  title="Test proxy"
                >
                  <span className="material-symbols-outlined text-[18px]">
                    {testing === p.id ? 'hourglass_empty' : 'refresh'}
                  </span>
                </button>
                <button
                  onClick={() => deleteProxy(p.id)}
                  className="text-on-surface-variant hover:text-error transition-colors"
                  title="Delete proxy"
                >
                  <span className="material-symbols-outlined text-[18px]">delete</span>
                </button>
                <button
                  className="text-on-surface-variant hover:text-on-surface transition-colors"
                  title="More actions"
                >
                  <span className="material-symbols-outlined text-[18px]">more_vert</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </ContentCard>

      {/* ── Bottom Grid: Bulk Paste + Country Pool ───────────────────────── */}
      <div className="grid grid-cols-2 gap-6">

        {/* Bulk Paste Form */}
        <ContentCard>
          <h2 className="text-headline-md font-semibold text-on-surface mb-1">Bulk Add Proxies</h2>
          <p className="text-body-md text-on-surface-variant mb-4">
            Paste proxy strings, one per line. Supported formats: <span className="font-mono text-on-surface">IP:PORT</span> or <span className="font-mono text-on-surface">IP:PORT:USER:PASS</span>
          </p>
          <textarea
            className="w-full h-36 bg-surface-container-lowest border border-outline-variant text-body-md font-mono text-on-surface p-3 rounded-button ide-input resize-none focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-colors"
            placeholder={'192.168.1.1:8080:user:pass\n10.0.0.1:3128'}
            value={bulkText}
            onChange={e => setBulkText(e.target.value)}
          />
          <div className="flex items-center justify-between mt-4">
            <span className="text-label-sm text-on-surface-variant">
              {bulkText.trim() ? `${bulkText.trim().split('\n').filter(l => l.trim()).length} proxies detected` : 'No proxies entered'}
            </span>
            <button
              onClick={handleBulkAdd}
              disabled={!bulkText.trim()}
              className="bg-primary-container text-on-primary rounded-button px-5 py-[10px] text-body-md font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[16px]">upload</span>
              Parse &amp; Add
            </button>
          </div>
        </ContentCard>

        {/* Country Pool Summary */}
        <ContentCard>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-headline-md font-semibold text-on-surface">Country Pool</h2>
            <span className="text-label-sm text-on-surface-variant bg-surface-container px-3 py-1 rounded-badge">
              {sessionsByCountry.length} countries
            </span>
          </div>

          {sessionsByCountry.length === 0 ? (
            <div className="py-8 text-center text-on-surface-variant text-body-md">
              No country data available
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-h-64 overflow-y-auto">
              {sessionsByCountry.map(row => {
                const poolProxies = proxies.filter(p => p.country === row.country);
                const pct = poolProxies.length > 0
                  ? Math.round((row.total / poolProxies.length) * 100)
                  : 0;
                const isWarning = pct > 90;

                return (
                  <div
                    key={row.country}
                    className={`flex items-center justify-between p-3 rounded-button border ${
                      isWarning
                        ? 'border-tertiary/40 bg-tertiary/5'
                        : 'border-outline-variant bg-surface-container-lowest'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-body-lg">{row.flag}</span>
                      <span className="text-body-md font-medium text-on-surface">{row.country}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-label-sm text-on-surface-variant">
                        {poolProxies.length} proxies
                      </span>
                      <span className="text-label-sm font-semibold text-on-surface">
                        {row.total} sessions
                      </span>
                      {isWarning && (
                        <span className="text-label-sm text-tertiary font-semibold bg-tertiary/10 px-2 py-0.5 rounded-badge">
                          HIGH
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ContentCard>

      </div>
    </div>
  );
}
