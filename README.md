# ResumeDL

A cloud-deployable and local web application for downloading YouTube videos (video + audio merged) and MP3 audio with automatic pause and resume when your connection drops. Downloads are executed server-side via `yt-dlp` and `ffmpeg`, keeping `.part` files intact so interrupted downloads continue from the exact byte offset, and serving completed files to your device with full **HTTP Range** (`206 Partial Content`) resume support.

## Features

- **Video Info Lookup**: Paste any YouTube URL to fetch title, thumbnail, channel, and duration via `yt-dlp --dump-json`.
- **Quality Presets**: Choose `Best`, `1080p`, `720p`, `480p` (merged MP4), or `Audio only (mp3)`.
- **Automatic Network-Drop Recovery**: Polls `https://www.google.com/generate_204` every 3 seconds. If offline, active `yt-dlp` jobs stop cleanly while preserving `.part` files (`"Paused - waiting for network"`) and automatically resume once online.
- **Resumable Client Downloads (HTTP Range)**: Finished files in `./downloads` are served with `Accept-Ranges: bytes`, `ETag`, `If-Range`, and `206 Partial Content` responses so browser or mobile download managers can pause and resume transfers.
- **Storage Guardrails & Auto-Cleanup**: Limits disk usage in `./downloads` (`MAX_STORAGE_MB`, default `2048` MB / 2 GB) and automatically deletes finished files 1 hour (`FILE_TTL_MINUTES`, default `60`) after they are fetched.
- **Persistent Queue**: Queue state is saved atomically to `downloads.json` so unfinished downloads resume after restarts.
- **Health & Dependency Checks**: Exposes `GET /health` (`200 OK`), verifies `yt-dlp` and `ffmpeg` on startup, and includes an **Update yt-dlp** (`yt-dlp -U`) button.

---

## Cloud Deployment (Docker)

### 1. Deploy to Render

1. Push this repository to GitHub or GitLab.
2. In the [Render Dashboard](https://dashboard.render.com/), click **New +** -> **Web Service**.
3. Connect your repository and configure:
   - **Language / Runtime**: `Docker` (Render automatically detects the root `Dockerfile`).
   - **Health Check Path**: `/health`
   - **Environment Variables** (optional):
     - `MAX_STORAGE_MB=2048` (adjust based on your instance disk size; free instances have ephemeral storage)
     - `FILE_TTL_MINUTES=60`
     - *Note*: Render automatically injects `PORT` (typically `10000`). `server.ts` listens on `process.env.PORT || 3000` and binds to `0.0.0.0`, so no manual `PORT` override is needed.
4. Click **Create Web Service**. Render builds the Docker image (`node:20-slim` + `ffmpeg` + `python3` + `yt-dlp`), runs `npm run build`, and starts the app with `npm start`.

### 2. Deploy to Hugging Face Spaces

Hugging Face Spaces routes HTTP traffic to port **`7860`** by default unless `app_port` is specified.

1. Create a new Space at [huggingface.co/new-space](https://huggingface.co/new-space):
   - **Space SDK**: `Docker` -> **Blank**
   - **Hardware**: `CPU basic (free)`
2. Push this repository to the Space's Git remote.
3. Set the Space's port using **either** method:
   - **Option A (Recommended — Environment Variable)**: In your Space **Settings** -> **Variables and secrets**, add:
     - `PORT` = `7860`
     - `MAX_STORAGE_MB` = `2048` (optional)
     - `FILE_TTL_MINUTES` = `60` (optional)
   - **Option B (Spaces README frontmatter)**: Add the YAML block below to the very top of `README.md` in your Space repository so Hugging Face connects directly to port `3000`:
     ```yaml
     ---
     title: ResumeDL
     sdk: docker
     app_port: 3000
     ---
     ```
4. Hugging Face Spaces builds the `Dockerfile`, runs `npm start`, and exposes the web UI on your Space URL.

### 3. Run Locally with Docker

```bash
docker build -t resumedl .
docker run -p 3000:3000 -e MAX_STORAGE_MB=2048 -e FILE_TTL_MINUTES=60 resumedl
```

Open `http://localhost:3000`.

---

## Local Setup (Without Docker)

### Prerequisites

1. **Node.js 20+**
2. **yt-dlp**
3. **ffmpeg**

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
sudo apt update && sudo apt install -y ffmpeg python3 curl
sudo curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

### Install & Start

```bash
npm install
npm run build
npm start
```

Open **http://localhost:3000** in your browser.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port bound on `0.0.0.0` (automatically set by Render; set to `7860` on HF Spaces unless `app_port: 3000` is set). |
| `MAX_STORAGE_MB` | `2048` | Maximum disk usage allowed in `./downloads` (in MB) before rejecting new downloads. |
| `FILE_TTL_MINUTES` | `60` | Minutes after a completed file is fetched before it is automatically deleted. |
