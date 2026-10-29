import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildFfmpegArgs } from '../services/playback/remuxService.js';

assert.equal(spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status, 0, 'media integration requires ffmpeg');
const encoders = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout;
assert.ok(encoders.includes('libx265'), 'media integration requires libx265');
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
  const packetProbe = file => {
    const r = spawnSync('ffprobe', ['-v', 'error', '-show_packets', '-show_streams', '-of', 'json', file], { encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  for (const variable of [false, true]) {
    const label = variable ? 'variable' : 'fractional';
    const outputDir = path.join(dir, label); fs.mkdirSync(outputDir);
    const source = path.join(outputDir, 'source.mkv');
    run(['-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=24000/1001',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12',
      ...(variable ? ['-vf', "select='not(eq(mod(n,7),0))'", '-fps_mode:v', 'vfr'] : []),
      '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le', '-x265-params',
      'log-level=error:pools=1:frame-threads=1:bframes=0:keyint=90:min-keyint=90:scenecut=0', '-c:a', 'aac', '-y', source]);
    const remuxArgs = buildFfmpegArgs({ inputUrl: source, outputDir,
      video: { mode: 'copy', codec: 'hevc', hasBFrames: 0 }, audioCopy: true, readRate: 0 });
    run(remuxArgs);
    const sourceProbe = packetProbe(source), outputProbe = packetProbe(path.join(outputDir, 'index.m3u8'));
    const videos = p => p.packets.filter(x => x.codec_type === 'video');
    const before = videos(sourceProbe), after = videos(outputProbe);
    assert.equal(after.length, before.length, 'no packet dropped or repeated');
    let maxPtsErrorMs = 0;
    for (let i = 1; i < after.length; i++) {
      const relative = Number(after[i].pts_time) - Number(after[0].pts_time);
      const original = Number(before[i].pts_time) - Number(before[0].pts_time);
      maxPtsErrorMs = Math.max(maxPtsErrorMs, Math.abs(relative - original) * 1000);
      const detail = JSON.stringify({ label, i, before: before.slice(Math.max(0, i - 1), i + 2), after: after.slice(Math.max(0, i - 1), i + 2),
        sourceTimeBase: sourceProbe.streams[0].time_base, outputTimeBase: outputProbe.streams[0].time_base, remuxArgs });
      assert(Number(after[i].dts_time) > Number(after[i - 1].dts_time), `fragment boundaries must have strictly increasing decode timestamps: ${detail}`);
      assert(Math.abs(relative - original) < .002, `preserve the source clock within 2ms, not an invented fixed cadence: ${detail}`);
    }
    const avOffset = p => Number(p.packets.find(x => x.codec_type === 'audio').pts_time) - Number(videos(p)[0].pts_time);
    assert(Math.abs(avOffset(sourceProbe) - avOffset(outputProbe)) < .002, 'HEVC clock fix preserves copied audio offset');
    const parts = fs.readdirSync(outputDir).filter(n => /^seg_\d+\.m4s$/.test(n)).sort();
    const joined = path.join(outputDir, 'joined.mp4');
    fs.writeFileSync(joined, Buffer.concat(['init.mp4', ...parts].map(n => fs.readFileSync(path.join(outputDir, n)))));
    assert.deepEqual(decoded(joined), decoded(source), 'fractional/VFR Main10 keeps every decoded frame');
    console.log(JSON.stringify({ test: `${label}-HEVC-clock`, packets: after.length, maxPtsErrorMs, segments: parts.length }));
  }

} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
