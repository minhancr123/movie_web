// Isolated, encoded-media comparison. Never opens production URLs or DBs.
// TIMESTAMP_AUDIT_DIR=/tmp/evidence node scripts/audit-timestamp-matrix.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const backend = fileURLToPath(new URL('../', import.meta.url));
const root = process.env.TIMESTAMP_AUDIT_DIR;
assert(root && path.isAbsolute(root), 'set an isolated absolute TIMESTAMP_AUDIT_DIR');
fs.mkdirSync(root, { recursive: true });
const run = (bin, args) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 90000, maxBuffer: 32 * 1024 * 1024 });
  assert.equal(r.status, 0, `${bin}: ${r.stderr}`);
  return r;
};
const ff = args => run('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args]);
const probe = file => JSON.parse(run('ffprobe', ['-v', 'error', '-show_packets', '-show_streams', '-show_format', '-of', 'json', file]).stdout);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixture = path.join(root, 'fixtures'); fs.mkdirSync(fixture, { recursive: true });
const hevc = path.join(fixture, 'fractional.mkv');
if (!fs.existsSync(hevc)) ff(['-f', 'lavfi', '-i', 'testsrc2=size=128x72:rate=24000/1001',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12', '-c:v', 'libx265', '-pix_fmt', 'yuv420p10le',
  '-x265-params', 'log-level=error:pools=1:frame-threads=1:bframes=0:keyint=90:min-keyint=90:scenecut=0', '-c:a', 'aac', '-y', hevc]);
const sync = path.join(fixture, 'sync.mkv');
if (!fs.existsSync(sync)) {
  const srt = path.join(fixture, 'source.srt');
  fs.writeFileSync(srt, '1\n00:00:02,000 --> 00:00:02,200\nFirst\n\n2\n00:03:19,000 --> 00:03:19,200\nAfter seek\n');
  ff(['-f', 'lavfi', '-i', "color=black:s=64x64:r=24:d=205,drawbox=color=white:t=fill:enable='between(t,2,2.2)+between(t,199,199.2)'",
    '-f', 'lavfi', '-i', "aevalsrc='if(between(t,2,2.2)+between(t,199,199.2),sin(2*PI*1000*t),0)':s=48000:d=205",
    '-i', srt, '-map', '0:v', '-map', '1:a', '-map', '2:s', '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '2', '-g', '48',
    '-c:a', 'dca', '-strict', '-2', '-ac', '2', '-c:s', 'srt', '-y', sync]);
}
const report = { versions: { node: process.version,
  ffmpeg: run('ffmpeg', ['-version']).stdout.split('\n')[0], ffprobe: run('ffprobe', ['-version']).stdout.split('\n')[0] },
  fixtures: { hevc: sha(hevc), sync: sha(sync) }, results: {} };
const videoPackets = p => p.packets.filter(x => x.codec_type === 'video');
const compact = p => ({ streams: p.streams.map(s => ({ index: s.index, codec: s.codec_name, profile: s.profile, pix_fmt: s.pix_fmt,
  time_base: s.time_base, start_time: s.start_time, r_frame_rate: s.r_frame_rate, avg_frame_rate: s.avg_frame_rate })),
  formatStart: p.format.start_time, firstPackets: p.packets.slice(0, 8) });
const marker = (input, copyts) => {
  const r = run('ffmpeg', [...(copyts ? ['-copyts'] : []), '-hide_banner', '-protocol_whitelist', 'file,crypto,data',
    '-allowed_extensions', 'ALL', '-i', input, '-vf', 'blackdetect=d=0.05:pix_th=0.1',
    '-af', 'silencedetect=n=-50dB:d=0.1', '-f', 'null', '-']);
  return { flash: Number(r.stderr.match(/black_end:([\d.]+)/)?.[1]), tone: Number(r.stderr.match(/silence_end: ([\d.]+)/)?.[1]) };
};
const temporaryTrees = [];
try {
  const builds = [];
  for (const [label, ref] of [['baseline', '24f7a662d706751e48c75e7d749ccfb2eef0816b'], ['auditBefore', '4d0e94b']]) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `cinevn-timestamp-${label}-`)); temporaryTrees.push(tmp);
    const archive = path.join(tmp, 'source.tar');
    run('git', ['-C', path.dirname(backend.replace(/\/$/, '')), 'archive', '-o', archive, ref, 'backend-node']);
    run('tar', ['-xf', archive, '-C', tmp]); fs.rmSync(archive);
    const module = path.join(tmp, 'backend-node/services/playback/remuxService.js');
    report.originalTests ??= {};
    report.originalTests[label] = ['remux-hevc-roundtrip.test.mjs', 'playback-sync-real.test.mjs'].map(test => {
      const command = [path.join(tmp, 'backend-node/tests', test)];
      const r = spawnSync(process.execPath, command, { encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
      return { command: ['node', ...command], status: r.status, stdout: r.stdout, stderr: r.stderr };
    });
    builds.push([label, await import(pathToFileURL(module))]);
  }
  builds.push(['after', await import('../services/playback/remuxService.js')]);
  const beforeHEVC = probe(hevc), original = videoPackets(beforeHEVC);
  report.sourceHEVC = compact(beforeHEVC); report.sourceSync = compact(probe(sync));
  for (const [label, mod] of builds) {
    const result = { sync: [] }; report.results[label] = result;
    const out = path.join(root, label); fs.mkdirSync(out, { recursive: true });
    const hevcDir = path.join(out, 'hevc'); fs.mkdirSync(hevcDir, { recursive: true });
    const args = mod.buildFfmpegArgs({ inputUrl: hevc, outputDir: hevcDir, video: { mode: 'copy', codec: 'hevc', hasBFrames: 0 }, audioCopy: true, readRate: 0 });
    const remux = ff(args); const playlist = path.join(hevcDir, 'index.m3u8'); const after = probe(playlist); const packets = videoPackets(after);
    fs.writeFileSync(path.join(out, 'hevc-packets.json'), JSON.stringify({ before: beforeHEVC, after }, null, 2));
    const errors = packets.map((p, i) => 1000 * (Number(p.pts_time) - Number(packets[0].pts_time) - Number(original[i].pts_time) + Number(original[0].pts_time)));
    const segments = fs.readdirSync(hevcDir).filter(n => /^seg_\d+\.m4s$/.test(n)).sort();
    const boundaries = [];
    for (const segment of segments) {
      const joined = path.join(hevcDir, 'fragment.mp4');
      fs.writeFileSync(joined, Buffer.concat(['init.mp4', segment].map(n => fs.readFileSync(path.join(hevcDir, n)))));
      const ps = videoPackets(probe(joined)); boundaries.push({ segment, first: ps.slice(0, 2), last: ps.slice(-2) });
    }
    const minDtsDelta = Math.min(...packets.slice(1).map((p, i) => Number(p.dts_time) - Number(packets[i].dts_time)));
    result.hevc = { args, probe: compact(after), packetCount: packets.length, maxRelativePtsErrorMs: Math.max(...errors.map(Math.abs)),
      minDtsDelta, boundaries, playlist: fs.readFileSync(playlist, 'utf8'), stderr: remux.stderr };
    if (label === 'after') { assert.equal(packets.length, original.length); assert(minDtsDelta > 0); assert(result.hevc.maxRelativePtsErrorMs < 2); }
    const syncProbe = await mod.ffprobe(sync); const shift = mod.presentationShiftMs(syncProbe) / 1000;
    for (const requested of [0, 197]) {
      // Same production bucket policy for each revision (197 -> 196).
      const { bucketSeekStart } = await import('../services/playback/startupPolicy.js');
      const bucket = bucketSeekStart(requested), origin = bucket ? await mod.probeSeekOrigin(sync, bucket) : 0;
      const dir = path.join(out, `sync-${requested}`); fs.mkdirSync(dir, { recursive: true });
      const avArgs = mod.buildFfmpegArgs({ inputUrl: sync, outputDir: dir, audioCopy: false, audioStreamIndex: 1, audioChannels: 2,
        video: { mode: 'copy', codec: 'h264', startAt: bucket }, windowSeconds: requested ? 12 : 6, readRate: 0 }); ff(avArgs);
      const media = path.join(dir, 'index.m3u8'); const pp = probe(media); const corrected = marker(media, true), normalized = marker(media, false);
      const cue = requested ? 199 : 2;
      const vtt = path.join(dir, 'english.vtt'); const [sub] = await mod.extractSubtitleTracks(sync, [{ streamIndex: 2, outPath: vtt }],
        { startAt: requested ? 120 : 0, durationSeconds: requested ? 100 : 6 }); assert.equal(sub.ok, true);
      assert.match(fs.readFileSync(vtt, 'utf8'), requested ? /03:19.000/ : /00:02.000/);
      const row = { requested, bucket, origin, shift, args: avArgs, probe: compact(pp), corrected, normalized,
        audioVideoErrorMs: Math.round((corrected.tone - corrected.flash) * 1000),
        subtitleErrorMs: Math.round((origin + corrected.flash - shift - cue) * 1000),
        legacyMeasurementErrorMs: Math.round((origin + normalized.flash - shift - cue) * 1000),
        markerRebaseSeconds: corrected.flash - normalized.flash };
      result.sync.push(row); fs.writeFileSync(path.join(out, `sync-${requested}-packets.json`), JSON.stringify(pp, null, 2));
      assert(Math.abs(row.audioVideoErrorMs) <= 60); assert(Math.abs(row.subtitleErrorMs) <= 60);
      const [tn, td] = pp.streams.find(s => s.codec_type === 'video').time_base.split('/').map(Number);
      const tick = tn / td;
      const detectorOrigin = Math.round(Number(pp.format.start_time) / tick) * tick;
      assert(Math.abs(row.markerRebaseSeconds - detectorOrigin) < .00001, 'detector subtracts format.start_time rounded to its video time base');
    }
    console.log(JSON.stringify({ label, hevcErrorMs: result.hevc.maxRelativePtsErrorMs, sync: result.sync.map(x => ({ requested: x.requested,
      avMs: x.audioVideoErrorMs, subtitleMs: x.subtitleErrorMs, legacyMs: x.legacyMeasurementErrorMs })) }));
  }
} finally {
  fs.writeFileSync(path.join(root, 'matrix.json'), JSON.stringify(report, null, 2));
  for (const tmp of temporaryTrees) fs.rmSync(tmp, { recursive: true, force: true });
}
