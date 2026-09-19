FROM node:20-alpine

# ffmpeg and ffprobe are not optional extras here: every playback request
# remuxes the source, probes it and extracts subtitles through them. Without
# this line the image starts cleanly and then dies on the first play with
# "spawn ffmpeg ENOENT", which reads like an application bug rather than a
# missing dependency. tini reaps the ffmpeg children a superseded writer
# leaves behind, so they do not pile up as zombies over a long uptime.
RUN apk add --no-cache ffmpeg tini

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose port
EXPOSE 5001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:5001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
