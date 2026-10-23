/** Small cold-seek buckets avoid decoding up to 29 unwanted seconds at 2x. */
export const SEEK_BUCKET_SECONDS = 4;
export const bucketSeekStart = value => {
  const at = Number(value);
  if (!Number.isFinite(at) || at <= 0) return 0;
  if (at < SEEK_BUCKET_SECONDS) return Math.floor(at);
  return Math.floor(at / SEEK_BUCKET_SECONDS) * SEEK_BUCKET_SECONDS;
};

/** The requested frame plus a full segment must exist before seeking is ready. */
export const seekBufferFloor = ({ requestedAt, origin, segmentSeconds = 4 }) =>
  Math.ceil(Math.max(segmentSeconds, Math.max(0, requestedAt - origin) + segmentSeconds));

/** Only reduce the head start after observing new segments faster than realtime. */
export function startupTarget({ configuredSeconds, minimumSeconds, initialDuration,
  bufferedSeconds, elapsedMs, segmentSeconds = 4, seeking = false }) {
  if (seeking) return minimumSeconds;
  const produced = bufferedSeconds - initialDuration;
  const measuredFast = elapsedMs >= 500 && produced >= segmentSeconds
    && produced / (elapsedMs / 1000) >= 1.25;
  return measuredFast ? Math.min(configuredSeconds, minimumSeconds) : configuredSeconds;
}

export function sessionStartupTarget(session, fallback) {
  return Number.isFinite(session.startupTargetSeconds) && session.startupTargetSeconds >= 4
    ? session.startupTargetSeconds : fallback;
}

export const hasPlayableBuffer = (state, seconds) => Boolean(state.exists
  && state.duration > 0 && (state.duration >= seconds || state.ended));
