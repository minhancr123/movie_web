// Redis separation: catalog cache and BullMQ must live on different instances.
// A full cache under `noeviction` refuses job writes with OOM, so the cache
// client reads REDIS_CACHE_URL and the queue connection REDIS_QUEUE_URL, each
// falling back to REDIS_URL for single-instance dev/test setups.
//
// Each case runs `node` fresh via env-first dynamic imports because both
// modules resolve their URL once, at import time.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const probe = (env) => {
  const out = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `
      const r = await import('./config/redis.js');
      // NOTE: no manual 'error' listener attached on purpose — queue.js must
      // survive a dead Redis on its own (unhandled 'error' would crash this
      // probe). If this probe dies, the source fix regressed, not the test.
      const q = await import('./config/queue.js').catch((e) => ({ __error: String(e && e.message || e) }));
      const show = (c) => (c && c.options ? \`\${c.options.host}:\${c.options.port}\` : 'n/a');
      let result = 'IMPORT_OK';
      try {
        result = JSON.stringify({
          cache: show(r.cacheClient),
          queue: 'queueConnection' in q ? show(q.queueConnection) : q.__error,
        });
      } finally {
        try { await r.cacheClient.disconnect(); } catch {}
        try { q.queueConnection && q.queueConnection.disconnect && await q.queueConnection.disconnect(); } catch {}
      }
      process.stdout.write(result);
    `],
    {
      cwd: new URL('..', import.meta.url).pathname,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    },
  );
  assert.equal(out.status, 0, `probe exited ${out.status}: ${out.stderr}`);
  return JSON.parse(out.stdout);
};

// Distinct instances when both URLs are set.
{
  const got = probe({
    REDIS_CACHE_URL: 'redis://127.0.0.1:6380',
    REDIS_QUEUE_URL: 'redis://127.0.0.1:6381',
    REDIS_URL: 'redis://127.0.0.1:6399',
  });
  assert.equal(got.cache, '127.0.0.1:6380', 'cache client uses REDIS_CACHE_URL');
  assert.equal(got.queue, '127.0.0.1:6381', 'queue uses REDIS_QUEUE_URL');
  console.log('ok - cache and queue use their own instances when configured');
}

// Single-instance fallback: only REDIS_URL set.
{
  const got = probe({
    REDIS_CACHE_URL: '',
    REDIS_QUEUE_URL: '',
    REDIS_URL: 'redis://127.0.0.1:6399',
    REDIS_HOST: '',
    REDIS_PORT: '',
  });
  assert.equal(got.cache, '127.0.0.1:6399', 'cache falls back to REDIS_URL');
  assert.equal(got.queue, '127.0.0.1:6399', 'queue falls back to REDIS_URL');
  console.log('ok - both fall back to REDIS_URL for dev/test');
}

console.log('PASS redis-separation checks');
