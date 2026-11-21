export type QualityPreset = 'best' | '1080p' | '720p' | '480p' | 'audio';

export type DownloadStatus =
  | 'queued'
  | 'downloading'
  | 'merging'
  | 'paused'
  | 'paused_network'
  | 'done'
  | 'error';

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

export interface SystemStatus {
  ytdlp: BinaryStatus;
  ffmpeg: BinaryStatus;
  online: boolean;
  lastNetworkCheck: number;
  downloadsDir: string;
}
