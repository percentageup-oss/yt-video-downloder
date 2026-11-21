# ResumeDL

A local web application for downloading large YouTube videos (video + audio merged) and audio tracks with automatic pause and resume whenever your internet connection drops. Downloads are executed server-side via `yt-dlp` and `ffmpeg`, preserving `.part` files so progress is never lost or restarted from zero.

## Features

- **Video Info Lookup**: Paste any YouTube URL to fetch title, thumbnail, channel, and duration via `yt-dlp --dump-json`.
- **Quality Presets**: Choose `Best`, `1080p`, `720p`, `480p` (merged MP4), or `Audio only (mp3)`.
- **Automatic Network Drop Recovery**: Checks connectivity every 3 seconds (`https://www.google.com/generate_204`). When offline, active downloads stop cleanly while preserving `.part` files and enter `"Paused - waiting for network"`. When connectivity returns, downloads resume automatically from the exact byte offset.
- **Persistent Queue**: Download queue state is saved to `downloads.json` so unfinished downloads automatically resume after an app restart.
- **Manual Controls & Live Progress**: Pause, Resume, Retry, and Cancel (Cancel deletes partial/downloaded files for that item) with real-time progress, speed, ETA, and downloaded size streamed via Server-Sent Events (SSE).
- **Dependency Check & Self-Updater**: Verifies `yt-dlp` and `ffmpeg` on startup, shows OS-specific setup instructions if missing, and includes an **Update yt-dlp** (`yt-dlp -U`) button.

## Prerequisites

1. **Node.js 20+** (Node.js 22+ recommended)
2. **yt-dlp**
3. **ffmpeg**

### Install `yt-dlp` and `ffmpeg`

**macOS (Homebrew)**
```bash
brew install yt-dlp ffmpeg
```

**Windows (winget)**
```powershell
winget install yt-dlp.yt-dlp Gyan.FFmpeg
```

**Ubuntu / Debian Linux**
```bash
sudo apt update && sudo apt install -y ffmpeg python3-pip pipx
pipx install yt-dlp
pipx ensurepath
```

Verify both tools are available on your `PATH`:
```bash
yt-dlp --version
ffmpeg -version
```

## Setup & Run

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

For development with Vite HMR/middleware:
```bash
npm run dev
```

For a production build:
```bash
npm run build
NODE_ENV=production npm start
```

## Project Structure

```
.
├── downloads/                # Saved videos, audio files, and .part resume fragments
├── downloads.json            # Persisted queue state across restarts
├── index.html                # App entry HTML
├── package.json              # Scripts and dependencies
├── README.md                 # Setup and usage documentation
├── server.ts                 # Express server, API routes, SSE stream, static/Vite serving
├── server/
│   ├── downloadManager.ts    # Queue runner, yt-dlp process manager, 3s connectivity watcher
│   ├── systemCheck.ts        # Checks yt-dlp & ffmpeg binaries, runs yt-dlp -U
│   ├── types.ts              # Backend TypeScript types
│   └── validators.ts         # URL validation, quality allowlist, safe file confinement
├── src/
│   ├── App.tsx               # Main React application
│   ├── index.css             # Tailwind CSS v4 styles and font setup
│   ├── main.tsx              # React DOM entry point
│   ├── types.ts              # Frontend TypeScript types
│   └── components/
│       ├── AddDownloadForm.tsx
│       ├── DownloadCard.tsx
│       ├── Header.tsx
│       └── SystemBanner.tsx
├── tsconfig.json
└── vite.config.ts
```
