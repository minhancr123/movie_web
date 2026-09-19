/**
 * Live stages of an in-flight POST /playback/resolve.
 *
 * A cold resolve holds its HTTP connection open for up to a couple of minutes
 * on a slow upstream (TorBox API calls, ffprobe, ffmpeg warm-up), so without
 * this the client can only guess the phase — it used to light up step pills
 * by elapsed seconds. The client generates a resolveId, sends it with the
 * resolve body, and polls GET /playback/resolve/:id/stage while it waits.
 *
 * Process-local and bounded: unknown ids 404, entries rot after a few
 * minutes, and the map is capped. A failed resolve simply stops updating —
 * the client already holds the HTTP error, so no terminal state is needed.
 */

export const RESOLVE_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
export const RESOLVE_STAGE_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

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
  stages.set(resolveId, {
    stage,
    detail: String(detail ?? ''),
    updatedAt: Date.now(),
    history,
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

export const clearResolveStages = () => {
  stages.clear();
};
