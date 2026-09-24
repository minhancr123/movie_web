/**
 * Worker/scheduler heartbeat using a Redis key with TTL.
 * If the key expires, the service is considered dead.
 */

/**
 * @param {Object} opts
 * @param {import('ioredis').Redis} opts.redis - Redis client instance
 * @param {string} opts.service - Service name ('worker' or 'scheduler')
 * @param {string} opts.releaseId - Current release identifier
 * @param {number} [opts.intervalMs=20000] - How often to update the heartbeat
 * @param {number} [opts.ttlSeconds=90] - TTL for the heartbeat key
 * @returns {() => void} stop function to cancel the heartbeat
 */
export function startHeartbeat({ redis, service, releaseId, intervalMs = 20000, ttlSeconds = 90 }) {
  const key = `cineon:heartbeat:${service}`;

  const tick = async () => {
    try {
      await redis.set(key, JSON.stringify({ release: releaseId, at: new Date().toISOString() }), 'EX', ttlSeconds);
    } catch (err) {
      // Log but don't crash — a missed heartbeat is detected by TTL expiry
      console.warn(`[heartbeat] ${service} failed to update:`, err.message);
    }
  };

  // Fire immediately, then on interval
  tick();
  const handle = setInterval(tick, intervalMs);

  return function stop() {
    clearInterval(handle);
  };
}
