import test from 'node:test';
import assert from 'node:assert/strict';
import { getReadiness } from '../services/health/readiness.js';
import { createShutdown } from '../services/health/lifecycle.js';
import { startHeartbeat } from '../services/health/heartbeat.js';

// ── Readiness ──

test('hung dependency has a bounded result', async () => {
  const t = Date.now();
  const r = await getReadiness({
    mongoPing: () => new Promise(() => {}), // never resolves
    redisPing: async () => {},
    timeoutMs: 30,
  });
  assert.equal(r.ready, false);
  assert.ok(Date.now() - t < 500, 'should resolve within 500ms');
});

test('both probes healthy returns ready', async () => {
  const r = await getReadiness({
    mongoPing: async () => {},
    redisPing: async () => {},
    timeoutMs: 1000,
  });
  assert.equal(r.ready, true);
});

test('mongo failure returns not ready', async () => {
  const r = await getReadiness({
    mongoPing: async () => { throw new Error('connection refused'); },
    redisPing: async () => {},
    timeoutMs: 1000,
  });
  assert.equal(r.ready, false);
});

test('redis failure returns not ready', async () => {
  const r = await getReadiness({
    mongoPing: async () => {},
    redisPing: async () => { throw new Error('ECONNREFUSED'); },
    timeoutMs: 1000,
  });
  assert.equal(r.ready, false);
});

test('both probes failing returns not ready', async () => {
  const r = await getReadiness({
    mongoPing: async () => { throw new Error('mongo down'); },
    redisPing: async () => { throw new Error('redis down'); },
    timeoutMs: 1000,
  });
  assert.equal(r.ready, false);
});

// ── Lifecycle (shutdown) ──

test('shutdown runs phases in order', async () => {
  const order = [];
  const shutdown = createShutdown({
    stopAccepting: async () => order.push('stop'),
    closeJobs: async () => order.push('jobs'),
    closeMedia: async () => order.push('media'),
    closeStores: async () => order.push('stores'),
    deadlineMs: 5000,
  });
  await shutdown('SIGTERM');
  assert.deepEqual(order, ['stop', 'jobs', 'media', 'stores']);
});

test('shutdown is idempotent — second call returns same promise', async () => {
  const calls = [];
  const shutdown = createShutdown({
    stopAccepting: async () => calls.push('stop'),
    closeJobs: async () => {},
    closeMedia: async () => {},
    closeStores: async () => {},
    deadlineMs: 5000,
  });
  const p1 = shutdown('SIGTERM');
  const p2 = shutdown('SIGINT');
  assert.equal(p1, p2);
  await p1;
  assert.equal(calls.length, 1, 'stopAccepting should only be called once');
});

test('shutdown deadline triggers on hang', async () => {
  const savedExitCode = process.exitCode;
  const t = Date.now();
  const shutdown = createShutdown({
    stopAccepting: async () => {},
    closeJobs: () => new Promise(r => { const h = setTimeout(r, 10000); h.unref(); }),
    closeMedia: async () => {},
    closeStores: async () => {},
    deadlineMs: 50,
  });
  await shutdown('SIGTERM');
  assert.ok(Date.now() - t < 500, 'deadline should fire quickly');
  // The lifecycle module sets process.exitCode=1 on deadline; reset for test runner
  process.exitCode = savedExitCode;
});

// ── Heartbeat ──

test('heartbeat writes key and stop clears interval', async () => {
  const written = [];
  const fakeRedis = {
    set: async (key, value, ex, ttl) => {
      written.push({ key, value: JSON.parse(value), ex, ttl });
    },
  };
  const stop = startHeartbeat({
    redis: fakeRedis,
    service: 'worker',
    releaseId: 'a'.repeat(40),
    intervalMs: 10,
    ttlSeconds: 90,
  });

  // Wait for at least one tick
  await new Promise(r => setTimeout(r, 50));
  stop();

  assert.ok(written.length >= 1, 'should have written at least once');
  assert.equal(written[0].key, 'cineon:heartbeat:worker');
  assert.equal(written[0].ex, 'EX');
  assert.equal(written[0].ttl, 90);
  assert.equal(written[0].value.release, 'a'.repeat(40));
});

test('heartbeat survives redis error without crashing', async () => {
  const fakeRedis = {
    set: async () => { throw new Error('ECONNREFUSED'); },
  };
  const stop = startHeartbeat({
    redis: fakeRedis,
    service: 'scheduler',
    releaseId: 'b'.repeat(40),
    intervalMs: 10,
    ttlSeconds: 90,
  });
  // Should not throw
  await new Promise(r => setTimeout(r, 50));
  stop();
});
