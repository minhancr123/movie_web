// Regression coverage for bounded transcode storage and active-session safety.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const fixtureRoot = path.join(os.tmpdir(), `movieweb-transcode-cleanup-${process.pid}`);
process.env.TRANSCODE_ROOT = fixtureRoot;

const remux = await import('../services/playback/remuxService.js');
const checks = [
  'janitor-export',
  'ttl-eviction',
  'size-cap',
  'active-session-protection',
  'filesystem-cleanup',
];
const failures = [];

if (
  typeof remux.cleanupTranscodeCache !== 'function'
  || typeof remux.selectTranscodeEvictions !== 'function'
) {
  failures.push(...checks);
} else {
  const now = Date.now();
  const activeId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const expiredId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const ttlPlan = remux.selectTranscodeEvictions(
    [
      { id: activeId, sizeBytes: 500, lastAccessMs: now, modifiedMs: now, complete: false, live: true },
      { id: expiredId, sizeBytes: 100, lastAccessMs: now - 20_000, modifiedMs: now - 20_000, complete: true, live: false },
    ],
    { now, maxBytes: 10_000, ttlMs: 10_000, incompleteGraceMs: 5_000, liveIdleMs: 10_000 },
  );
  if (!ttlPlan.deleteIds.includes(expiredId)) failures.push('ttl-eviction');
  if (ttlPlan.deleteIds.includes(activeId) || ttlPlan.stopIds.includes(activeId)) {
    failures.push('active-session-protection');
  }

  const sizePlan = remux.selectTranscodeEvictions(
    [
      { id: '11111111111111111111111111111111', sizeBytes: 100, lastAccessMs: now - 3000, modifiedMs: now - 3000, complete: true, live: false },
      { id: '22222222222222222222222222222222', sizeBytes: 100, lastAccessMs: now - 2000, modifiedMs: now - 2000, complete: true, live: false },
      { id: '33333333333333333333333333333333', sizeBytes: 100, lastAccessMs: now - 1000, modifiedMs: now - 1000, complete: true, live: false },
    ],
    { now, maxBytes: 200, ttlMs: 60_000, incompleteGraceMs: 60_000, liveIdleMs: 60_000, viewerGraceMs: 0 },
  );
  if (sizePlan.deleteIds[0] !== '11111111111111111111111111111111') failures.push('size-cap');

  const viewerId = '44444444444444444444444444444444';
  const viewerPlan = remux.selectTranscodeEvictions(
    [{ id: viewerId, sizeBytes: 500, lastAccessMs: now, modifiedMs: now - 5000, complete: true, live: false }],
    { now, maxBytes: 1, ttlMs: 60_000, incompleteGraceMs: 60_000, liveIdleMs: 60_000, viewerGraceMs: 120_000 },
  );
  if (viewerPlan.deleteIds.includes(viewerId)) failures.push('active-session-protection');

  const oldId = 'cccccccccccccccccccccccccccccccc';
  const freshId = 'dddddddddddddddddddddddddddddddd';
  await fs.mkdir(path.join(fixtureRoot, oldId), { recursive: true });
  await fs.mkdir(path.join(fixtureRoot, freshId), { recursive: true });
  await fs.writeFile(path.join(fixtureRoot, oldId, 'index.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n');
  await fs.writeFile(path.join(fixtureRoot, oldId, 'seg_00000.m4s'), Buffer.alloc(100));
  await fs.writeFile(path.join(fixtureRoot, freshId, 'index.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n');
  await fs.writeFile(path.join(fixtureRoot, freshId, 'seg_00000.m4s'), Buffer.alloc(100));
  const oldDate = new Date(now - 20_000);
  await fs.utimes(path.join(fixtureRoot, oldId, 'index.m3u8'), oldDate, oldDate);
  await fs.utimes(path.join(fixtureRoot, oldId), oldDate, oldDate);
  const report = await remux.cleanupTranscodeCache({
    now,
    maxBytes: 10_000,
    ttlMs: 10_000,
    incompleteGraceMs: 5_000,
    liveIdleMs: 10_000,
  });
  const oldExists = await fs.stat(path.join(fixtureRoot, oldId)).then(() => true, () => false);
  const freshExists = await fs.stat(path.join(fixtureRoot, freshId)).then(() => true, () => false);
  if (oldExists || !freshExists || !report.deletedIds.includes(oldId)) {
    failures.push('filesystem-cleanup');
  }
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`FAIL checks=${[...new Set(failures)].join(',')}`);
  process.exit(1);
}

console.log(`PASS checks=${checks.join(',')}`);
