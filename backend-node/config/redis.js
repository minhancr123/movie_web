import IORedis from 'ioredis';

// Dedicated cache client. BullMQ keeps its own connection in config/queue.js so a
// slow cache command can never stall the job queue (and vice versa).
//
// Split-brain rule: cache and queue MUST be separate Redis instances in
// production. Catalog cache (≈78k keys and growing, plus 7-day stale copies)
// will always fill whatever cap it gets; under `noeviction` that starts
// refusing BullMQ job writes (trackViewAsync et al.) with OOM. The cache
// instance runs allkeys-lru so pressure evicts cold catalog rows instead.
// REDIS_CACHE_URL wins; REDIS_URL remains as the single-instance fallback so
// dev, tests and the test compose keep working with one container.
const redisUrl =
  process.env.REDIS_CACHE_URL ||
  process.env.REDIS_URL ||
  `redis://${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`;

export const cacheClient = new IORedis(redisUrl, {
  lazyConnect: false,
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy(times) {
    if (times > 3) return null; // ngắt reconnect spam nếu Redis không phản hồi
    return Math.min(times * 500, 2000);
  },
});

let warned = false;
cacheClient.on('error', (error) => {
  // Cache is best-effort: log once, then let every call fall through to the source.
  if (!warned) {
    console.error('[cache] Redis error, tạm thời bỏ qua cache:', error.message);
    warned = true;
  }
});
cacheClient.on('ready', () => {
  warned = false;
});

export const CACHE_TTL = {
  HOME: 30 * 60,
  SEARCH: 15 * 60,
  DISCOVER: 15 * 60,
  DETAIL: 24 * 60 * 60,
  SEASON: 6 * 60 * 60,
  GENRES: 7 * 24 * 60 * 60,
};

export const getCache = async (key) => {
  try {
    const raw = await cacheClient.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const setCache = async (key, value, ttlSeconds) => {
  try {
    await cacheClient.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    // best-effort
  }
};

// Read-through cache. On a cache miss the loader runs and its result is stored.
//
// Opt-in stale-while-revalidate for flaky upstreams (TMDB SNI resets): pass
// { staleOnError: true, staleTtlSeconds }. Every successful load also writes a
// long-lived stale copy; when the loader throws, the stale copy is served
// instead of the error — never served while fresh loads succeed. Callers
// without opts behave exactly as before (no extra writes, no behavior change).
export const cachedIn = async (store, key, ttlSeconds, loader, opts = {}) => {
  const hit = await store.get(key);
  if (hit !== null) return hit;

  const staleKey = `${key}:stale`;
  try {
    const value = await loader();
    if (value !== null && value !== undefined) {
      await store.set(key, value, ttlSeconds);
      if (opts.staleOnError && Number(opts.staleTtlSeconds) > 0) {
        await store.set(staleKey, value, Number(opts.staleTtlSeconds));
      }
    }
    return value;
  } catch (error) {
    if (!opts.staleOnError) throw error;
    const stale = await store.get(staleKey).catch(() => null);
    if (stale !== null) {
      console.warn(`[cache] ${key} loader lỗi, trả bản stale:`, error?.message || error);
      // Backfill the stale copy under the live key with a short TTL so the
      // next minute of traffic is served instantly instead of every request
      // paying a full loader retry chain against a dead upstream.
      try {
        const fallbackTtl = Number(opts.staleFallbackTtlSeconds) > 0
          ? Number(opts.staleFallbackTtlSeconds)
          : 60;
        await store.set(key, stale, fallbackTtl);
      } catch {
        // best-effort
      }
      return stale;
    }
    throw error;
  }
};

export const cached = async (key, ttlSeconds, loader, opts = {}) =>
  cachedIn({ get: getCache, set: setCache }, key, ttlSeconds, loader, opts);
