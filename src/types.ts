export type QualityPreset = 'best' | '1080p' | '720p' | '480p' | 'audio';

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'paused'
  | 'paused_network'
  | 'done'
  | 'error';

export type FilterTab = 'all' | 'active' | 'paused' | 'done' | 'setup';

export interface DownloadItem {
  id: string;
  url: string;
  videoId: string;
  title: string;
  thumbnail: string;
  duration: number | null;
  durationText: string;
  uploader: string;
  quality: QualityPreset;
  fileStem: string;
  outputFile: string | null;
  status: DownloadStatus;
  statusText: string;
  percent: number;
  speed: string;
  eta: string;
  downloadedSize: string;
  totalSize: string;
  error: string | null;
  firstFetchedAt: number | null;
  expiresAt: number | null;
  fileDeleted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface VideoInfo {
  videoId: string;
  url: string;
  title: string;
  thumbnail: string;
  duration: number | null;
  durationText: string;
  uploader: string;
}

export interface BinaryStatus {
  installed: boolean;
  version: string | null;
  error?: string;
}

export interface StorageStats {
  usedBytes: number;
  maxBytes: number;
  usedPercent: number;
  fileTtlMinutes: number;
}

export interface SystemStatus {
  ytdlp: BinaryStatus;
  ffmpeg: BinaryStatus;
  online: boolean;
  lastNetworkCheck: number;
  downloadsDir: string;
  storage: StorageStats;
}

export const QUALITY_OPTIONS: { value: QualityPreset; label: string }[] = [
  { value: 'best', label: 'Best' },
  { value: '1080p', label: '1080p' },
  { value: '720p', label: '720p' },
  { value: '480p', label: '480p' },
  { value: 'audio', label: 'Audio (MP3)' },
];
