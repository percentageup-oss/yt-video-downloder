import { CheckCircle2, FolderDown, HardDrive, Wifi, WifiOff, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AddDownloadForm } from './components/AddDownloadForm.tsx';
import { DownloadCard } from './components/DownloadCard.tsx';
import { Header } from './components/Header.tsx';
import { SystemBanner } from './components/SystemBanner.tsx';
import type { DownloadItem, FilterTab, StorageStats, SystemStatus } from './types.ts';

const MOBILE_FILTERS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'done', label: 'Completed' },
  { id: 'setup', label: 'Setup' },
];

function formatClientBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[exp]}`;
}

export default function App() {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const [online, setOnline] = useState<boolean>(true);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [checkingSystem, setCheckingSystem] = useState(false);
  const [updatingYtDlp, setUpdatingYtDlp] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchSystemStatus = useCallback(async () => {
    setCheckingSystem(true);
    try {
      const res = await fetch('/api/system');
      if (res.ok) {
        const data = (await res.json()) as SystemStatus;
        setSystemStatus(data);
        setOnline(data.online);
        setStorage(data.storage);
      }
    } catch {
      // Ignore network hiccups during initial check
    } finally {
      setCheckingSystem(false);
    }
  }, []);

  useEffect(() => {
    void fetchSystemStatus();
  }, [fetchSystemStatus]);

  useEffect(() => {
    const es = new EventSource('/api/events');

    es.addEventListener('snapshot', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          items: DownloadItem[];
          online: boolean;
          storage?: StorageStats;
        };
        setItems(payload.items);
        setOnline(payload.online);
        if (payload.storage) {
          setStorage(payload.storage);
        }
      } catch {
        // Ignore malformed SSE payload
      }
    });

    es.addEventListener('item', (event) => {
      try {
        const updated = JSON.parse((event as MessageEvent).data) as DownloadItem;
        setItems((prev) => {
          const exists = prev.some((i) => i.id === updated.id);
          if (!exists) return [updated, ...prev];
          return prev.map((i) => (i.id === updated.id ? updated : i));
        });
      } catch {
        // Ignore malformed SSE payload
      }
    });

    es.addEventListener('network', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { online: boolean };
        setOnline(payload.online);
      } catch {
        // Ignore malformed SSE payload
      }
    });

    es.addEventListener('storage', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as StorageStats;
        setStorage(payload);
      } catch {
        // Ignore malformed SSE payload
      }
    });

    return () => {
      es.close();
    };
  }, []);

  const handleUpdateYtDlp = async () => {
    setUpdatingYtDlp(true);
    setUpdateMessage(null);
    try {
      const res = await fetch('/api/system/update-ytdlp', { method: 'POST' });
      const data = (await res.json()) as { ok: boolean; output: string; version: string | null };
      setUpdateMessage({ ok: data.ok, text: data.output });
      await fetchSystemStatus();
    } catch {
      setUpdateMessage({ ok: false, text: 'Failed to reach server while updating yt-dlp.' });
    } finally {
      setUpdatingYtDlp(false);
    }
  };

  const handlePause = async (id: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/downloads/${encodeURIComponent(id)}/pause`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        setActionError(data?.error || 'Could not pause download.');
      }
    } catch {
      setActionError('Failed to pause download.');
    }
  };

  const handleResume = async (id: string) => {
    setActionError(null);
    try {
      const res = await fetch(`/api/downloads/${encodeURIComponent(id)}/resume`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        setActionError(data?.error || 'Could not resume download.');
      }
    } catch {
      setActionError('Failed to resume download.');
    }
  };

  const handleCancel = async (id: string, keepFiles: boolean) => {
    setActionError(null);
    try {
      const query = keepFiles ? '?keepFiles=true' : '';
      const res = await fetch(`/api/downloads/${encodeURIComponent(id)}${query}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        setActionError(data?.error || 'Could not remove download.');
      }
    } catch {
      setActionError('Failed to cancel download.');
    }
  };

  const counts = useMemo(() => {
    let active = 0;
    let paused = 0;
    let done = 0;
    for (const item of items) {
      if (item.status === 'downloading' || item.status === 'merging' || item.status === 'queued') {
        active += 1;
      } else if (item.status === 'paused' || item.status === 'paused_network') {
        paused += 1;
      } else if (item.status === 'done') {
        done += 1;
      }
    }
    return { total: items.length, active, paused, done };
  }, [items]);

  const filteredItems = useMemo(() => {
    if (activeTab === 'active') {
      return items.filter(
        (i) => i.status === 'downloading' || i.status === 'merging' || i.status === 'queued'
      );
    }
    if (activeTab === 'paused') {
      return items.filter((i) => i.status === 'paused' || i.status === 'paused_network');
    }
    if (activeTab === 'done') {
      return items.filter((i) => i.status === 'done');
    }
    return items;
  }, [items, activeTab]);

  return (
    <div id="top" className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col">
      <Header
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        updatingYtDlp={updatingYtDlp}
        onUpdateYtDlp={() => void handleUpdateYtDlp()}
      />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8 space-y-6">
        {/* Live connectivity, tool status & storage quota telemetry strip */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.07] pb-4 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-2.5">
            {online ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-400">
                <Wifi className="h-3.5 w-3.5" />
                Internet online
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 font-medium text-amber-400">
                <WifiOff className="h-3.5 w-3.5" />
                Offline — downloads paused until network returns
              </span>
            )}
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono tabular-nums">
              {systemStatus
                ? systemStatus.ytdlp.installed
                  ? `yt-dlp ${systemStatus.ytdlp.version}`
                  : 'yt-dlp missing'
                : 'checking yt-dlp...'}
            </span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="font-mono tabular-nums">
              {systemStatus
                ? systemStatus.ffmpeg.installed
                  ? 'ffmpeg ready'
                  : 'ffmpeg missing'
                : 'checking ffmpeg...'}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-mono tabular-nums text-slate-400">
            {storage && (
              <>
                <span
                  className={`inline-flex items-center gap-1.5 ${
                    storage.usedPercent >= 90 ? 'text-amber-400' : 'text-slate-300'
                  }`}
                >
                  <HardDrive className="h-3.5 w-3.5" />
                  <span>
                    {formatClientBytes(storage.usedBytes)} / {formatClientBytes(storage.maxBytes)}
                  </span>
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
              </>
            )}
            <span>{counts.active} active</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span>{counts.paused} paused</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span>{counts.done} completed</span>
          </div>
        </div>

        {/* yt-dlp -U update result */}
        {updateMessage && (
          <div
            role="status"
            className={`flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-xs ${
              updateMessage.ok
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-red-500/30 bg-red-500/10 text-red-200'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
              <pre className="font-mono whitespace-pre-wrap break-words leading-relaxed">
                {updateMessage.text}
              </pre>
            </div>
            <button
              type="button"
              onClick={() => setUpdateMessage(null)}
              aria-label="Dismiss update message"
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Missing dependency instructions (only shown if yt-dlp/ffmpeg is really missing or Setup Guide clicked) */}
        <SystemBanner
          status={systemStatus}
          checking={checkingSystem}
          onRecheck={() => void fetchSystemStatus()}
          forceShow={activeTab === 'setup'}
        />

        {/* URL input & quality selector */}
        <AddDownloadForm
          ytdlpInstalled={systemStatus ? systemStatus.ytdlp.installed : true}
          onAdded={() => {
            if (activeTab === 'setup' || activeTab === 'done') {
              setActiveTab('all');
            }
          }}
        />

        {/* Mobile filter bar */}
        <div className="flex md:hidden items-center gap-1 overflow-x-auto rounded-lg border border-white/[0.08] bg-[#121824] p-1">
          {MOBILE_FILTERS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  selected ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {actionError && (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          >
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label="Dismiss error"
              className="text-red-300 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Queue list */}
        <section aria-label="Download queue" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">
              Download queue{' '}
              <span className="ml-1 text-sm font-mono tabular-nums text-slate-400">
                ({filteredItems.length})
              </span>
            </h2>
            <span className="text-xs text-slate-500 font-mono hidden sm:inline">
              Files auto-delete {storage?.fileTtlMinutes ?? 60}m after fetch
            </span>
          </div>

          {filteredItems.length === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-[#121824] px-6 py-12 text-center space-y-2.5">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-white/[0.04] text-slate-400">
                <FolderDown className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-slate-200">
                {items.length === 0
                  ? 'No downloads in queue yet'
                  : 'No downloads match this filter'}
              </p>
              <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                {items.length === 0
                  ? 'Paste a YouTube video link above to fetch details and start downloading. Active downloads automatically pause on internet drops and resume from .part files.'
                  : 'Switch filter tabs above to view other queued, paused, or completed videos.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {filteredItems.map((item) => (
                <DownloadCard
                  key={item.id}
                  item={item}
                  onPause={(id) => void handlePause(id)}
                  onResume={(id) => void handleResume(id)}
                  onCancel={(id, keepFiles) => void handleCancel(id, keepFiles)}
                />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
