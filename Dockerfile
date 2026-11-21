FROM node:20-slim

# Install ffmpeg, python3, curl, and latest yt-dlp binary in /usr/local/bin
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies and build frontend
COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build

# Ensure runtime downloads directory exists
RUN mkdir -p /app/downloads

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "start"]
