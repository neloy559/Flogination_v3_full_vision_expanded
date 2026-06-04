'use client';
import { useState } from 'react';
import { useStore } from '../../../../src/store';

export function TopBar() {
  const { scrapeAll, cancelScrapeAll, sessions } = useStore();
  const [syncing, setSyncing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const handleSyncAll = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await scrapeAll();
    } finally {
      setSyncing(false);
    }
  };

  const handleCancelSync = async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      await cancelScrapeAll();
    } finally {
      setCancelling(false);
    }
  };

  const scrapingCount = sessions.filter(s => s.scrapingStatus === 'scraping').length;
  const isAnyScraping = scrapingCount > 0 || syncing;

  return (
    <header className="bg-surface-container-lowest h-[48px] w-full shrink-0 border-b border-outline-variant flex items-center justify-between px-4 z-30">
      <div className="flex items-center gap-4">
        <div className="relative hidden lg:flex items-center bg-surface-container rounded-button h-8 px-3 w-64 border border-outline-variant focus-within:border-primary transition-colors">
          <span className="material-symbols-outlined text-[16px] text-on-surface-variant mr-2">search</span>
          <input
            className="bg-transparent border-none outline-none text-body-md text-on-surface w-full placeholder:text-on-surface-variant text-[13px]"
            placeholder="Search accounts, logs..."
            type="text"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="h-7 px-3 border border-outline-variant bg-transparent text-on-surface text-body-md text-[13px] rounded-button hover:bg-surface-container transition-colors">
          Global Logs
        </button>

        {/* Sync / Stop button — toggles based on scraping state */}
        {isAnyScraping ? (
          <button
            onClick={handleCancelSync}
            disabled={cancelling}
            className="h-7 px-3 bg-error/10 text-error border border-error/30 text-[13px] rounded-button font-medium hover:bg-error/20 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {cancelling
              ? <><span className="material-symbols-outlined text-[14px] animate-spin">sync</span> Pausing...</>
              : <><span className="material-symbols-outlined text-[14px]">pause_circle</span> Pause Sync ({scrapingCount})</>
            }
          </button>
        ) : (
          <button
            onClick={handleSyncAll}
            disabled={syncing}
            className="h-7 px-3 bg-primary-container text-on-primary text-[13px] rounded-button font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
          >
            {syncing
              ? <><span className="material-symbols-outlined text-[14px] animate-spin">sync</span> Syncing...</>
              : <><span className="material-symbols-outlined text-[14px]">sync</span> Sync All</>
            }
          </button>
        )}
        <div className="h-4 w-px bg-outline-variant mx-1" />
        <button className="text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors p-1.5 rounded-button">
          <span className="material-symbols-outlined text-[20px]">notifications</span>
        </button>
        <button className="text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors p-1.5 rounded-button">
          <span className="material-symbols-outlined text-[20px]">terminal</span>
        </button>
        <button className="text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors p-1.5 rounded-button">
          <span className="material-symbols-outlined text-[20px]">help_outline</span>
        </button>
        <div className="w-8 h-8 rounded-full bg-primary-container/20 border border-primary/20 ml-1 flex items-center justify-center cursor-pointer hover:bg-primary-container/30 transition-colors">
          <span className="material-symbols-outlined text-[16px] text-primary">person</span>
        </div>
      </div>
    </header>
  );
}
