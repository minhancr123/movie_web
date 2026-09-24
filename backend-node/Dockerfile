# syntax=docker/dockerfile:1

# ──────────────────────────────────────────────────────────────────
# Cineon backend – Node 24 Debian slim with FFmpeg + tini
# ──────────────────────────────────────────────────────────────────
# ffmpeg and ffprobe are not optional extras here: every playback request
# remuxes the source, probes it and extracts subtitles through them. Without
# this line the image starts cleanly and then dies on the first play with
# "spawn ffmpeg ENOENT", which reads like an application bug rather than a
# missing dependency. tini reaps the ffmpeg children a superseded writer
# leaves behind, so they do not pile up as zombies over a long uptime.

FROM node:24-slim

ARG RELEASE_ID
ENV RELEASE_ID=${RELEASE_ID}
ENV NODE_ENV=production

# Install system dependencies: FFmpeg for remux/transcode, tini for PID 1
RUN apt-get update -qq \
    && apt-get install -y --no-install-recommends \
       ffmpeg tini curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

# Copy source code
COPY . .

# Create non-root user and set up volume mount points
RUN groupadd -r cineon && useradd -r -g cineon -d /app cineon \
    && mkdir -p /data/transcodes \
    && chown -R cineon:cineon /app /data/transcodes

USER cineon

EXPOSE 5001

# Health check using the /healthz endpoint wired in F3
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD curl -sf http://localhost:5001/healthz || exit 1

# tini as PID 1 reaps zombie ffmpeg processes
ENTRYPOINT ["tini", "--"]
CMD ["node", "--max-old-space-size=1024", "server.js"]
