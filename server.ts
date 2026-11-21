import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {
  DownloadManager,
  DOWNLOADS_DIR,
  StorageLimitError,
} from './server/downloadManager.ts';
import { getSystemStatus, updateYtDlp } from './server/systemCheck.ts';
import {
  resolveSafeDownloadPath,
  validateItemId,
  validateQuality,
  validateYouTubeUrl,
} from './server/validators.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

app.set('trust proxy', true);
app.use(express.json({ limit: '64kb' }));

const manager = new DownloadManager();

// Check startup binaries and log status clearly
void getSystemStatus(
  true,
  Date.now(),
  DOWNLOADS_DIR,
  manager.getStorageStats()
).then((status) => {
  console.log(
    `[ResumeDL] yt-dlp: ${status.ytdlp.installed ? status.ytdlp.version : 'MISSING'} | ffmpeg: ${status.ffmpeg.installed ? status.ffmpeg.version : 'MISSING'}`
  );
});

manager.start();

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.mp4':
      return 'video/mp4';
    case '.mp3':
      return 'audio/mpeg';
    case '.webm':
      return 'video/webm';
    case '.m4a':
      return 'audio/mp4';
    case '.mkv':
      return 'video/x-matroska';
    default:
      return 'application/octet-stream';
  }
}

function buildContentDisposition(fileName: string): string {
  const asciiSafe = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*!]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${asciiSafe}"; filename*=UTF-8''${encoded}`;
}

function parseSingleByteRange(
  rangeHeader: string,
  totalSize: number
): { start: number; end: number } | 'invalid' {
  if (!rangeHeader.startsWith('bytes=')) return 'invalid';
  const spec = rangeHeader.slice(6).split(',')[0]?.trim();
  if (!spec || !spec.includes('-')) return 'invalid';

  const [rawStart, rawEnd] = spec.split('-', 2);

  if (rawStart === '') {
    // Suffix byte range: bytes=-500
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'invalid';
    const start = Math.max(0, totalSize - suffixLength);
    const end = totalSize - 1;
    return start <= end ? { start, end } : 'invalid';
  }

  const start = Number.parseInt(rawStart, 10);
  if (!Number.isFinite(start) || start < 0 || start >= totalSize) return 'invalid';

  const end =
    rawEnd === '' ? totalSize - 1 : Math.min(totalSize - 1, Number.parseInt(rawEnd, 10));
  if (!Number.isFinite(end) || end < start) return 'invalid';

  return { start, end };
}

// Health check endpoint for cloud hosts (Render / Hugging Face Spaces)
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', uptime: Math.floor(process.uptime()) });
});

// System check & yt-dlp updater
app.get('/api/system', async (_req: Request, res: Response) => {
  manager.purgeExpiredFiles();
  const { online, lastNetworkCheck } = manager.getOnlineStatus();
  const status = await getSystemStatus(
    online,
    lastNetworkCheck,
    DOWNLOADS_DIR,
    manager.getStorageStats()
  );
  res.json(status);
});

app.post('/api/system/update-ytdlp', async (_req: Request, res: Response) => {
  const result = await updateYtDlp();
  res.status(result.ok ? 200 : 500).json(result);
});

// Fetch video metadata with yt-dlp --dump-json
app.post('/api/info', async (req: Request, res: Response) => {
  const urlResult = validateYouTubeUrl(req.body?.url);
  if (!urlResult.ok) {
    res.status(400).json({ error: urlResult.error });
    return;
  }

  try {
    const info = await manager.fetchVideoInfo(urlResult.url);
    res.json(info);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch video metadata.';
    res.status(422).json({ error: message });
  }
});

// Download queue endpoints
app.get('/api/downloads', (_req: Request, res: Response) => {
  res.json({ items: manager.getItems(), storage: manager.getStorageStats() });
});

app.post('/api/downloads', async (req: Request, res: Response) => {
  const urlResult = validateYouTubeUrl(req.body?.url);
  if (!urlResult.ok) {
    res.status(400).json({ error: urlResult.error });
    return;
  }

  const quality = validateQuality(req.body?.quality ?? 'best');
  if (!quality) {
    res.status(400).json({ error: 'Invalid quality preset selected.' });
    return;
  }

  const rawInfo = req.body?.info;
  const info =
    rawInfo && typeof rawInfo === 'object'
      ? {
          videoId: typeof rawInfo.videoId === 'string' ? rawInfo.videoId : undefined,
          title: typeof rawInfo.title === 'string' ? rawInfo.title : undefined,
          thumbnail: typeof rawInfo.thumbnail === 'string' ? rawInfo.thumbnail : undefined,
          duration: typeof rawInfo.duration === 'number' ? rawInfo.duration : undefined,
          durationText:
            typeof rawInfo.durationText === 'string' ? rawInfo.durationText : undefined,
          uploader: typeof rawInfo.uploader === 'string' ? rawInfo.uploader : undefined,
        }
      : undefined;

  try {
    const item = await manager.addDownload({
      url: urlResult.url,
      quality,
      info,
    });
    res.status(201).json(item);
  } catch (err) {
    if (err instanceof StorageLimitError) {
      res.status(507).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Failed to add download.';
    res.status(422).json({ error: message });
  }
});

app.post('/api/downloads/:id/pause', (req: Request, res: Response) => {
  const id = validateItemId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Invalid download ID.' });
    return;
  }
  const item = manager.pauseDownload(id);
  if (!item) {
    res.status(404).json({ error: 'Download item not found.' });
    return;
  }
  res.json(item);
});

app.post('/api/downloads/:id/resume', (req: Request, res: Response) => {
  const id = validateItemId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Invalid download ID.' });
    return;
  }
  try {
    const item = manager.resumeDownload(id);
    if (!item) {
      res.status(404).json({ error: 'Download item not found.' });
      return;
    }
    res.json(item);
  } catch (err) {
    if (err instanceof StorageLimitError) {
      res.status(507).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : 'Could not resume download.';
    res.status(500).json({ error: message });
  }
});

app.delete('/api/downloads/:id', async (req: Request, res: Response) => {
  const id = validateItemId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Invalid download ID.' });
    return;
  }
  const keepFiles = req.query.keepFiles === 'true';
  const removed = await manager.cancelDownload(id, keepFiles);
  if (!removed) {
    res.status(404).json({ error: 'Download item not found.' });
    return;
  }
  res.json({ ok: true, id });
});

// Serve completed files with full RFC 7233 HTTP Range support (206 Partial Content)
// and trigger 1-hour auto-deletion timer once fetched
function handleServeFile(req: Request, res: Response, isHead: boolean): void {
  manager.purgeExpiredFiles();

  const id = validateItemId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Invalid download ID.' });
    return;
  }

  const item = manager.getItem(id);
  if (!item) {
    res.status(404).json({ error: 'Download item not found.' });
    return;
  }

  if (item.fileDeleted || !item.outputFile) {
    res.status(410).json({
      error: 'This file was auto-deleted 1 hour after being fetched. Click Re-download to fetch it again.',
    });
    return;
  }

  const safePath = resolveSafeDownloadPath(DOWNLOADS_DIR, item.outputFile);
  if (!safePath || !fs.existsSync(safePath)) {
    res.status(404).json({ error: 'File no longer exists in ./downloads.' });
    return;
  }

  const stat = fs.statSync(safePath);
  const totalSize = stat.size;
  const etag = `"${totalSize}-${Math.floor(stat.mtimeMs)}"`;
  const lastModified = stat.mtime.toUTCString();

  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', getMimeType(item.outputFile));
  res.setHeader('Content-Disposition', buildContentDisposition(item.outputFile));
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', lastModified);
  res.setHeader('Cache-Control', 'private, no-store');

  // Schedule/refresh 1-hour auto-deletion when file is fetched via GET
  if (!isHead) {
    manager.markFileFetched(id);
  }

  const rangeHeader = req.headers.range;
  const ifRange = req.headers['if-range'];
  const ifRangeMatches = !ifRange || ifRange === etag || ifRange === lastModified;

  if (rangeHeader && ifRangeMatches && totalSize > 0) {
    const parsed = parseSingleByteRange(rangeHeader, totalSize);
    if (parsed === 'invalid') {
      res.status(416);
      res.setHeader('Content-Range', `bytes */${totalSize}`);
      res.end();
      return;
    }

    const { start, end } = parsed;
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', String(chunkSize));

    if (isHead) {
      res.end();
      return;
    }

    const stream = fs.createReadStream(safePath, { start, end });
    req.on('close', () => stream.destroy());
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
    stream.pipe(res);
    return;
  }

  res.status(200);
  res.setHeader('Content-Length', String(totalSize));

  if (isHead) {
    res.end();
    return;
  }

  const stream = fs.createReadStream(safePath);
  req.on('close', () => stream.destroy());
  stream.on('error', () => {
    if (!res.headersSent) res.status(500).end();
    else res.end();
  });
  stream.pipe(res);
}

app.head('/api/downloads/:id/file', (req: Request, res: Response) => {
  handleServeFile(req, res, true);
});

app.get('/api/downloads/:id/file', (req: Request, res: Response) => {
  handleServeFile(req, res, false);
});

// Live Server-Sent Events stream
app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  manager.addSseClient(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    manager.removeSseClient(res);
  });
});

async function setupFrontendAndStart() {
  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.join(distDir, 'index.html');
  const useStaticDist = process.env.NODE_ENV === 'production' && fs.existsSync(distIndex);

  if (useStaticDist) {
    app.use(express.static(distDir));
    app.use((req: Request, res: Response, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(distIndex);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[ResumeDL] Server running at http://${HOST}:${PORT}`);
  });

  const shutdown = () => {
    manager.stop();
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void setupFrontendAndStart();
