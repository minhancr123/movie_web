import { cacheClient } from '../config/redis.js';

// Sliding-window limiter backed by a Redis sorted set.
// Fails open: if Redis is unavailable the request is allowed through.
export const rateLimit = ({ windowMs = 60_000, max = 120, keyPrefix = 'rl' } = {}) => {
  const windowSeconds = Math.ceil(windowMs / 1000);

  return async (req, res, next) => {
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
export const connectionsRateLimit = rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'rl:conn' });
