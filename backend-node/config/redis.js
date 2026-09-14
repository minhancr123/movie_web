import IORedis from 'ioredis';

// Dedicated cache client. BullMQ keeps its own connection in config/queue.js so a
// slow cache command can never stall the job queue (and vice versa).
const redisUrl =
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
export const cached = async (key, ttlSeconds, loader) => {
  const hit = await getCache(key);
  if (hit !== null) return hit;

  const value = await loader();
  if (value !== null && value !== undefined) {
    await setCache(key, value, ttlSeconds);
  }
  return value;
};
