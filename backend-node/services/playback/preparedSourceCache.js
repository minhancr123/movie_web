import crypto from 'node:crypto';

/** Repeated seeks need the same immutable file inventory, not another TorBox
 * account listing. Keep only ready results briefly, isolated by credential.
 * Fresh checks bypass and invalidate it; links and credentials are not stored.
 */
export function createPreparedSourceCache(prepare, { now = Date.now, ttlMs = 30000, maxEntries = 64 } = {}) {
  const ready = new Map();
  const flights = new Map();
  return async (credential, request) => {
    const identity = request.infoHash ? `hash:${String(request.infoHash).toLowerCase()}`
      : request.torrentId != null ? `id:${request.torrentId}` : null;
    if (!credential || !identity) return prepare(credential, request);
    const key = crypto.createHash('sha256').update(credential).digest('hex') + ':' + identity;
    if (!request.assumeCached) {
      ready.delete(key);
      flights.delete(key); // An older cached lookup cannot repopulate it later.
    } else {
      const cached = ready.get(key);
      if (cached?.until > now()) return structuredClone(cached.value);
      ready.delete(key);
    }
    if (!flights.has(key)) {
      const flight = Promise.resolve().then(() => prepare(credential, request)).then(value => {
        if (flights.get(key) === flight && value?.state === 'ready' && value.files?.length) {
          for (const [id, entry] of ready) if (entry.until <= now()) ready.delete(id);
          while (ready.size >= maxEntries) ready.delete(ready.keys().next().value);
          ready.set(key, { value: structuredClone(value), until: now() + ttlMs });
        }
        return value;
      }).finally(() => { if (flights.get(key) === flight) flights.delete(key); });
      flights.set(key, flight);
    }
    return structuredClone(await flights.get(key));
  };
}
