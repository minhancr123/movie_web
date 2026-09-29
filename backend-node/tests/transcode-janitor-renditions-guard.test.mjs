// Janitor guard: RENDITIONS_ROOT lives INSIDE TRANSCODE_ROOT
// (/data/transcodes/renditions) and must never be treated as a session.
// Repro: without the name guard, a janitor scanning TRANSCODE_ROOT could
// count or remove the shared finished store. The guard keeps 32-hex-only
// matching AND skips `renditions` by name.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const fixtureRoot = path.join(os.tmpdir(), `movieweb-janitor-guard-${process.pid}`);
process.env.TRANSCODE_ROOT = fixtureRoot;
process.env.RENDITIONS_ROOT = path.join(fixtureRoot, 'renditions');

const remux = await import('../services/playback/remuxService.js');

const failures = [];
const check = (name, cond) => {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failures.push(name);
    console.error(`FAIL ${name}`);
  }
};

const now = Date.now();
const oldId = 'c'.repeat(32);
const freshId = 'd'.repeat(32);
const renditionId = 'e'.repeat(32);
const renditionsDir = path.join(fixtureRoot, 'renditions');
const renditionDir = path.join(renditionsDir, renditionId);

try {
  // Expired complete session -> janitor SHOULD delete this one.
  await fs.mkdir(path.join(fixtureRoot, oldId), { recursive: true });
  await fs.writeFile(path.join(fixtureRoot, oldId, 'index.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n');
  await fs.writeFile(path.join(fixtureRoot, oldId, 'seg_00000.m4s'), Buffer.alloc(100));
  // Fresh complete session -> janitor MUST keep this one.
  await fs.mkdir(path.join(fixtureRoot, freshId), { recursive: true });
  await fs.writeFile(path.join(fixtureRoot, freshId, 'index.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n');
  await fs.writeFile(path.join(fixtureRoot, freshId, 'seg_00000.m4s'), Buffer.alloc(100));
  // Shared finished store with deliberately OLD mtimes: the guard must ignore
  // it regardless of age — TTL never applies to `renditions`.
  await fs.mkdir(renditionDir, { recursive: true });
  await fs.writeFile(path.join(renditionDir, 'index.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n');
  await fs.writeFile(path.join(renditionDir, 'init.mp4'), Buffer.alloc(50));
  await fs.writeFile(path.join(renditionDir, 'seg_00000.m4s'), Buffer.alloc(100));

  const oldDate = new Date(now - 60_000);
  await fs.utimes(path.join(fixtureRoot, oldId, 'index.m3u8'), oldDate, oldDate);
  await fs.utimes(path.join(fixtureRoot, oldId), oldDate, oldDate);
  await fs.utimes(path.join(renditionDir, 'index.m3u8'), oldDate, oldDate);
  await fs.utimes(renditionDir, oldDate, oldDate);
  await fs.utimes(renditionsDir, oldDate, oldDate);

  const report = await remux.cleanupTranscodeCache({
    now,
    maxBytes: 10_000,
    ttlMs: 10_000,
    incompleteGraceMs: 5_000,
    liveIdleMs: 10_000,
  });

  const oldExists = await fs.stat(path.join(fixtureRoot, oldId)).then(() => true, () => false);
  const freshExists = await fs.stat(path.join(fixtureRoot, freshId)).then(() => true, () => false);
  const renditionKept = await fs.stat(path.join(renditionDir, 'seg_00000.m4s')).then(() => true, () => false);
  const renditionsDirKept = await fs.stat(renditionsDir).then(() => true, () => false);

  check('expired-session-evicted', !oldExists && report.deletedIds.includes(oldId));
  check('fresh-session-kept', freshExists && !report.deletedIds.includes(freshId));
  check('renditions-subdir-kept', renditionsDirKept && renditionKept);
  check('renditions-never-in-delete-list', !report.deletedIds.includes('renditions'));
  check('report-root', report.root === fixtureRoot);
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`FAIL checks=${[...new Set(failures)].join(',')}`);
  process.exit(1);
}

console.log('PASS transcode-janitor-renditions-guard checks');
