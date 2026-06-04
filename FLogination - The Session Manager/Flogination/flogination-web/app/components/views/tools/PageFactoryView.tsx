'use client';
import { useState } from 'react';
import { useStore } from '../../../../../../src/store';
import { ContentCard } from '../../ui/ContentCard';
import { StatusBadge } from '../../ui/StatusBadge';
import { ProgressBar } from '../../ui/ProgressBar';
import type { StatusValue } from '../../ui/StatusBadge';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkerStatus {
  sessionId: string;
  name: string;
  status: StatusValue;
  progress: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PageFactoryView() {
  const { sessions } = useStore();
  const [selectedWorkers, setSelectedWorkers] = useState<Set<string>>(new Set());
  const [parkingId, setParkingId] = useState('');
  const [pagesPerWorker, setPagesPerWorker] = useState(10);
  const [nameTemplate, setNameTemplate] = useState('BrandName_{random}_Official');
  const [category, setCategory] = useState('eCommerce / Tech');
  const [bio, setBio] = useState('Welcome to our {official|verified} page. Discover the latest {tech|gadgets} here.');
  const [running, setRunning] = useState(false);
  const [workerStatuses, setWorkerStatuses] = useState<WorkerStatus[]>([]);

  const liveSessions = sessions.filter(s => s.healthStatus === 'live');

  // ─── Input class shared across all form fields ─────────────────────────────
  const INPUT_CLASS =
    'w-full bg-surface-container-lowest border border-outline-variant rounded-button px-[14px] py-[10px] text-body-md text-on-surface focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-colors';

  const toggleWorker = (id: string) => {
    const next = new Set(selectedWorkers);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedWorkers(next);
  };

  const handleDeploy = async () => {
    if (selectedWorkers.size === 0 || !parkingId) return;
    setRunning(true);

    // Initialise worker status cards for each selected worker
    const initialStatuses: WorkerStatus[] = Array.from(selectedWorkers).map(id => {
      const session = sessions.find(s => s.id === id);
      return {
        sessionId: id,
        name: session?.fbName ?? id,
        status: 'creating' as StatusValue,
        progress: 0,
      };
    });
    setWorkerStatuses(initialStatuses);

    try {
      const res = await fetch('/api/tools/page-factory/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workerSessionIds: Array.from(selectedWorkers),
          parkingSessionId: parkingId,
          pagesPerWorker,
          nameTemplate,
          category,
          bio,
        }),
      });
      const data = await res.json();
      if (data.success) {
        // Mark all workers as transferring once job is queued
        setWorkerStatuses(prev =>
          prev.map(w => ({ ...w, status: 'transferring' as StatusValue, progress: 10 }))
        );
      }
    } catch (e) {
      console.error(e);
      // Mark all workers as failed on error
      setWorkerStatuses(prev =>
        prev.map(w => ({ ...w, status: 'failed' as StatusValue }))
      );
    }
    setRunning(false);
  };

  return (
    <div className="grid grid-cols-12 gap-6 p-8 h-full overflow-hidden bg-background">

      {/* ── Left Panel: Configuration ─────────────────────────────────────── */}
      <div className="col-span-7 flex flex-col gap-4 overflow-y-auto">

        {/* Page Details */}
        <ContentCard>
          <h2 className="text-headline-md font-semibold text-on-surface mb-4">Page Details</h2>
          <div className="flex flex-col gap-4">

            {/* Page Name Template */}
            <div>
              <label className="block text-label-md font-medium text-on-surface-variant mb-1.5">
                Page Name Template
              </label>
              <input
                type="text"
                className={INPUT_CLASS}
                value={nameTemplate}
                onChange={e => setNameTemplate(e.target.value)}
                placeholder="BrandName_{random}_Official"
              />
              <p className="mt-1 text-label-sm text-on-surface-variant">
                Supports <code className="font-mono text-primary">{'{random}'}</code> and <code className="font-mono text-primary">{'{geo}'}</code> tokens
              </p>
            </div>

            {/* Category */}
            <div>
              <label className="block text-label-md font-medium text-on-surface-variant mb-1.5">
                Category / Vertical
              </label>
              <input
                type="text"
                className={INPUT_CLASS}
                value={category}
                onChange={e => setCategory(e.target.value)}
                placeholder="eCommerce / Tech"
              />
            </div>

            {/* Bio */}
            <div>
              <label className="block text-label-md font-medium text-on-surface-variant mb-1.5">
                Biography / Meta Description
              </label>
              <textarea
                className={`${INPUT_CLASS} resize-none min-h-[96px]`}
                value={bio}
                onChange={e => setBio(e.target.value)}
                placeholder="Welcome to our page..."
              />
            </div>

          </div>
        </ContentCard>

        {/* Image Upload */}
        <ContentCard>
          <h2 className="text-headline-md font-semibold text-on-surface mb-4">Page Image</h2>
          <div className="border-2 border-dashed border-outline-variant rounded-card p-8 flex flex-col items-center justify-center gap-2 text-on-surface-variant hover:border-primary hover:bg-surface-container-low transition-colors cursor-pointer">
            <span className="material-symbols-outlined text-[32px] text-outline">upload_file</span>
            <p className="text-body-md font-medium">Drop image here or click to upload</p>
            <p className="text-label-sm">PNG, JPG up to 5MB</p>
          </div>
        </ContentCard>

        {/* Worker Accounts */}
        <ContentCard>
          <h2 className="text-headline-md font-semibold text-on-surface mb-4">
            Worker Accounts
            <span className="ml-2 text-label-sm font-normal text-primary">
              {selectedWorkers.size} selected
            </span>
          </h2>
          <div className="flex flex-col gap-1 max-h-[200px] overflow-y-auto">
            {liveSessions.length === 0 && (
              <p className="text-body-md text-on-surface-variant text-center py-4">
                No live sessions available
              </p>
            )}
            {liveSessions.map(s => (
              <label
                key={s.id}
                className="flex items-center gap-3 px-3 py-2 rounded-button hover:bg-surface-container cursor-pointer transition-colors group"
              >
                <input
                  type="checkbox"
                  checked={selectedWorkers.has(s.id)}
                  onChange={() => toggleWorker(s.id)}
                  className="w-4 h-4 rounded accent-primary"
                />
                <span className="flex-1 text-body-md text-on-surface group-hover:text-primary transition-colors truncate">
                  {s.fbName}
                </span>
                <span className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00b894]" />
                  {s.state?.toUpperCase() ?? 'IDLE'}
                </span>
              </label>
            ))}
          </div>
        </ContentCard>

        {/* Parking Account */}
        <ContentCard>
          <h2 className="text-headline-md font-semibold text-on-surface mb-4">Parking Account</h2>
          <div>
            <label className="block text-label-md font-medium text-on-surface-variant mb-1.5">
              Target Parking Account
            </label>
            <select
              className={INPUT_CLASS}
              value={parkingId}
              onChange={e => setParkingId(e.target.value)}
            >
              <option value="">Select parking account...</option>
              {sessions
                .filter(s => s.healthStatus === 'live' && !selectedWorkers.has(s.id))
                .map(s => (
                  <option key={s.id} value={s.id}>
                    {s.fbName} ({s.bmCount} BMs)
                  </option>
                ))}
            </select>
          </div>
        </ContentCard>

        {/* Timing */}
        <ContentCard>
          <h2 className="text-headline-md font-semibold text-on-surface mb-4">Timing</h2>
          <div>
            <label className="block text-label-md font-medium text-on-surface-variant mb-1.5">
              Pages per Worker
            </label>
            <input
              type="number"
              className={INPUT_CLASS}
              value={pagesPerWorker}
              onChange={e => setPagesPerWorker(parseInt(e.target.value))}
              min={1}
              max={100}
            />
          </div>
        </ContentCard>

        {/* Start Job Button */}
        <button
          onClick={handleDeploy}
          disabled={running || selectedWorkers.size === 0 || !parkingId}
          className="w-full bg-primary-container text-on-primary rounded-button py-[10px] px-5 text-body-md font-medium flex items-center justify-center gap-2 hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
          {running
            ? 'Deploying...'
            : `Start Job — Deploy ${selectedWorkers.size * pagesPerWorker} Pages`}
        </button>

      </div>

      {/* ── Right Panel: Worker Status Grid ───────────────────────────────── */}
      <div className="col-span-5 flex flex-col gap-4">

        <ContentCard padding="sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-headline-md font-semibold text-on-surface">Worker Status</h2>
            {workerStatuses.length > 0 && (
              <span className="text-label-sm text-on-surface-variant">
                {workerStatuses.length} worker{workerStatuses.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {workerStatuses.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-on-surface-variant gap-3">
              <span className="material-symbols-outlined text-[40px] text-outline">dynamic_feed</span>
              <p className="text-body-md font-medium">No job running</p>
              <p className="text-label-sm text-center">
                Configure workers and click Start Job to begin
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {workerStatuses.map(worker => (
                <ContentCard key={worker.sessionId} padding="sm" hover>
                  <p className="text-label-md font-medium text-on-surface truncate mb-2">
                    {worker.name}
                  </p>
                  <div className="mb-2">
                    <StatusBadge status={worker.status} size="sm" />
                  </div>
                  <ProgressBar value={worker.progress} />
                  <p className="mt-1 text-label-sm text-on-surface-variant text-right">
                    {worker.progress}%
                  </p>
                </ContentCard>
              ))}
            </div>
          )}
        </ContentCard>

      </div>

    </div>
  );
}
