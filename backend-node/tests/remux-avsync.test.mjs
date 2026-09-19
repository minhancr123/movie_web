/**
 * A/V sync of the exact ffmpeg command the server serves (buildFfmpegArgs).
 *
 * Reports of "audio out of sync with picture on every film" mean the remux
 * itself bakes in an offset, so this measures it objectively: run the real
 * command on a local fixture, ffprobe the first audio/video packet PTS of
 * the first and last segments, and assert the offset is ~0 and drift-free.
 *
 * - from-start copy session  (what most plays use)
 * - seek-started copy session (startAt=120, the resume/seek path)
 *
 * Thresholds: |offset| <= 120ms constant, drift <= 80ms across the capture.
 * Run: node tests/remux-avsync.test.mjs (needs ffmpeg + ffprobe on PATH).
 */
import { spawn, spawnSync } from 'node:child_process';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFfmpegArgs, REMUX_SEGMENT_SECONDS } from '../services/playback/remuxService.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..', 'frontend', 'e2e', 'media', 'src.mp4');

const have = (bin) => {
  const r = spawnSync(bin, ['-version'], { stdio: 'ignore' });
  return r.status === 0;
};

// fMP4 segments cannot be probed standalone (trun needs the init's moov):
// stitch init.mp4 + one segment into a temp file first.
const firstPts = (dir, segFile, stream) => {
  const probeFile = path.join(dir, `probe-${stream.replace(':', '')}-${segFile}`);
  const init = fs.readFileSync(path.join(dir, 'init.mp4'));
  const seg = fs.readFileSync(path.join(dir, segFile));
  fs.writeFileSync(probeFile, Buffer.concat([init, seg]));
  try {
    const r = spawnSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', stream, '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', probeFile],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) throw new Error(`ffprobe failed on ${segFile} (${stream}): ${r.stderr}`);
    const line = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    const v = Number(line);
    if (!Number.isFinite(v)) throw new Error(`no pts in ${segFile} (${stream})`);
    return v;
  } finally {
    fs.rmSync(probeFile, { force: true });
  }
};

const segsOf = (dir) =>
  fs
    .readdirSync(dir)
    .filter((f) => /^seg_\d+\.m4s$/.test(f))
    .sort();

const runRemux = async (label, videoPlan, minSegs = 4, timeoutMs = 90_000) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `avsync-${label}-`));
  const args = buildFfmpegArgs({
    inputUrl: SRC,
    outputDir: dir,
    audioCopy: false,
    segmentSeconds: REMUX_SEGMENT_SECONDS,
    audioStreamIndex: null,
    audioChannels: null,
    video: videoPlan,
    encoder: null,
  });
  // Same cwd contract as startRemuxSession: ffmpeg resolves the bare
  // -hls_fmp4_init_filename against the process cwd, not the playlist dir.
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'], cwd: dir });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
  });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let segs = [];
    try {
      segs = segsOf(dir);
    } catch {
      segs = [];
    }
    if (segs.length >= minSegs) break;
    if (Date.now() > deadline) break;
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const segs = segsOf(dir);
  child.kill('SIGKILL');
  await new Promise((r) => child.on('close', r));
  if (segs.length < 2 || !fs.existsSync(path.join(dir, 'init.mp4'))) {
    throw new Error(`${label}: only ${segs.length} segments after ${timeoutMs}ms\n${stderr.slice(-2000)}`);
  }
  const offFirst = firstPts(dir, segs[0], 'a:0') - firstPts(dir, segs[0], 'v:0');
  const offLast =
    firstPts(dir, segs[segs.length - 1], 'a:0') - firstPts(dir, segs[segs.length - 1], 'v:0');
  // Cleanup temp bytes (keep nothing: sizes are tens of MB).
  fs.rmSync(dir, { recursive: true, force: true });
  return { segs: segs.length, offFirst, offLast, drift: offLast - offFirst };
};

if (!have('ffmpeg') || !have('ffprobe')) {
  console.log('skip - ffmpeg/ffprobe not on PATH');
  process.exit(0);
}
if (!fs.existsSync(SRC)) {
  console.log(`skip - fixture missing: ${SRC}`);
  process.exit(0);
}

const fmt = (s) => `${(s * 1000).toFixed(1)}ms`;

const fromStart = await runRemux('from-start', { mode: 'remux' });
console.log(
  `from-start: segs=${fromStart.segs} offset(first)=${fmt(fromStart.offFirst)} ` +
    `offset(last)=${fmt(fromStart.offLast)} drift=${fmt(fromStart.drift)}`,
);
assert.ok(
  Math.abs(fromStart.offFirst) <= 0.12,
  `from-start A/V offset too big: ${fmt(fromStart.offFirst)} (audio ${fromStart.offFirst > 0 ? 'behind' : 'ahead of'} video)`,
);
assert.ok(
  Math.abs(fromStart.drift) <= 0.08,
  `from-start A/V drift across segments: ${fmt(fromStart.drift)}`,
);

const seeked = await runRemux('seek-120', { mode: 'remux', startAt: 120 });
console.log(
  `seek-120:   segs=${seeked.segs} offset(first)=${fmt(seeked.offFirst)} ` +
    `offset(last)=${fmt(seeked.offLast)} drift=${fmt(seeked.drift)}`,
);
assert.ok(
  Math.abs(seeked.offFirst) <= 0.12,
  `seek-started A/V offset too big: ${fmt(seeked.offFirst)} (audio ${seeked.offFirst > 0 ? 'behind' : 'ahead of'} video)`,
);
assert.ok(
  Math.abs(seeked.drift) <= 0.08,
  `seek-started A/V drift across segments: ${fmt(seeked.drift)}`,
);

console.log('ok - remux A/V offset ~0 and drift-free, from-start and seek-started');
