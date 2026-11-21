import path from 'node:path';
import type { QualityPreset } from './types.ts';

const ALLOWED_YT_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const ALLOWED_QUALITIES = new Set<QualityPreset>([
  'best',
  '1080p',
  '720p',
  '480p',
  'audio',
]);

export function validateYouTubeUrl(
  input: unknown
): { ok: true; url: string } | { ok: false; error: string } {
  if (typeof input !== 'string') {
    return { ok: false, error: 'URL must be a text string.' };
  }
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 2048) {
    return { ok: false, error: 'Please paste a valid YouTube URL.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Invalid URL format. Include https://youtube.com/... or https://youtu.be/...' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http and https URLs are supported.' };
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_YT_HOSTS.has(host)) {
    return { ok: false, error: 'Only YouTube URLs (youtube.com or youtu.be) are supported.' };
  }

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    if (!parsed.pathname || parsed.pathname === '/') {
      return { ok: false, error: 'Missing video ID in youtu.be URL.' };
    }
  } else {
    const isWatch = parsed.pathname === '/watch' && Boolean(parsed.searchParams.get('v'));
    const isShorts = parsed.pathname.startsWith('/shorts/');
    const isLive = parsed.pathname.startsWith('/live/');
    const isEmbed = parsed.pathname.startsWith('/embed/');
    if (!isWatch && !isShorts && !isLive && !isEmbed) {
      return { ok: false, error: 'Please paste a direct YouTube video, Shorts, or Live URL.' };
    }
  }

  return { ok: true, url: parsed.toString() };
}

export function validateQuality(input: unknown): QualityPreset | null {
  if (typeof input !== 'string') return null;
  return ALLOWED_QUALITIES.has(input as QualityPreset) ? (input as QualityPreset) : null;
}

export function validateItemId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  return /^[a-zA-Z0-9_-]{4,64}$/.test(trimmed) ? trimmed : null;
}

export function sanitizeFileStem(title: string, id: string): string {
  const cleaned = title
    .replace(/[%\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();

  const base = cleaned || 'youtube_video';
  return `${base} [${id}]`;
}

export function resolveSafeDownloadPath(downloadsDir: string, fileName: string): string | null {
  const base = path.resolve(downloadsDir);
  const safeName = path.basename(fileName);
  if (!safeName || safeName === '.' || safeName === '..') return null;
  const target = path.resolve(base, safeName);
  if (!target.startsWith(base + path.sep)) {
    return null;
  }
  return target;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return '--:--';
  }
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, exp);
  return `${val >= 100 ? val.toFixed(0) : val >= 10 ? val.toFixed(1) : val.toFixed(2)} ${units[exp]}`;
}

export function mapYtDlpError(rawOutput: string): string {
  const text = rawOutput || '';
  const lower = text.toLowerCase();
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const errorLine = [...lines].reverse().find((l) => l.startsWith('ERROR:'));

  if (lower.includes('private video')) {
    return 'This video is private and cannot be downloaded.';
  }
  if (
    lower.includes('video unavailable') ||
    lower.includes('this video has been removed') ||
    lower.includes('this video is no longer available') ||
    lower.includes('uploader has closed their youtube account')
  ) {
    return 'This video is unavailable or has been removed from YouTube.';
  }
  if (lower.includes('sign in to confirm your age') || lower.includes('age-restricted')) {
    return 'This video is age-restricted and requires signed-in YouTube cookies.';
  }
  if (lower.includes('confirm you’re not a bot') || lower.includes("confirm you're not a bot")) {
    const rawLine = errorLine || lines[lines.length - 1] || '';
    return rawLine
      ? `YouTube is blocking this server's IP address.\n${rawLine.slice(0, 260)}`
      : "YouTube is blocking this server's IP address.";
  }
  if (lower.includes('is not a valid url') || lower.includes('unsupported url')) {
    return 'Invalid or unsupported YouTube URL.';
  }
  if (lower.includes('requested format is not available')) {
    return 'The selected quality format is unavailable for this video. Try "Best" instead.';
  }
  if (lower.includes('ffmpeg is not installed') || lower.includes('ffprobe and ffmpeg not found')) {
    return 'ffmpeg is missing. Install ffmpeg to merge video and audio or extract MP3 audio.';
  }
  if (lower.includes('enoent')) {
    return 'yt-dlp is not installed or not accessible in your system PATH.';
  }

  if (errorLine) {
    return errorLine.replace(/^ERROR:\s*/, '').slice(0, 260);
  }
  return lines[lines.length - 1]?.slice(0, 260) || 'Download failed with an unexpected yt-dlp error.';
}

export function isNetworkErrorOutput(rawOutput: string): boolean {
  const lower = (rawOutput || '').toLowerCase();
  const patterns = [
    'unable to download',
    'connection reset',
    'urlopen error',
    'temporary failure in name resolution',
    'could not resolve host',
    'name or service not known',
    'nodename nor servname provided',
    'timed out',
    'network is unreachable',
    'connection refused',
    'connection aborted',
    'eof occurred in violation of protocol',
    'incompleteread',
    'getaddrinfo failed',
    'remote end closed connection',
    'ssl: unexpected_eof',
  ];
  return patterns.some((p) => lower.includes(p));
}
