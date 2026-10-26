import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  subtitleWindowAt,
  retrySubtitleTracksIndividually,
  subtitleSidecarName,
  trySliceWindowFromCoverage, withSubtitleCoverage, subtitleWindowStatus,
} from '../services/playback/subtitleInventory.js';

const SCOPE = 'a'.repeat(40);
const mkWindow = (startAt) => ({ startAt, durationSeconds: 300 });

const writeSidecar = async (dir, scope, index, startAt, cues) => {
  const name = subtitleSidecarName(scope, index, mkWindow(startAt));
  const body = cues.map(c => `${c[0]} --> ${c[1]}\n${c[2]}`).join('\n\n');
  await fs.writeFile(path.join(dir, name), withSubtitleCoverage(`WEBVTT\n\n${body}\n`, [[startAt, startAt + 300]]));
};

test('a seek into a neighbouring window is served instantly by slicing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-sub-coverage-'));
  try {
    // w600 completed (covers 600-900); viewer seeks to 800 → window w720.
    await writeSidecar(dir, SCOPE, 0, 600, [
      ['00:10:05.000', '00:10:08.000', 'Before-bucket'],
      ['00:12:30.000', '00:12:33.000', 'Inside-requested'],
      ['00:17:30.000', '00:17:32.000', 'After-window'],
    ]);
    const result = await trySliceWindowFromCoverage(dir, SCOPE, 0, mkWindow(720));
    assert.equal(result.sliced, true);
    assert.equal(result.fullCoverage, false, 'w600 does not cover all of 720-1020');
    const sliced = await fs.readFile(path.join(dir, subtitleSidecarName(SCOPE, 0, mkWindow(720))), 'utf8');
    assert.match(sliced, /Inside-requested/);
    assert.doesNotMatch(sliced, /Before-bucket|After-window/);
    assert.match(sliced, /00:12:30\.000 --> 00:12:33\.000/, 'original timestamps preserved');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('overlapping sources are merged without duplicated cues', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-sub-coverage-'));
  try {
    const shared = ['00:13:00.000', '00:13:02.000', 'Shared-cue'];
    await writeSidecar(dir, SCOPE, 0, 600, [shared]);
    await writeSidecar(dir, SCOPE, 0, 720, [shared, ['00:15:00.000', '00:15:02.000', 'Late-cue']]);
    const result = await trySliceWindowFromCoverage(dir, SCOPE, 0, mkWindow(720));
    assert.equal(result.sliced, true);
    assert.equal(result.fullCoverage, true, '600-900 + 720-1020 covers 720-1020');
    const sliced = await fs.readFile(path.join(dir, subtitleSidecarName(SCOPE, 0, mkWindow(720))), 'utf8');
    assert.equal((sliced.match(/Shared-cue/g) || []).length, 1, 'duplicate cue appears once');
    assert.match(sliced, /Late-cue/);
    // sorted by start time
    assert.ok(sliced.indexOf('Shared-cue') < sliced.indexOf('Late-cue'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('uncovered buckets still report not sliced; partial files are ignored', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-sub-coverage-'));
  try {
    await writeSidecar(dir, SCOPE, 0, 600, [['00:10:00.000', '00:10:02.000', 'x']]);
    // far-away bucket → cannot serve
    const far = await trySliceWindowFromCoverage(dir, SCOPE, 0, mkWindow(1200));
    assert.equal(far.sliced, false);
    // in-progress temp file for another track must not count as coverage
    await fs.writeFile(
      path.join(dir, `v6-${SCOPE}-w0-1.vtt.partial-123-abc.vtt`),
      'WEBVTT\n',
    );
    const none = await trySliceWindowFromCoverage(dir, SCOPE, 1, mkWindow(0));
    assert.equal(none.sliced, false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('subtitleWindowAt buckets by 120s with 300s span', () => {
  assert.deepEqual(subtitleWindowAt(0), { startAt: 0, durationSeconds: 300 });
  assert.deepEqual(subtitleWindowAt(119), { startAt: 0, durationSeconds: 300 });
  assert.deepEqual(subtitleWindowAt(800), { startAt: 720, durationSeconds: 300 });
});

test('repeated and chained slices never extend actual extracted coverage', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-sub-chain-'));
  try {
    await writeSidecar(dir, SCOPE, 0, 0, [['00:04:10.000', '00:04:12.000', 'cue']]);
    assert.deepEqual(await trySliceWindowFromCoverage(dir, SCOPE, 0, mkWindow(120)), { sliced: true, fullCoverage: false });
    assert.deepEqual(await trySliceWindowFromCoverage(dir, SCOPE, 0, mkWindow(120)), { sliced: true, fullCoverage: false });
    assert.deepEqual(await trySliceWindowFromCoverage(dir, SCOPE, 0, mkWindow(240)), { sliced: false, fullCoverage: false });
    const status = await subtitleWindowStatus(path.join(dir, subtitleSidecarName(SCOPE, 0, mkWindow(120))), mkWindow(120));
    assert.deepEqual(status, { ready: true, fullCoverage: false, ranges: [[120, 300]] });
    await writeSidecar(dir, SCOPE, 0, 120, [['00:06:00.000', '00:06:02.000', 'new']]);
    assert.equal((await trySliceWindowFromCoverage(dir, SCOPE, 0, mkWindow(240))).sliced, true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
test('quiet extracted coverage is valid, while a header alone proves no coverage', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cinevn-sub-quiet-'));
  try {
    const file = path.join(dir, subtitleSidecarName(SCOPE, 0, mkWindow(0)));
    await fs.writeFile(file, 'WEBVTT\n');
    assert.equal((await subtitleWindowStatus(file, mkWindow(0))).ready, false);
    await fs.writeFile(file, withSubtitleCoverage('WEBVTT\n', [[0, 300]]));
    assert.equal((await subtitleWindowStatus(file, mkWindow(0))).fullCoverage, true);
    assert.equal((await trySliceWindowFromCoverage(dir, SCOPE, 0, mkWindow(120))).fullCoverage, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('high bitrate subtitle scans stay bounded near the current playhead',()=>{
 assert.deepEqual(subtitleWindowAt(800,{kbps:59000}),{startAt:780,durationSeconds:60});
 assert.deepEqual(subtitleWindowAt(800,{kbps:6000}),{startAt:720,durationSeconds:300});
 assert.equal(retrySubtitleTracksIndividually(new Error('/usr/bin/ffmpeg quá 45s không phản hồi')),false);
 assert.equal(retrySubtitleTracksIndividually(new Error('Invalid subtitle codec')),true);
});
