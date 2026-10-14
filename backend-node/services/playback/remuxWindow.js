/** Bounded VOD chunks, never a sliding/live playlist. Old clients opt out. */
export const remuxWindowSeconds = (supported, env = process.env) => {
  const seconds = Number(env.PLAYBACK_REMUX_WINDOW_SECONDS);
  return supported && Number.isFinite(seconds) && seconds >= 60
    ? Math.min(900, Math.floor(seconds)) : 0;
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
export const completedSessionCovers = (startAt, duration, requestedAt) =>
  requestedAt >= Math.max(0, (Number(startAt) || 0) - 1)
  && requestedAt < (Number(startAt) || 0) + duration - 2;
