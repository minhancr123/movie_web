/**
 * Live stages of an in-flight POST /playback/resolve.
 *
 * ENHANCED with observability timing: each stage records start/end timestamps
 * so the dashboard can break down where resolve time is spent.
 *
 * Process-local and bounded: entries rot after a few minutes, and the map is
 * capped. A failed resolve simply stops updating — the client already holds
 * the HTTP error, so no terminal state is needed.
 */

export const RESOLVE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const RESOLVE_STAGE_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;
const MAX_TIMINGS = 20;

const stages = new Map();

export const isResolveId = (value) =>
  typeof value === 'string' && RESOLVE_ID_PATTERN.test(value);

export const setResolveStage = (resolveId, stage, detail = '') => {
  if (!isResolveId(resolveId) || typeof stage !== 'string' || !stage) return false;
  if (!stages.has(resolveId) && stages.size >= MAX_ENTRIES) {
    stages.delete(stages.keys().next().value);
  }
  const prev = stages.get(resolveId);
  const history = prev?.history || [];
  history.push({ stage, detail: String(detail ?? ''), at: Date.now() });
  while (history.length > 30) history.shift();

  // Observability: track timing for each stage
  const timings = prev?.timings || [];
  const lastTiming = timings.length ? timings[timings.length - 1] : null;
  if (lastTiming && lastTiming.end === null) {
    lastTiming.end = Date.now();
    lastTiming.durationMs = lastTiming.end - lastTiming.start;
  }
  timings.push({ stage, start: Date.now(), end: null, durationMs: null });
  while (timings.length > MAX_TIMINGS) timings.shift();

  stages.set(resolveId, {
    stage,
    detail: String(detail ?? ''),
    updatedAt: Date.now(),
    startedAt: prev?.startedAt ?? timings[0].start,
    finishedAt: null,
    history,
    timings,
  });
  return true;
};

export const getResolveStage = (resolveId, now = Date.now()) => {
  if (!isResolveId(resolveId)) return null;
  const entry = stages.get(resolveId);
  if (!entry) return null;
  if (now - entry.updatedAt > RESOLVE_STAGE_TTL_MS) {
    stages.delete(resolveId);
    return null;
  }
  return entry;
};

/** Closing is a write operation, called only when the request completes. */
export const finishResolveStages = (resolveId, now = Date.now()) => {
  const entry = getResolveStage(resolveId, now);
  if (!entry || entry.finishedAt !== null) return false;
  const last = entry.timings.at(-1);
  if (last && last.end === null) { last.end = now; last.durationMs = Math.max(0, now - last.start); }
  entry.finishedAt = now;
  return true;
};
const summarize = (resolveId, entry, now) => ({
  resolveId, currentStage: entry.stage,
  totalMs: Math.max(0, (entry.finishedAt ?? now) - entry.startedAt),
  stages: entry.timings.map(t => ({ stage: t.stage,
    durationMs: t.end === null ? Math.max(0, now - t.start) : t.durationMs })),
});
export const getResolveTimings = (resolveId, now = Date.now()) => {
  const entry = getResolveStage(resolveId, now);
  return entry ? summarize(resolveId, entry, now) : null;
};

export const clearResolveStages = () => {
  stages.clear();
};

/** Export all active resolve timings for dashboard aggregation. */
export const getAllResolveTimings = (now = Date.now()) => {
  const result = [];
  for (const id of stages.keys()) {
    const entry = getResolveStage(id, now);
    if (entry) result.push(summarize(id, entry, now));
  }
  return result;
};
