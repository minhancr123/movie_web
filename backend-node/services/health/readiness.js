/**
 * Readiness check with bounded timeout for all dependency probes.
 * Probes never hang indefinitely — a stuck MongoDB or Redis connection
 * will resolve as not-ready within timeoutMs.
 */

/**
 * @param {Object} opts
 * @param {() => Promise<void>} opts.mongoPing - Must resolve only when db.admin().ping() returns ok:1
 * @param {() => Promise<void>} opts.redisPing - Must resolve only when redis.ping() returns 'PONG'
 * @param {number} [opts.timeoutMs=1500] - Maximum time to wait for all probes
 * @returns {Promise<{ready: boolean}>}
 */
export async function getReadiness({ mongoPing, redisPing, timeoutMs = 1500 }) {
  let timer;
  try {
    const timeout = new Promise(resolve => {
      timer = setTimeout(() => resolve({ ready: false }), timeoutMs);
    });
    const probes = Promise.all([
      Promise.resolve().then(mongoPing),
      Promise.resolve().then(redisPing),
    ]).then(() => ({ ready: true }), () => ({ ready: false }));
    return await Promise.race([probes, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
