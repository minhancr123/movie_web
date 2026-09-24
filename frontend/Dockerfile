# syntax=docker/dockerfile:1

# ──────────────────────────────────────────────────────────────────
# Cineon frontend – Next.js 16 multi-stage with standalone output
# ──────────────────────────────────────────────────────────────────

# ── Stage 1: Build ──
FROM node:24-slim AS builder
WORKDIR /app

# Build-time environment variables baked into the client bundle
ARG NEXT_PUBLIC_BACKEND_API_URL
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SOCKET_URL
ARG NEXT_PUBLIC_IMAGE_PREFIX
ARG RELEASE_ID

COPY package*.json ./
RUN npm ci --ignore-scripts

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=192
ENV NEXT_PUBLIC_BACKEND_API_URL=$NEXT_PUBLIC_BACKEND_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SOCKET_URL=$NEXT_PUBLIC_SOCKET_URL
ENV NEXT_PUBLIC_IMAGE_PREFIX=$NEXT_PUBLIC_IMAGE_PREFIX
ENV RELEASE_ID=$RELEASE_ID

# Build with webpack (explicit for Next 16)
RUN npm run build

# ── Stage 2: Runtime ──
FROM node:24-slim AS runner
WORKDIR /app

ARG RELEASE_ID
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV RELEASE_ID=${RELEASE_ID}

# Create non-root user
RUN groupadd -r cineon && useradd -r -g cineon -d /app cineon

# Copy standalone output
COPY --from=builder --chown=cineon:cineon /app/.next/standalone ./
COPY --from=builder --chown=cineon:cineon /app/.next/static ./.next/static
COPY --from=builder --chown=cineon:cineon /app/public ./public

USER cineon
EXPOSE 3000

# Health check using the /api/health endpoint
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) })" || exit 1

CMD ["node", "--max-old-space-size=512", "server.js"]
