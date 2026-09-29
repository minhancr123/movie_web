/**
 * Retry backoff for 503 resolve refusals (REMUX_BUSY / NO_SPACE / slow source).
 *
 * A single-slot server plus a fixed 8s retry on every client is a thundering
 * herd: N waiting viewers re-hit the same second. Full-jitter exponential
 * backoff spreads them (~5-8s, ~10-15s, ~15-20s) while staying inside the
 * player's existing 3-attempt ladder.
 */
export const BUSY_RETRY_ATTEMPTS = 3;

const BASE_DELAYS_MS = [5000, 10000, 15000];
const JITTER_MS = [3000, 5000, 5000];

export const busyRetryDelayMs = (attempt: number): number => {
  const index = Math.min(Math.max(Math.floor(Number(attempt) || 1), 1), BASE_DELAYS_MS.length) - 1;
  return BASE_DELAYS_MS[index] + Math.floor(Math.random() * JITTER_MS[index]);
};
