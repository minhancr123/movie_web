/** Small cold-seek buckets avoid decoding up to 29 unwanted seconds at 2x. */
export const SEEK_BUCKET_SECONDS = 4;
export const bucketSeekStart = value => {
  const at = Number(value);
  if (!Number.isFinite(at) || at <= 0) return 0;
  if (at < SEEK_BUCKET_SECONDS) return Math.floor(at);
  return Math.floor(at / SEEK_BUCKET_SECONDS) * SEEK_BUCKET_SECONDS;
};

/** The requested frame plus a full segment must exist before seeking is ready.
 * Keep the fractional boundary: rounding 10.16s up to 11s rejects a complete
 * 10.427s GOP and unnecessarily waits for the next (possibly ten-second) GOP.
 */
export const seekBufferFloor = ({ requestedAt, origin, segmentSeconds = 4 }) =>
  Math.max(segmentSeconds, Math.max(0, requestedAt - origin) + segmentSeconds);

/** Only reduce the head start after observing new segments faster than realtime. */
export function startupTarget({ configuredSeconds, minimumSeconds, initialDuration,
  bufferedSeconds, elapsedMs, writerElapsedMs = null, segmentSeconds = 4, seeking = false }) {
  if (seeking) return minimumSeconds;
  const produced = bufferedSeconds - initialDuration;
  const measuredFast = elapsedMs >= 500 && produced >= segmentSeconds
    && produced / (elapsedMs / 1000) >= 1.25;
  // A long GOP can make the FIRST playlist already exceed the floor. The
  // floor wait then takes 0ms and produces no new segment to measure. Use
  // the fresh writer's actual lifetime too (including network startup), not
  // a filesystem read's latency, so this fast source need not wait another GOP.
  const freshWriterFast = Number.isFinite(writerElapsedMs) && writerElapsedMs >= 500
    && bufferedSeconds >= minimumSeconds && bufferedSeconds >= segmentSeconds
    && bufferedSeconds / (writerElapsedMs / 1000) >= 1.25;
  return measuredFast || freshWriterFast ? Math.min(configuredSeconds, minimumSeconds) : configuredSeconds;
}

export function sessionStartupTarget(session, fallback) {
  return Number.isFinite(session.startupTargetSeconds) && session.startupTargetSeconds >= 4
    ? session.startupTargetSeconds : fallback;
}

/** A copied stream cuts at source keyframes, not exactly every four seconds.
 * A fast first 5.7s GOP should not wait for the following 10s GOP just to cross
 * the nominal 8s floor. Only use the 4s floor after a >=2x fresh-writer sample.
 */
export function initialStartupFloor({ defaultMinimum, bufferedSeconds, writerElapsedMs, seeking }) {
  return !seeking && Number.isFinite(writerElapsedMs) && writerElapsedMs >= 500
    && bufferedSeconds >= 4 && bufferedSeconds / (writerElapsedMs / 1000) >= 2
    ? Math.min(defaultMinimum, 4) : defaultMinimum;
}

/** The HLS endpoint must honour the exact floor already accepted by resolve. */
export const sessionPlaylistFloor = (session, defaultMinimum) =>
  Math.min(defaultMinimum, sessionStartupTarget(session, defaultMinimum));

export const hasPlayableBuffer = (state, seconds) => Boolean(state.exists
  && state.duration > 0 && (state.duration >= seconds || state.ended));
