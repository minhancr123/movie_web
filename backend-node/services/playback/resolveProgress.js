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
  if (lastTiming && !lastTiming.end) {
    lastTiming.end = Date.now();
    lastTiming.durationMs = lastTiming.end - lastTiming.start;
  }
  timings.push({ stage, start: Date.now(), end: null, durationMs: null });
  while (timings.length > MAX_TIMINGS) timings.shift();

  stages.set(resolveId, {
    stage,
    detail: String(detail ?? ''),
    updatedAt: Date.now(),
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
  // Close any open timing
  const timings = entry.timings || [];
  const last = timings.length ? timings[timings.length - 1] : null;
  if (last && !last.end) {
    last.end = now;
    last.durationMs = last.end - last.start;
  }
  return entry;
};

/** Get timing summary for a resolve (for observability dashboard). */
export const getResolveTimings = (resolveId) => {
  const entry = getResolveStage(resolveId);
  if (!entry) return null;
  return {
    resolveId,
    currentStage: entry.stage,
    totalMs: entry.timings.length
      ? entry.timings[entry.timings.length - 1].end - entry.timings[0].start
      : 0,
    stages: entry.timings.map((t) => ({
      stage: t.stage,
      durationMs: t.durationMs || 0,
    })),
  };
};

export const clearResolveStages = () => {
  stages.clear();
};

/** Export all active resolve timings for dashboard aggregation. */
export const getAllResolveTimings = () => {
  const result = [];
  for (const [id, entry] of stages) {
    const timings = entry.timings || [];
    if (timings.length === 0) continue;
    const last = timings[timings.length - 1];
    result.push({
      resolveId: id,
      currentStage: entry.stage,
      totalMs: last.end ? last.end - timings[0].start : Date.now() - timings[0].start,
      stages: timings.map((t) => ({
        stage: t.stage,
        durationMs: t.durationMs || (t.end ? t.end - t.start : Date.now() - t.start),
      })),
    });
  }
  return result;
};
