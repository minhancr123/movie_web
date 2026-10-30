import crypto from 'node:crypto';

export function pinnedDiscoveryScope(params, env = process.env) {
  if (!params.debridKey) return null;
  return crypto.createHash('sha256').update(JSON.stringify([
    params.debridKey, env.STREAM_SOURCE_PROVIDER || '', env.STREMIO_ADDONS || '',
    env.AIOSTREAMS_USER_DATA || '', env.AIOSTREAMS_BASE_URL || '',
    params.imdbId, params.mediaType, params.season ?? null, params.episode ?? null,
  ])).digest('hex');
}

/** Short-lived discovery metadata only. Provider entitlement/link preparation
 * still runs in resolve. A pin never turns into Auto on a cache miss.
 */
export function createPinnedDiscoveryResolver(load, { scopeOf, matches, identityOf,
  now = Date.now, ttlMs = 60000, maxEntries = 64, maxCandidates = 160 } = {}) {
  if (!(ttlMs > 0 && Number.isFinite(ttlMs) && Number.isInteger(maxEntries) && maxEntries > 0
    && Number.isInteger(maxCandidates) && maxCandidates > 0)) throw new RangeError('Invalid discovery cache bounds');
  const pools = new Map();
  let generation = 0;
  return async params => {
    const scope = scopeOf(params);
    if (params.requestDiscovery) { pools.delete(scope); generation += 1; }
    const startedGeneration = generation;
    if (scope && params.sourceToken && !params.requestDiscovery) {
      const entry = pools.get(scope);
      if (entry?.until > now()) {
        const found = entry.candidates.filter(c => matches(c, params.sourceToken));
        // A bare torrent hash can match different pack files: rediscover rather
        // than invent which file the caller intended.
        if (found.length && new Set(found.map(identityOf)).size === 1) {
          return { candidates: [structuredClone(found[0])], errors: [] };
        }
      }
      if (entry?.until <= now()) pools.delete(scope);
    }
    const result = await load(params);
    if (scope && !params.requestDiscovery && startedGeneration === generation && result?.candidates?.length) {
      for (const [key, value] of pools) if (value.until <= now()) pools.delete(key);
      pools.delete(scope);
      while (pools.size >= maxEntries) pools.delete(pools.keys().next().value);
      pools.set(scope, { until: now() + ttlMs,
        candidates: structuredClone(result.candidates.slice(0, maxCandidates)) });
    }
    return result;
  };
}

export function candidatesForPin(candidates, token, matches) {
  if (!token) return candidates;
  // Legacy bare hashes may name several pack files. Keep those matches for
  // the existing ranker instead of choosing the addon's arbitrary first row.
  return candidates.filter(c => matches(c, token));
}

/** Do not reuse another file in the same pack. Legacy sessions need an exact
 * full filename match; basenames alone can collide in different directories.
 */
export function reusableSourceFile(session, candidate, identityOf) {
  if (!session || !candidate || session.fileId == null || !/^[a-f0-9]{40}$/i.test(candidate.infoHash || '')
    || String(session.infoHash || '').toLowerCase() !== candidate.infoHash.toLowerCase()) return false;
  if (session.sourceIdentity) return session.sourceIdentity === identityOf(candidate);
  const normalize = name => String(name || '').trim().replace(/\\/g, '/').toLowerCase();
  return Boolean(candidate.filename && session.sourceFileName
    && normalize(candidate.filename) === normalize(session.sourceFileName));
}
