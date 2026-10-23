import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFfmpegArgs } from '../services/playback/remuxService.js';

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.log('skip - HEVC roundtrip needs ffmpeg');
  process.exit(0);
}
const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout;
if (!encoders.includes('libx265')) {
  console.log('skip - HEVC fixture needs libx265');
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinevn-hevc-roundtrip-'));
const run = args => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], {
    cwd: dir, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(r.status, 0, r.stderr);
  return r;
};
try {
  const input = path.join(dir, 'source.mkv');
  run(['-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=24',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '4', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le',
    '-x265-params', 'log-level=error:pools=1:frame-threads=1:keyint=48',
    '-c:a', 'aac', '-y', input]);
  const args = buildFfmpegArgs({ inputUrl: input, outputDir: dir,
    video: { mode: 'copy', codec: 'hevc' }, audioCopy: true,
    audioStreamIndex: 1, readRate: 0 });
  run(args);
  const segments = fs.readdirSync(dir).filter(n => /^seg_\d+\.m4s$/.test(n)).sort();
  assert.ok(segments.length);
  const joined = path.join(dir, 'output.mp4');
  fs.writeFileSync(joined, Buffer.concat(['init.mp4', ...segments].map(n => fs.readFileSync(path.join(dir, n)))));
  const decoded = file => {
    const r = run(['-i', file, '-map', '0:v:0', '-f', 'framemd5', '-']);
    assert.equal(r.stderr.trim(), '', 'a successful exit may still conceal HEVC decode errors');
    return r.stdout.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').at(-1).trim());
  };
  const sourceFrames = decoded(input);
  assert.ok(sourceFrames.length >= 90);
  assert.deepEqual(decoded(joined), sourceFrames, 'copying HEVC to HLS preserves every decoded frame');
  console.log('ok - HEVC Main 10 survives HLS remux with identical decoded frames');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
