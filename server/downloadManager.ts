import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import type { DownloadItem, QualityPreset, StorageStats, VideoInfo } from './types.ts';
import {
  formatBytes,
  formatDuration,
  isNetworkErrorOutput,
  mapYtDlpError,
  resolveSafeDownloadPath,
  sanitizeFileStem,
} from './validators.ts';

export const DOWNLOADS_DIR = path.resolve(process.cwd(), 'downloads');
export const STATE_FILE = path.resolve(process.cwd(), 'downloads.json');

const parsedMaxMb = Number.parseInt(process.env.MAX_STORAGE_MB || '2048', 10);
export const MAX_STORAGE_MB = Number.isFinite(parsedMaxMb) && parsedMaxMb >= 50 ? parsedMaxMb : 2048;
export const MAX_STORAGE_BYTES = MAX_STORAGE_MB * 1024 * 1024;

const parsedTtlMin = Number.parseInt(process.env.FILE_TTL_MINUTES || '60', 10);
export const FILE_TTL_MINUTES =
  Number.isFinite(parsedTtlMin) && parsedTtlMin >= 1 ? parsedTtlMin : 60;
export const FILE_TTL_MS = FILE_TTL_MINUTES * 60 * 1000;

export class StorageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageLimitError';
  }
}

type StopReason = 'network' | 'manual' | 'cancel' | 'storage' | null;

const QUALITY_LABELS: Record<QualityPreset, string> = {
  best: 'Best (MP4)',
  '1080p': '1080p (MP4)',
  '720p': '720p (MP4)',
  '480p': '480p (MP4)',
  audio: 'Audio (MP3)',
};

function getQualityArgs(quality: QualityPreset): string[] {
  switch (quality) {
    case '1080p':
      return ['-f', 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b', '--merge-output-format', 'mp4'];
    case '720p':
      return ['-f', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b', '--merge-output-format', 'mp4'];
    case '480p':
      return ['-f', 'bv*[height<=480]+ba/b[height<=480]/bv*+ba/b', '--merge-output-format', 'mp4'];
    case 'audio':
      return ['-f', 'ba/b', '-x', '--audio-format', 'mp3'];
    case 'best':
    default:
      return ['-f', 'bv*+ba/b', '--merge-output-format', 'mp4'];
  }
}

function parseSizeToBytes(sizeStr: string): number | null {
  const match = sizeStr.trim().match(/^~?\s*([\d.]+)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)$/i);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1000,
    MB: 1000 ** 2,
    GB: 1000 ** 3,
    TB: 1000 ** 4,
    KIB: 1024,
    MIB: 1024 ** 2,
    GIB: 1024 ** 3,
    TIB: 1024 ** 4,
  };
  return value * (multipliers[unit] ?? 1);
}

export class DownloadManager {
  private items: DownloadItem[] = [];
  private sseClients = new Set<Response>();
  private activeChild: ChildProcess | null = null;
  private activeItemId: string | null = null;
  private stopReason: StopReason = null;
  private isOnline = true;
  private lastNetworkCheck = Date.now();
  private networkTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private checkingNetwork = false;
  private lastProgressPersist = 0;

  constructor() {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    this.loadState();
  }

  public start(): void {
    this.purgeExpiredFiles();

    // Check internet immediately on startup, then every 3 seconds
    void this.pollConnectivity().then(() => {
      if (this.isOnline) {
        this.resumeNetworkPausedItems();
        this.processQueue();
      }
    });

    this.networkTimer = setInterval(() => {
      void this.pollConnectivity();
    }, 3000);

    // Check for expired files every 30 seconds (auto-delete 1 hour after fetch)
    this.cleanupTimer = setInterval(() => {
      this.purgeExpiredFiles();
    }, 30000);
  }

  public stop(): void {
    if (this.networkTimer) {
      clearInterval(this.networkTimer);
      this.networkTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.activeChild) {
      this.stopReason = 'network';
      this.activeChild.kill('SIGTERM');
    }
  }

  public getOnlineStatus(): { online: boolean; lastNetworkCheck: number } {
    return { online: this.isOnline, lastNetworkCheck: this.lastNetworkCheck };
  }

  public getStorageStats(): StorageStats {
    let usedBytes = 0;
    try {
      if (fs.existsSync(DOWNLOADS_DIR)) {
        const entries = fs.readdirSync(DOWNLOADS_DIR);
        for (const entry of entries) {
          const safePath = resolveSafeDownloadPath(DOWNLOADS_DIR, entry);
          if (!safePath) continue;
          try {
            const stat = fs.statSync(safePath);
            if (stat.isFile()) {
              usedBytes += stat.size;
            }
          } catch {
            // File may have been deleted concurrently
          }
        }
      }
    } catch {
      // Ignore directory read errors
    }

    const usedPercent =
      MAX_STORAGE_BYTES > 0
        ? Math.min(100, Number(((usedBytes / MAX_STORAGE_BYTES) * 100).toFixed(1)))
        : 0;

    return {
      usedBytes,
      maxBytes: MAX_STORAGE_BYTES,
      usedPercent,
      fileTtlMinutes: FILE_TTL_MINUTES,
    };
  }

  public getItems(): DownloadItem[] {
    return this.items;
  }

  public getItem(id: string): DownloadItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  public addSseClient(res: Response): void {
    this.sseClients.add(res);
    this.sendSse(res, 'snapshot', {
      items: this.items,
      online: this.isOnline,
      lastNetworkCheck: this.lastNetworkCheck,
      storage: this.getStorageStats(),
    });
  }

  public removeSseClient(res: Response): void {
    this.sseClients.delete(res);
  }

  private sendSse(res: Response, event: string, data: unknown): void {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.sseClients.delete(res);
    }
  }

  private broadcast(event: string, data: unknown): void {
    for (const client of this.sseClients) {
      this.sendSse(client, event, data);
    }
  }

  private broadcastSnapshot(): void {
    this.broadcast('snapshot', {
      items: this.items,
      online: this.isOnline,
      lastNetworkCheck: this.lastNetworkCheck,
      storage: this.getStorageStats(),
    });
  }

  private broadcastItem(item: DownloadItem): void {
    this.broadcast('item', item);
  }

  private broadcastStorage(): void {
    this.broadcast('storage', this.getStorageStats());
  }

  private loadState(): void {
    if (!fs.existsSync(STATE_FILE)) {
      this.items = [];
      this.saveState();
      return;
    }
    try {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.items = [];
        return;
      }
      this.items = parsed.map((entry: DownloadItem) => {
        const normalized: DownloadItem = {
          ...entry,
          firstFetchedAt: entry.firstFetchedAt ?? null,
          expiresAt: entry.expiresAt ?? null,
          fileDeleted: Boolean(entry.fileDeleted),
        };
        if (normalized.status === 'downloading' || normalized.status === 'merging') {
          return {
            ...normalized,
            status: 'paused_network',
            statusText: 'Paused - waiting for network',
            speed: '0 B/s',
            eta: '--',
            updatedAt: Date.now(),
          };
        }
        return normalized;
      });
      this.saveState();
    } catch {
      this.items = [];
    }
  }

  private saveState(): void {
    try {
      const tmp = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.items, null, 2), 'utf8');
      fs.renameSync(tmp, STATE_FILE);
    } catch (err) {
      console.error('Failed to persist downloads.json:', err);
    }
  }

  public purgeExpiredFiles(): void {
    const now = Date.now();
    let changed = false;

    for (const item of this.items) {
      if (item.status === 'done' && item.expiresAt !== null && now >= item.expiresAt && !item.fileDeleted) {
        this.deleteFilesForItem(item);
        item.outputFile = null;
        item.fileDeleted = true;
        item.statusText = `Auto-deleted (${FILE_TTL_MINUTES}m after fetch)`;
        item.updatedAt = now;
        changed = true;
        this.broadcastItem(item);
      }
    }

    if (changed) {
      this.saveState();
      this.broadcastStorage();
    }
  }

  public markFileFetched(id: string): DownloadItem | null {
    const item = this.getItem(id);
    if (!item || item.status !== 'done' || !item.outputFile || item.fileDeleted) {
      return null;
    }

    const now = Date.now();
    if (!item.firstFetchedAt) {
      item.firstFetchedAt = now;
    }
    // Schedule/refresh auto-deletion 1 hour after the file is fetched
    item.expiresAt = now + FILE_TTL_MS;
    item.updatedAt = now;
    this.saveState();
    this.broadcastItem(item);
    return item;
  }

  private ensureStorageAvailable(): void {
    this.purgeExpiredFiles();
    const stats = this.getStorageStats();
    if (stats.usedBytes >= stats.maxBytes) {
      throw new StorageLimitError(
        `Free storage limit reached (${formatBytes(stats.usedBytes)} / ${formatBytes(stats.maxBytes)}). Cancel or dismiss completed downloads to free space.`
      );
    }
  }

  public async checkInternet(): Promise<boolean> {
    try {
      const response = await fetch('https://www.google.com/generate_204', {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
        headers: { 'Cache-Control': 'no-cache' },
      });
      return response.status === 204 || response.ok;
    } catch {
      return false;
    }
  }

  private async pollConnectivity(): Promise<void> {
    if (this.checkingNetwork) return;
    this.checkingNetwork = true;
    try {
      const prevOnline = this.isOnline;
      const nowOnline = await this.checkInternet();
      this.isOnline = nowOnline;
      this.lastNetworkCheck = Date.now();

      if (prevOnline !== nowOnline) {
        this.broadcast('network', {
          online: nowOnline,
          lastNetworkCheck: this.lastNetworkCheck,
        });
      }

      if (!nowOnline) {
        // Network dropped: stop active yt-dlp process cleanly and preserve .part files
        if (this.activeChild && this.activeItemId && this.stopReason === null) {
          this.stopReason = 'network';
          const item = this.getItem(this.activeItemId);
          if (item) {
            item.status = 'paused_network';
            item.statusText = 'Paused - waiting for network';
            item.speed = '0 B/s';
            item.eta = '--';
            item.updatedAt = Date.now();
            this.saveState();
            this.broadcastItem(item);
          }
          const child = this.activeChild;
          child.kill('SIGTERM');
          setTimeout(() => {
            if (!child.killed && child.exitCode === null) {
              child.kill('SIGKILL');
            }
          }, 2000);
        }
      } else if (!prevOnline && nowOnline) {
        // Back online: automatically restart paused_network downloads from .part files
        this.resumeNetworkPausedItems();
        this.processQueue();
      }
    } finally {
      this.checkingNetwork = false;
    }
  }

  private resumeNetworkPausedItems(): void {
    let changed = false;
    for (const item of this.items) {
      if (item.status === 'paused_network') {
        item.status = 'queued';
        item.statusText = 'Queued — resuming';
        item.error = null;
        item.updatedAt = Date.now();
        changed = true;
        this.broadcastItem(item);
      }
    }
    if (changed) {
      this.saveState();
    }
  }

  public fetchVideoInfo(url: string): Promise<VideoInfo> {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const child = spawn(
        'yt-dlp',
        ['--dump-json', '--no-playlist', '--socket-timeout', '15', '--', url],
        { shell: false }
      );

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill('SIGKILL');
          reject(new Error('Fetching video info timed out. Check your connection and try again.'));
        }
      }, 30000);

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
      });

      child.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new Error('yt-dlp is not installed or not found in PATH.'));
        } else {
          reject(new Error(err.message));
        }
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(mapYtDlpError(stderr)));
          return;
        }
        try {
          const firstJsonLine = stdout
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l.startsWith('{'));
          if (!firstJsonLine) {
            reject(new Error('yt-dlp returned empty video metadata.'));
            return;
          }
          const info = JSON.parse(firstJsonLine);
          const duration = typeof info.duration === 'number' ? info.duration : null;
          resolve({
            videoId: String(info.id || ''),
            url,
            title: String(info.title || 'Untitled YouTube Video'),
            thumbnail: typeof info.thumbnail === 'string' ? info.thumbnail : '',
            duration,
            durationText: formatDuration(duration),
            uploader: String(info.uploader || info.channel || 'YouTube'),
          });
        } catch {
          reject(new Error('Failed to parse metadata from yt-dlp.'));
        }
      });
    });
  }

  public async addDownload(params: {
    url: string;
    quality: QualityPreset;
    info?: Partial<VideoInfo>;
  }): Promise<DownloadItem> {
    this.ensureStorageAvailable();

    let resolvedInfo: VideoInfo | null = null;
    if (!params.info?.title) {
      resolvedInfo = await this.fetchVideoInfo(params.url);
    }

    const id = crypto.randomUUID().slice(0, 8);
    const title = (params.info?.title || resolvedInfo?.title || 'YouTube Video').trim();
    const videoId = params.info?.videoId || resolvedInfo?.videoId || '';
    const thumbnail = params.info?.thumbnail || resolvedInfo?.thumbnail || '';
    const duration = params.info?.duration ?? resolvedInfo?.duration ?? null;
    const durationText =
      params.info?.durationText || resolvedInfo?.durationText || formatDuration(duration);
    const uploader = params.info?.uploader || resolvedInfo?.uploader || 'YouTube';

    const item: DownloadItem = {
      id,
      url: params.url,
      videoId,
      title,
      thumbnail,
      duration,
      durationText,
      uploader,
      quality: params.quality,
      fileStem: sanitizeFileStem(title, id),
      outputFile: null,
      status: this.isOnline ? 'queued' : 'paused_network',
      statusText: this.isOnline ? 'Queued' : 'Paused - waiting for network',
      percent: 0,
      speed: '--',
      eta: '--',
      downloadedSize: '0 B',
      totalSize: '--',
      error: null,
      firstFetchedAt: null,
      expiresAt: null,
      fileDeleted: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.items.unshift(item);
    this.saveState();
    this.broadcastSnapshot();
    this.processQueue();
    return item;
  }

  public pauseDownload(id: string): DownloadItem | null {
    const item = this.getItem(id);
    if (!item) return null;

    if (item.status === 'done') return item;

    if (this.activeItemId === id && this.activeChild) {
      this.stopReason = 'manual';
      item.status = 'paused';
      item.statusText = 'Paused';
      item.speed = '0 B/s';
      item.eta = '--';
      item.updatedAt = Date.now();
      this.saveState();
      this.broadcastItem(item);

      const child = this.activeChild;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed && child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 2000);
      return item;
    }

    item.status = 'paused';
    item.statusText = 'Paused';
    item.speed = '0 B/s';
    item.eta = '--';
    item.updatedAt = Date.now();
    this.saveState();
    this.broadcastItem(item);
    return item;
  }

  public resumeDownload(id: string): DownloadItem | null {
    const item = this.getItem(id);
    if (!item) return null;
    if (item.status === 'downloading' || item.status === 'merging') {
      return item;
    }

    this.ensureStorageAvailable();

    // Allow re-downloading an expired item cleanly
    if (item.status === 'done' && item.fileDeleted) {
      item.fileDeleted = false;
      item.firstFetchedAt = null;
      item.expiresAt = null;
      item.outputFile = null;
      item.percent = 0;
      item.downloadedSize = '0 B';
      item.totalSize = '--';
    } else if (item.status === 'done') {
      return item;
    }

    item.error = null;
    if (!this.isOnline) {
      item.status = 'paused_network';
      item.statusText = 'Paused - waiting for network';
    } else {
      item.status = 'queued';
      item.statusText = 'Queued — resuming';
    }
    item.updatedAt = Date.now();
    this.saveState();
    this.broadcastItem(item);
    this.processQueue();
    return item;
  }

  public async cancelDownload(id: string, keepFiles: boolean): Promise<boolean> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) return false;
    const item = this.items[idx];

    if (this.activeItemId === id && this.activeChild) {
      this.stopReason = 'cancel';
      const child = this.activeChild;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
          resolve();
        }, 2000);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        child.kill('SIGTERM');
      });
    }

    if (!keepFiles) {
      this.deleteFilesForItem(item);
    }

    this.items = this.items.filter((i) => i.id !== id);
    this.saveState();
    this.broadcastSnapshot();
    this.processQueue();
    return true;
  }

  private deleteFilesForItem(item: DownloadItem): void {
    try {
      if (!fs.existsSync(DOWNLOADS_DIR)) return;
      const marker = `[${item.id}]`;
      const entries = fs.readdirSync(DOWNLOADS_DIR);
      for (const entry of entries) {
        if (entry.includes(marker) || (item.outputFile && entry === item.outputFile)) {
          const safePath = resolveSafeDownloadPath(DOWNLOADS_DIR, entry);
          if (safePath && fs.existsSync(safePath)) {
            fs.unlinkSync(safePath);
          }
        }
      }
    } catch (err) {
      console.error(`Failed to delete files for ${item.id}:`, err);
    }
  }

  private findCompletedFile(item: DownloadItem): string | null {
    try {
      if (!fs.existsSync(DOWNLOADS_DIR)) return null;
      const marker = `[${item.id}]`;
      const entries = fs.readdirSync(DOWNLOADS_DIR);
      const matches = entries.filter(
        (name) =>
          name.includes(marker) &&
          !name.endsWith('.part') &&
          !name.endsWith('.ytdl') &&
          !name.includes('.temp.')
      );
      if (matches.length === 0) return null;
      const preferred =
        matches.find((m) => m.endsWith('.mp4') || m.endsWith('.mp3')) ?? matches[0];
      return preferred;
    } catch {
      return null;
    }
  }

  private processQueue(): void {
    if (this.activeItemId || this.activeChild || !this.isOnline) {
      return;
    }

    this.purgeExpiredFiles();
    const nextItem = [...this.items].reverse().find((i) => i.status === 'queued');
    if (!nextItem) return;

    const stats = this.getStorageStats();
    if (stats.usedBytes >= stats.maxBytes) {
      nextItem.status = 'error';
      nextItem.statusText = 'Error';
      nextItem.error = `Free storage limit reached (${formatBytes(stats.usedBytes)} / ${formatBytes(stats.maxBytes)}). Free up space and retry.`;
      nextItem.updatedAt = Date.now();
      this.saveState();
      this.broadcastSnapshot();
      return;
    }

    this.runYtDlp(nextItem);
  }

  private runYtDlp(item: DownloadItem): void {
    this.activeItemId = item.id;
    this.stopReason = null;

    item.status = 'downloading';
    item.statusText = `Downloading (${QUALITY_LABELS[item.quality]})`;
    item.error = null;
    item.updatedAt = Date.now();
    this.saveState();
    this.broadcastItem(item);

    const outputTemplate = path.join(DOWNLOADS_DIR, `${item.fileStem}.%(ext)s`);
    const args = [
      ...getQualityArgs(item.quality),
      '--continue',
      '--retries',
      'infinite',
      '--fragment-retries',
      'infinite',
      '--socket-timeout',
      '15',
      '--newline',
      '--no-playlist',
      '-o',
      outputTemplate,
      '--',
      item.url,
    ];

    const child = spawn('yt-dlp', args, { shell: false });
    this.activeChild = child;

    let stderrBuffer = '';
    let lineRemainder = '';

    const handleLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (!line) return;

      if (line.startsWith('[Merger]') || line.startsWith('[ffmpeg]')) {
        item.status = 'merging';
        item.statusText = 'Merging video & audio';
        item.speed = '--';
        item.eta = '00:00';
        item.updatedAt = Date.now();
        this.broadcastItem(item);
        return;
      }

      if (line.startsWith('[ExtractAudio]')) {
        item.status = 'merging';
        item.statusText = 'Converting audio to MP3';
        item.speed = '--';
        item.eta = '00:00';
        item.updatedAt = Date.now();
        this.broadcastItem(item);
        return;
      }

      const progressMatch = line.match(
        /^\[download\]\s+([\d.]+)%\s+of\s+~?\s*([^\s]+)(?:\s+in\s+[^\s]+)?\s+at\s+([^\s]+(?:\s*B\/s)?)(?:\s+ETA\s+([^\s]+))?/i
      );

      if (progressMatch) {
        const pct = Math.min(100, Math.max(0, Number.parseFloat(progressMatch[1])));
        const totalStr = progressMatch[2];
        const speedStr = progressMatch[3];
        const etaStr = progressMatch[4] || (pct >= 100 ? '00:00' : '--');

        item.status = 'downloading';
        item.statusText = `Downloading (${QUALITY_LABELS[item.quality]})`;
        item.percent = Number.isFinite(pct) ? Number(pct.toFixed(1)) : item.percent;
        item.totalSize = totalStr || item.totalSize;
        item.speed = speedStr && !speedStr.toLowerCase().includes('unknown') ? speedStr : '--';
        item.eta = etaStr && !etaStr.toLowerCase().includes('unknown') ? etaStr : '--';

        const totalBytes = parseSizeToBytes(totalStr);
        if (totalBytes !== null && Number.isFinite(pct)) {
          item.downloadedSize = formatBytes((pct / 100) * totalBytes);
        }

        item.updatedAt = Date.now();
        this.broadcastItem(item);

        if (Date.now() - this.lastProgressPersist > 3000) {
          this.lastProgressPersist = Date.now();
          this.saveState();
          const stats = this.getStorageStats();
          this.broadcast('storage', stats);
          if (stats.usedBytes > stats.maxBytes && this.stopReason === null) {
            this.stopReason = 'storage';
            child.kill('SIGTERM');
            setTimeout(() => {
              if (!child.killed && child.exitCode === null) {
                child.kill('SIGKILL');
              }
            }, 2000);
          }
        }
        return;
      }

      if (line.includes('has already been downloaded')) {
        item.percent = 100;
        item.updatedAt = Date.now();
        this.broadcastItem(item);
      }
    };

    const processChunk = (chunk: Buffer, isStderr: boolean) => {
      const text = chunk.toString('utf8');
      if (isStderr) {
        stderrBuffer = (stderrBuffer + text).slice(-4000);
      }
      const combined = lineRemainder + text;
      const parts = combined.split(/\r\n|\n|\r/);
      lineRemainder = parts.pop() ?? '';
      for (const p of parts) {
        handleLine(p);
      }
    };

    child.stdout.on('data', (chunk: Buffer) => processChunk(chunk, false));
    child.stderr.on('data', (chunk: Buffer) => processChunk(chunk, true));

    child.on('error', (err: NodeJS.ErrnoException) => {
      this.activeChild = null;
      this.activeItemId = null;

      if (this.stopReason === 'network') {
        item.status = 'paused_network';
        item.statusText = 'Paused - waiting for network';
      } else if (this.stopReason === 'manual') {
        item.status = 'paused';
        item.statusText = 'Paused';
      } else if (this.stopReason === 'cancel') {
        return;
      } else if (this.stopReason === 'storage') {
        this.deleteFilesForItem(item);
        item.status = 'error';
        item.statusText = 'Error';
        item.error = `Storage limit of ${MAX_STORAGE_MB} MB exceeded. Choose a smaller quality or free up space.`;
      } else {
        item.status = 'error';
        item.statusText = 'Error';
        item.error =
          err.code === 'ENOENT'
            ? 'yt-dlp is not installed or not found in PATH.'
            : err.message;
      }
      item.speed = '--';
      item.eta = '--';
      item.updatedAt = Date.now();
      this.saveState();
      this.broadcastSnapshot();
      this.processQueue();
    });

    child.on('close', async (code) => {
      if (lineRemainder) {
        handleLine(lineRemainder);
        lineRemainder = '';
      }

      const reason = this.stopReason;
      this.activeChild = null;
      this.activeItemId = null;
      this.stopReason = null;

      if (reason === 'cancel') {
        return;
      }

      if (reason === 'storage') {
        this.deleteFilesForItem(item);
        item.status = 'error';
        item.statusText = 'Error';
        item.speed = '--';
        item.eta = '--';
        item.percent = 0;
        item.downloadedSize = '0 B';
        item.error = `Free storage limit (${MAX_STORAGE_MB} MB) exceeded. Try a lower quality preset (e.g. 720p or 480p) or clear old downloads.`;
        item.updatedAt = Date.now();
        this.saveState();
        this.broadcastSnapshot();
        this.processQueue();
        return;
      }

      if (reason === 'network') {
        item.status = 'paused_network';
        item.statusText = 'Paused - waiting for network';
        item.speed = '0 B/s';
        item.eta = '--';
        item.updatedAt = Date.now();
        this.saveState();
        this.broadcastItem(item);
        this.broadcastStorage();
        return;
      }

      if (reason === 'manual') {
        item.status = 'paused';
        item.statusText = 'Paused';
        item.speed = '0 B/s';
        item.eta = '--';
        item.updatedAt = Date.now();
        this.saveState();
        this.broadcastItem(item);
        this.broadcastStorage();
        this.processQueue();
        return;
      }

      if (code === 0) {
        const completedFile = this.findCompletedFile(item);
        if (completedFile) {
          const safePath = resolveSafeDownloadPath(DOWNLOADS_DIR, completedFile);
          if (safePath && fs.existsSync(safePath)) {
            const stat = fs.statSync(safePath);
            const sizeStr = formatBytes(stat.size);
            item.downloadedSize = sizeStr;
            item.totalSize = sizeStr;
          }
          item.outputFile = completedFile;
        }
        item.status = 'done';
        item.statusText = 'Done';
        item.percent = 100;
        item.speed = '--';
        item.eta = '00:00';
        item.error = null;
        item.fileDeleted = false;
        item.updatedAt = Date.now();
        this.saveState();
        this.broadcastSnapshot();
        this.processQueue();
        return;
      }

      const stillOnline = await this.checkInternet();
      if (!stillOnline || isNetworkErrorOutput(stderrBuffer)) {
        this.isOnline = stillOnline;
        this.lastNetworkCheck = Date.now();
        item.status = 'paused_network';
        item.statusText = 'Paused - waiting for network';
        item.speed = '0 B/s';
        item.eta = '--';
        item.error = null;
        item.updatedAt = Date.now();
        this.saveState();
        this.broadcastSnapshot();
        return;
      }

      item.status = 'error';
      item.statusText = 'Error';
      item.speed = '--';
      item.eta = '--';
      item.error = mapYtDlpError(stderrBuffer);
      item.updatedAt = Date.now();
      this.saveState();
      this.broadcastSnapshot();
      this.processQueue();
    });
  }
}
