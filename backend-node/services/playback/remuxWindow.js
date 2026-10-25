/** Bounded VOD chunks, never a sliding/live playlist. Old clients opt out. */
export const remuxWindowSeconds = (supported, env = process.env) => {
  const seconds = Number(env.PLAYBACK_REMUX_WINDOW_SECONDS);
  return supported && Number.isFinite(seconds) && seconds >= 60
    ? Math.min(900, Math.floor(seconds)) : 0;
};
/** Size only NEW windows; never truncate a writer already serving viewers.
 * Fixed tiers keep sessions reusable as pressure changes. Byte limits still
 * apply afterwards; this policy changes duration, never bitrate or quality.
 */
export const loadAdjustedWindowSeconds = (requested, { active = 0, limit = 0, queued = 0 } = {}, env = process.env) => {
  if (!requested || env.PLAYBACK_ADAPTIVE_WINDOW !== '1') return requested;
  if (!(Number.isFinite(active) && active >= 0 && Number.isFinite(limit) && limit > 0
    && Number.isFinite(queued) && queued >= 0)) return requested;
  const ceiling = queued > 0 || active >= limit ? 300
    : active >= Math.ceil(limit / 2) ? 600 : 900;
  return Math.min(requested, ceiling);
};
export const pricedRemuxSeconds = (duration, windowSeconds, startAt = 0) => {
  if (!windowSeconds) return duration;
  const remaining = Number(duration) - Math.max(0, Number(startAt) || 0);
  return Number.isFinite(remaining) && remaining > 0
    ? Math.min(windowSeconds, remaining) : windowSeconds;
};
/** Keep high-bitrate chunks smaller too, leaving margin for audio/VBR peaks. */
export const budgetedWindowSeconds = (kbps, requested, maxBytes = 1024 ** 3) => {
  if (!requested) return 0;
  if (!(Number(kbps) > 0)) return requested;
  const seconds = Math.min(requested, Math.floor(maxBytes * 0.85 * 8 / (kbps * 1000)));
  return seconds >= 60 ? seconds : 0;
};
export const completedSessionCovers = (startAt, duration, requestedAt, minRunwaySeconds = 30) => {
  const head = (Number(startAt) || 0) + duration;
  const start = Math.max(0, (Number(startAt) || 0) - 1);
  const runway = Math.min(minRunwaySeconds, Math.max(2, duration * 0.2));
  return requestedAt >= start && requestedAt < head - runway;
};
