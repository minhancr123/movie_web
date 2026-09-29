import { cacheClient } from '../config/redis.js';

// Sliding-window limiter backed by a Redis sorted set.
// Fails open: if Redis is unavailable the request is allowed through.
export const rateLimit = ({ windowMs = 60_000, max = 120, keyPrefix = 'rl' } = {}) => {
  const windowSeconds = Math.ceil(windowMs / 1000);

  return async (req, res, next) => {
    // Container-internal callers are not a crowd and must not spend a client
    // budget. The frontend's server render reaches the API straight over the
    // compose network: no user, and no X-Forwarded-For, so `req.ip` is the one
    // address every render shares. Keying it like a client put a home page —
    // which is itself several catalog calls (/home plus the people behind it) —
    // one revalidation away from 429, and getHome() turns a 429 into an empty
    // list, which the page renders as a dead homepage rather than a slow one.
    // The API port is published on loopback and Caddy always stamps the
    // client's address, so a request with no X-Forwarded-For cannot have come
    // off the internet.
    if (!req.headers['x-forwarded-for']) return next();

    const identity = req.user?.userId || req.ip || 'anonymous';
    const key = `${keyPrefix}:${identity}`;
    const now = Date.now();

    try {
      const results = await cacheClient
        .multi()
        .zremrangebyscore(key, 0, now - windowMs)
        .zadd(key, now, `${now}-${Math.random().toString(36).slice(2, 10)}`)
        .zcard(key)
        .pexpire(key, windowMs)
        .exec();

      const count = Number(results?.[2]?.[1] || 0);
      if (count > max) {
        res.setHeader('Retry-After', String(windowSeconds));
        return res.status(429).json({
          success: false,
          message: 'Quá nhiều yêu cầu, vui lòng thử lại sau',
        });
      }
    } catch {
      // Redis down: do not block traffic on a cache outage.
    }

    return next();
  };
};

export const catalogRateLimit = rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'rl:catalog' });
export const playbackRateLimit = rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'rl:playback' });
// HLS playback is inherently chatty: a 4s-segment stream pulls ~15 segments a
// minute plus playlist refreshes, so asset serving needs its own headroom.
// Resolve stays at 30/min because each call can create a TorBox torrent.
export const hlsAssetRateLimit = rateLimit({ windowMs: 60_000, max: 3000, keyPrefix: 'rl:hls' });
// Session polling runs on a timer while a torrent caches; it touches TorBox but
// never creates anything, so it gets a middle tier.
export const playbackPollRateLimit = rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'rl:poll' });
// Presence is the signal that keeps a writer alive: it must never starve
// behind the chatty pollers sharing rl:poll (stage/session/subtitle-job
// polls can exceed 100/min across two tabs). Own bucket, generous ceiling —
// a heartbeat every 25s costs ~3/min per tab.
export const playbackPresenceRateLimit = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'rl:presence' });
export const connectionsRateLimit = rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'rl:conn' });
