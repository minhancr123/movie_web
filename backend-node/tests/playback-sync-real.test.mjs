import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildFfmpegArgs, ffprobe, presentationShiftMs, probeSeekOrigin, extractSubtitleTracks } from '../services/playback/remuxService.js';
import { bucketSeekStart } from '../services/playback/startupPolicy.js';

if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
  console.log('skip - real A/V/subtitle sync needs ffmpeg');
  process.exit(0);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cinevn-sync-real-'));
const run = (args, cwd = dir) => {
  const r = spawnSync('ffmpeg', args, { cwd, encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  return r.stderr;
};
const markers = input => {
  const output = run(['-hide_banner', '-protocol_whitelist', 'file,crypto,data', '-allowed_extensions', 'ALL',
    '-i', input, '-vf', 'blackdetect=d=0.05:pix_th=0.1', '-af', 'silencedetect=n=-50dB:d=0.1', '-f', 'null', '-']);
  return { flash: Number(output.match(/black_end:([\d.]+)/)?.[1]), tone: Number(output.match(/silence_end: ([\d.]+)/)?.[1]) };
};
try {
  fs.writeFileSync(path.join(dir, 'source.srt'), '1\n00:00:02,000 --> 00:00:02,200\nFirst\n\n2\n00:03:19,000 --> 00:03:19,200\nAfter seek\n');
  const source = path.join(dir, 'source.mkv');
  run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    "color=black:s=64x64:r=24:d=205,drawbox=color=white:t=fill:enable='between(t,2,2.2)+between(t,199,199.2)'",
    '-f', 'lavfi', '-i', "aevalsrc='if(between(t,2,2.2)+between(t,199,199.2),sin(2*PI*1000*t),0)':s=48000:d=205",
    '-i', path.join(dir, 'source.srt'), '-map', '0:v', '-map', '1:a', '-map', '2:s',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '2', '-g', '48',
    '-c:a', 'dca', '-strict', '-2', '-ac', '2', '-c:s', 'srt', '-y', source]);
  const probe = await ffprobe(source);
  const shift = presentationShiftMs(probe) / 1000;
  assert.ok(shift > 0, 'fixture exercises B-frame timestamp mapping');
  for (const requested of [0, 197]) {
    const bucket = bucketSeekStart(requested);
    const origin = bucket ? await probeSeekOrigin(source, bucket) : 0;
    assert.ok(Number.isFinite(origin) && origin <= requested);
    const out = path.join(dir, String(requested));
    fs.mkdirSync(out);
    run(buildFfmpegArgs({ inputUrl: source, outputDir: out, audioCopy: false,
      audioStreamIndex: 1, audioChannels: 2, video: { mode: 'copy', codec: 'h264', startAt: bucket },
      windowSeconds: requested ? 12 : 6, readRate: 0 }), out);
    const vtt = path.join(out, 'english.vtt');
    const [subtitle] = await extractSubtitleTracks(source, [{ streamIndex: 2, outPath: vtt }],
      { startAt: requested ? 120 : 0, durationSeconds: requested ? 100 : 6 });
    assert.equal(subtitle.ok, true);
    const cue = requested ? 199 : 2;
    assert.match(fs.readFileSync(vtt, 'utf8'), requested ? /03:19.000/ : /00:02.000/);
    const measured = markers(path.join(out, 'index.m3u8'));
    assert.ok(Number.isFinite(measured.flash) && Number.isFinite(measured.tone));
    const avMs = Math.round((measured.tone - measured.flash) * 1000);
    const subtitleMs = Math.round((origin + measured.flash - shift - cue) * 1000);
    assert.ok(Math.abs(avMs) <= 60, `A/V content marker mismatch ${avMs}ms`);
    assert.ok(Math.abs(subtitleMs) <= 60, `subtitle/source clock mismatch ${subtitleMs}ms`);
    const reused = markers(path.join(out, 'index.m3u8'));
    assert.deepEqual(reused, measured, 'reusing identical HLS bytes must preserve content timing');
    console.log(JSON.stringify({ requestedStartAt: requested, actualSeekOrigin: origin,
      presentationShiftMs: shift * 1000, audioVideoErrorMs: avMs, subtitleTimelineErrorMs: subtitleMs, reuse: 'unchanged' }));
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
