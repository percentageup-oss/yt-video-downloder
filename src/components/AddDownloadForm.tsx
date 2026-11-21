import { AlertCircle, Download, Film, Link2, Loader2, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { QUALITY_OPTIONS, type QualityPreset, type VideoInfo } from '../types.ts';

interface AddDownloadFormProps {
  ytdlpInstalled: boolean;
  onAdded: () => void;
}

function isSafeHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function AddDownloadForm({ ytdlpInstalled, onAdded }: AddDownloadFormProps) {
  const [url, setUrl] = useState('');
  const [quality, setQuality] = useState<QualityPreset>('best');
  const [fetchingInfo, setFetchingInfo] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<VideoInfo | null>(null);
  const [thumbFailed, setThumbFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetchInfo = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Paste a YouTube video URL to fetch details.');
      return;
    }

    setFetchingInfo(true);
    setThumbFailed(false);
    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPreview(null);
        setError(data?.error || 'Could not fetch video info.');
        return;
      }
      setPreview(data as VideoInfo);
    } catch {
      setError('Could not reach the local ResumeDL server.');
    } finally {
      setFetchingInfo(false);
    }
  };

  const handleQueueDownload = async (usePreview: boolean) => {
    setError(null);
    const targetUrl = usePreview && preview ? preview.url : url.trim();
    if (!targetUrl) {
      setError('Paste a YouTube video URL first.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: targetUrl,
          quality,
          info: usePreview && preview ? preview : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Failed to add download to queue.');
        return;
      }
      setUrl('');
      setPreview(null);
      setThumbFailed(false);
      onAdded();
    } catch {
      setError('Could not reach the local ResumeDL server.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label="Add YouTube download"
      className="rounded-xl border border-white/[0.08] bg-[#121824] p-5 sm:p-6"
    >
      <div className="flex flex-col gap-1 mb-4">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
          Add video to download queue
        </h1>
        <p className="text-sm text-slate-400">
          Paste a YouTube URL to inspect metadata, select quality, and queue a resumable download.
        </p>
      </div>

      <form onSubmit={handleFetchInfo} className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
              if (preview && e.target.value.trim() !== preview.url) {
                setPreview(null);
              }
            }}
            placeholder="https://www.youtube.com/watch?v=..."
            aria-label="YouTube video URL"
            className="w-full rounded-lg border border-white/10 bg-[#0B0F17] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 min-h-[44px]"
          />
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="submit"
            disabled={fetchingInfo || submitting || !ytdlpInstalled}
            className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-slate-100 hover:bg-white/[0.1] disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 min-h-[44px] cursor-pointer"
          >
            {fetchingInfo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            <span>{fetchingInfo ? 'Fetching...' : 'Fetch Info'}</span>
          </button>

          {!preview && (
            <button
              type="button"
              onClick={() => void handleQueueDownload(false)}
              disabled={fetchingInfo || submitting || !url.trim() || !ytdlpInstalled}
              className="inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 min-h-[44px] cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              <span>{submitting ? 'Queuing...' : 'Download'}</span>
            </button>
          )}
        </div>
      </form>

      {/* Quality selector row */}
      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs font-medium text-slate-400">Output quality</span>
        <div
          role="radiogroup"
          aria-label="Output quality preset"
          className="flex flex-wrap items-center gap-1.5 rounded-lg bg-[#0B0F17] p-1 border border-white/[0.07]"
        >
          {QUALITY_OPTIONS.map((opt) => {
            const selected = quality === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setQuality(opt.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 min-h-[34px] cursor-pointer ${
                  selected
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]'
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Skeleton loader while yt-dlp --dump-json runs */}
      {fetchingInfo && (
        <div className="mt-5 flex flex-col sm:flex-row gap-4 border-t border-white/[0.07] pt-5 animate-pulse">
          <div className="w-full sm:w-44 aspect-video rounded-lg bg-white/[0.06] shrink-0" />
          <div className="flex-1 space-y-2.5 py-1">
            <div className="h-5 w-3/4 rounded bg-white/[0.08]" />
            <div className="h-4 w-1/3 rounded bg-white/[0.06]" />
            <div className="h-10 w-36 rounded-lg bg-white/[0.08] mt-3" />
          </div>
        </div>
      )}

      {/* Video metadata preview */}
      {!fetchingInfo && preview && (
        <div className="mt-5 flex flex-col gap-4 border-t border-white/[0.07] pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center min-w-0">
            <div className="relative w-full sm:w-44 aspect-video rounded-lg overflow-hidden bg-[#0B0F17] border border-white/[0.08] shrink-0 flex items-center justify-center">
              {preview.thumbnail && isSafeHttpUrl(preview.thumbnail) && !thumbFailed ? (
                <img
                  src={preview.thumbnail}
                  alt={preview.title}
                  referrerPolicy="no-referrer"
                  onError={() => setThumbFailed(true)}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-slate-500">
                  <Film className="h-6 w-6" />
                  <span className="text-xs">Video preview</span>
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-1.5">
              <h2 className="text-base font-semibold text-white leading-snug line-clamp-2">
                {preview.title}
              </h2>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>{preview.uploader}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{preview.durationText}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {QUALITY_OPTIONS.find((q) => q.value === quality)?.label || quality}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleQueueDownload(true)}
            disabled={submitting || !ytdlpInstalled}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 min-h-[44px] cursor-pointer"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            <span>{submitting ? 'Starting...' : 'Start Download'}</span>
          </button>
        </div>
      )}

      {/* Error feedback */}
      {error && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
        >
          <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
    </section>
  );
}
