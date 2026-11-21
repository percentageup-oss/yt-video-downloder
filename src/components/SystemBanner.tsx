import { AlertTriangle, CheckCircle2, Copy, Check, RefreshCw, Terminal } from 'lucide-react';
import { useState } from 'react';
import type { SystemStatus } from '../types.ts';

interface SystemBannerProps {
  status: SystemStatus | null;
  checking: boolean;
  onRecheck: () => void;
  forceShow?: boolean;
}

const INSTALL_COMMANDS = [
  {
    os: 'macOS (Homebrew)',
    cmd: 'brew install yt-dlp ffmpeg',
  },
  {
    os: 'Windows (winget)',
    cmd: 'winget install yt-dlp.yt-dlp Gyan.FFmpeg',
  },
  {
    os: 'Ubuntu / Debian Linux',
    cmd: 'sudo apt update && sudo apt install -y ffmpeg pipx && pipx install yt-dlp',
  },
];

export function SystemBanner({
  status,
  checking,
  onRecheck,
  forceShow = false,
}: SystemBannerProps) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  if (!status) return null;

  const missingTools = !status.ytdlp.installed || !status.ffmpeg.installed;
  if (!missingTools && !forceShow) {
    return null;
  }

  const handleCopy = async (text: string, idx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1800);
    } catch {
      // Clipboard blocked in non-HTTPS contexts; ignore silently
    }
  };

  return (
    <section
      aria-label="System dependencies and setup"
      className={`rounded-xl border p-5 sm:p-6 ${
        missingTools
          ? 'border-amber-500/30 bg-[#14161D]'
          : 'border-white/[0.08] bg-[#121824]'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            {missingTools ? (
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
            ) : (
              <Terminal className="h-5 w-5 text-blue-400 shrink-0" />
            )}
            <h2 className="text-base font-semibold text-white">
              {missingTools
                ? 'Required local tools missing'
                : 'Local engine status & setup guide'}
            </h2>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed max-w-2xl">
            ResumeDL executes <code className="text-slate-100 font-mono text-xs">yt-dlp</code> and{' '}
            <code className="text-slate-100 font-mono text-xs">ffmpeg</code> on this machine so
            downloads can merge video + audio and resume from <code className="text-slate-100 font-mono text-xs">.part</code> files.
          </p>
        </div>

        <button
          type="button"
          onClick={onRecheck}
          disabled={checking}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-4 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.08] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 min-h-[40px] cursor-pointer"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} />
          <span>{checking ? 'Checking...' : 'Re-check Tools'}</span>
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-[#0B0F17] px-4 py-3">
          <div>
            <div className="text-sm font-medium text-white">yt-dlp</div>
            <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
              {status.ytdlp.installed
                ? `Version ${status.ytdlp.version}`
                : status.ytdlp.error || 'Not found in PATH'}
            </div>
          </div>
          {status.ytdlp.installed ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
              <CheckCircle2 className="h-4 w-4" />
              Installed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
              <AlertTriangle className="h-4 w-4" />
              Missing
            </span>
          )}
        </div>

        <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-[#0B0F17] px-4 py-3">
          <div>
            <div className="text-sm font-medium text-white">ffmpeg</div>
            <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
              {status.ffmpeg.installed
                ? `Version ${status.ffmpeg.version}`
                : status.ffmpeg.error || 'Not found in PATH'}
            </div>
          </div>
          {status.ffmpeg.installed ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
              <CheckCircle2 className="h-4 w-4" />
              Installed
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
              <AlertTriangle className="h-4 w-4" />
              Missing
            </span>
          )}
        </div>
      </div>

      {(missingTools || forceShow) && (
        <div className="mt-4 space-y-2.5">
          <div className="text-xs font-medium text-slate-400">
            Install commands (restart ResumeDL or click Re-check Tools afterward):
          </div>
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3">
            {INSTALL_COMMANDS.map((entry, idx) => (
              <div
                key={entry.os}
                className="flex flex-col justify-between rounded-lg border border-white/[0.07] bg-[#0B0F17] p-3"
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="text-xs font-medium text-slate-300">{entry.os}</span>
                  <button
                    type="button"
                    onClick={() => void handleCopy(entry.cmd, idx)}
                    aria-label={`Copy ${entry.os} install command`}
                    className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                  >
                    {copiedIdx === idx ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <code className="text-xs font-mono text-slate-200 break-all leading-relaxed">
                  {entry.cmd}
                </code>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
