import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Film,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { QUALITY_OPTIONS, type DownloadItem, type DownloadStatus } from '../types.ts';

interface DownloadCardProps {
  item: DownloadItem;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onCancel: (id: string, keepFiles: boolean) => void;
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function formatExpiryRemaining(expiresAt: number): string {
  const diffMs = expiresAt - Date.now();
  if (diffMs <= 0) return 'Expiring soon';
  const mins = Math.ceil(diffMs / 60000);
  return `Auto-deletes in ${mins}m`;
}

function getStatusStyles(status: DownloadStatus): {
  badge: string;
  bar: string;
  label: string;
} {
  switch (status) {
    case 'downloading':
    case 'merging':
      return {
        badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
        bar: 'bg-emerald-500',
        label: status === 'merging' ? 'Merging' : 'Downloading',
      };
    case 'paused':
    case 'paused_network':
      return {
        badge: 'text-amber-300 bg-amber-500/10 border-amber-500/30',
        bar: 'bg-amber-500',
        label: status === 'paused_network' ? 'Paused - waiting for network' : 'Paused',
      };
    case 'done':
      return {
        badge: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
        bar: 'bg-blue-500',
        label: 'Done',
      };
    case 'error':
      return {
        badge: 'text-red-300 bg-red-500/10 border-red-500/30',
        bar: 'bg-red-500',
        label: 'Error',
      };
    case 'queued':
    default:
      return {
        badge: 'text-slate-300 bg-slate-500/10 border-slate-500/25',
        bar: 'bg-slate-400',
        label: 'Queued',
      };
  }
}

function StatusIcon({ status }: { status: DownloadStatus }) {
  switch (status) {
    case 'downloading':
    case 'merging':
      return <Download className="h-3.5 w-3.5 shrink-0" />;
    case 'paused_network':
      return <WifiOff className="h-3.5 w-3.5 shrink-0" />;
    case 'paused':
      return <Pause className="h-3.5 w-3.5 shrink-0" />;
    case 'done':
      return <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />;
    case 'error':
      return <AlertCircle className="h-3.5 w-3.5 shrink-0" />;
    case 'queued':
    default:
      return <Clock className="h-3.5 w-3.5 shrink-0" />;
  }
}

export function DownloadCard({
  item,
  onPause,
  onResume,
  onCancel,
}: DownloadCardProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const styles = getStatusStyles(item.status);
  const qualityLabel =
    QUALITY_OPTIONS.find((q) => q.value === item.quality)?.label ?? item.quality;

  const isActive = item.status === 'downloading' || item.status === 'merging';
  const isPaused = item.status === 'paused' || item.status === 'paused_network';
  const isQueued = item.status === 'queued';
  const isDone = item.status === 'done';
  const isError = item.status === 'error';

  const statusBadgeText =
    item.status === 'paused_network'
      ? 'Paused - waiting for network'
      : item.status === 'merging'
        ? item.statusText || 'Merging'
        : isDone && item.fileDeleted
          ? 'Expired'
          : styles.label;

  return (
    <article className="rounded-xl border border-white/[0.08] bg-[#121824] p-4 sm:p-5 transition-colors hover:border-white/[0.14]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* Thumbnail */}
        <div className="relative w-full sm:w-44 aspect-video rounded-lg overflow-hidden bg-[#0B0F17] border border-white/[0.07] shrink-0 flex items-center justify-center">
          {item.thumbnail && isSafeHttpUrl(item.thumbnail) && !thumbFailed ? (
            <img
              src={item.thumbnail}
              alt={item.title}
              referrerPolicy="no-referrer"
              onError={() => setThumbFailed(true)}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-1 text-slate-600">
              <Film className="h-6 w-6" />
              <span className="text-[11px]">YouTube</span>
            </div>
          )}
        </div>

        {/* Details & Progress */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <h3 className="text-base font-semibold text-white leading-snug line-clamp-2">
                {item.title}
              </h3>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>{qualityLabel}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{item.durationText}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[200px]">{item.uploader}</span>
              </div>
            </div>

            <div
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 self-start ${styles.badge}`}
            >
              <StatusIcon status={item.status} />
              <span>{statusBadgeText}</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-2">
            <div
              role="progressbar"
              aria-valuenow={Math.round(item.percent)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Download progress for ${item.title}`}
              className="h-2 w-full overflow-hidden rounded-full bg-white/[0.07]"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-200 ${styles.bar}`}
                style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }}
              />
            </div>

            {/* Live telemetry */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs font-mono tabular-nums text-slate-300">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-white">{item.percent.toFixed(1)}%</span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span>
                  {item.downloadedSize} / {item.totalSize}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-slate-400">
                <span>Speed: {item.speed}</span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span>ETA: {item.eta}</span>
              </div>
            </div>
          </div>

          {/* Error detail */}
          {isError && item.error && (
            <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {item.error}
            </div>
          )}

          {/* Completed file info & actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div className="text-xs text-slate-500 truncate max-w-full sm:max-w-md font-mono tabular-nums">
              {isDone && item.fileDeleted
                ? 'Auto-deleted 1h after fetch to save storage'
                : isDone && item.outputFile
                  ? item.expiresAt
                    ? `${formatExpiryRemaining(item.expiresAt)} · ./downloads/${item.outputFile}`
                    : `Ready (resumable HTTP Range) · ./downloads/${item.outputFile}`
                  : isPaused
                    ? 'Partial .part file preserved for resume'
                    : ''}
            </div>

            <div className="flex flex-wrap items-center gap-2 ml-auto">
              {(isActive || isQueued) && (
                <button
                  type="button"
                  onClick={() => onPause(item.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2 text-xs font-medium text-amber-300 hover:bg-amber-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
                >
                  <Pause className="h-3.5 w-3.5" />
                  <span>Pause</span>
                </button>
              )}

              {isPaused && (
                <button
                  type="button"
                  onClick={() => onResume(item.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>Resume</span>
                </button>
              )}

              {isError && (
                <button
                  type="button"
                  onClick={() => onResume(item.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Retry</span>
                </button>
              )}

              {isDone && item.fileDeleted && (
                <button
                  type="button"
                  onClick={() => onResume(item.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Re-download</span>
                </button>
              )}

              {isDone && item.outputFile && !item.fileDeleted && (
                <a
                  href={`/api/downloads/${encodeURIComponent(item.id)}/file`}
                  download={item.outputFile}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3.5 py-2 text-xs font-medium text-blue-300 hover:bg-blue-500/20 transition-colors whitespace-nowrap shrink-0 min-h-[40px]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Save File</span>
                </a>
              )}

              {!isDone ? (
                <button
                  type="button"
                  onClick={() => onCancel(item.id, false)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-300 hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Cancel</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onCancel(item.id, true)}
                  title="Remove from list (keeps downloaded file in ./downloads)"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-300 hover:bg-white/[0.08] transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>Dismiss</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
