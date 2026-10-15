/** Read-only community timestamps; no account data or provider URLs leave CineVN. */
const cache = new Map();
const MAX_ENTRIES = 256;
export const normalizeTimelineMarks = (payload, { type, tmdbId, season, episode, duration }) => {
  if (!payload || !Number.isFinite(duration) || duration <= 0) return [];
  if (payload.tmdb_id != null && Number(payload.tmdb_id) !== tmdbId) return [];
  if (payload.type && payload.type !== type) return [];
  if (type === 'tv' && ((payload.season != null && Number(payload.season) !== season)
    || (payload.episode != null && Number(payload.episode) !== episode))) return [];
  return ['intro', 'recap', 'credits'].flatMap(kind => (Array.isArray(payload[kind]) ? payload[kind] : []).flatMap(mark => {
    if (!mark || typeof mark !== 'object' || Array.isArray(mark)
      || !Object.hasOwn(mark, 'start_ms') || !Object.hasOwn(mark, 'end_ms')
      || ![mark.start_ms, mark.end_ms].every(value => value === null || (typeof value === 'number' && Number.isFinite(value)))) return [];
    const start = mark?.start_ms == null ? 0 : Number(mark.start_ms) / 1000;
    const end = mark?.end_ms == null ? duration : Number(mark.end_ms) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start
      || end > duration + 1 || start >= duration) return [];
    // Intros/recaps cannot reasonably consume the entire film or episode.
    if (kind !== 'credits' && (end - start > Math.min(600, duration / 2))) return [];
    if (kind === 'credits' && start < duration / 2) return [];
    return [{ kind, start, end: Math.min(end, duration) }];
  })).sort((a, b) => a.start - b.start);
};

export const getTimelineMarks = async (context, { fetchImpl = fetch, now = Date.now } = {}) => {
  const { type, tmdbId, season, episode, duration } = context;
  if (!['movie', 'tv'].includes(type) || !Number.isInteger(tmdbId) || tmdbId <= 0
    || !Number.isFinite(duration) || duration <= 0
    || (type === 'tv' && (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode <= 0))) return [];
  const key = [type, tmdbId, season, episode, Math.round(duration * 1000)].join(':');
  const cached = cache.get(key);
  if (cached?.expires > now()) return cached.marks;
  const url = new URL('https://api.theintrodb.org/v3/media');
  url.searchParams.set('tmdb_id', String(tmdbId));
  url.searchParams.set('duration_ms', String(Math.round(duration * 1000)));
  if (type === 'tv') { url.searchParams.set('season', String(season)); url.searchParams.set('episode', String(episode)); }
  let marks = [], ttl = 120_000;
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(4000), headers: { accept: 'application/json' } });
    if (response.status === 404) ttl = 3600_000;
    else if (response.ok) {
      const text = await response.text();
      if (text.length <= 64_000) {
        marks = normalizeTimelineMarks(JSON.parse(text), context);
        ttl = marks.length ? 24 * 3600_000 : 3600_000;
      }
    }
  } catch { /* Missing timestamps never interfere with playback. */ }
  cache.delete(key);
  cache.set(key, { marks, expires: now() + ttl });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  return marks;
};
