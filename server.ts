import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DownloadManager, DOWNLOADS_DIR } from './server/downloadManager.ts';
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

app.use(express.json({ limit: '64kb' }));

const manager = new DownloadManager();

// Check startup binaries and log status clearly
void getSystemStatus(true, Date.now(), DOWNLOADS_DIR).then((status) => {
  console.log(
    `[ResumeDL] yt-dlp: ${status.ytdlp.installed ? status.ytdlp.version : 'MISSING'} | ffmpeg: ${status.ffmpeg.installed ? status.ffmpeg.version : 'MISSING'}`
  );
});

manager.start();

// System check & yt-dlp updater
app.get('/api/system', async (_req: Request, res: Response) => {
  const { online, lastNetworkCheck } = manager.getOnlineStatus();
  const status = await getSystemStatus(online, lastNetworkCheck, DOWNLOADS_DIR);
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
  res.json({ items: manager.getItems() });
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
  const item = manager.resumeDownload(id);
  if (!item) {
    res.status(404).json({ error: 'Download item not found.' });
    return;
  }
  res.json(item);
});

app.delete('/api/downloads/:id', async (req: Request, res: Response) => {
  const id = validateItemId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Invalid download ID.' });
    return;
  }
  const keepFiles = req.query.keepFiles === 'true';
  const removed = await manager.cancelDownload(id, !keepFiles);
  if (!removed) {
    res.status(404).json({ error: 'Download item not found.' });
    return;
  }
  res.json({ ok: true, id });
});

app.get('/api/downloads/:id/file', (req: Request, res: Response) => {
  const id = validateItemId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Invalid download ID.' });
    return;
  }
  const item = manager.getItem(id);
  if (!item || !item.outputFile) {
    res.status(404).json({ error: 'Completed file not found.' });
    return;
  }
  const safePath = resolveSafeDownloadPath(DOWNLOADS_DIR, item.outputFile);
  if (!safePath || !fs.existsSync(safePath)) {
    res.status(404).json({ error: 'File no longer exists in ./downloads.' });
    return;
  }
  res.download(safePath, item.outputFile);
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
