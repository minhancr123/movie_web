/** Exercise the real remux service with synthetic MKV, never provider URLs. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = path.resolve(process.argv[2] || '/data/cinevn-check');
process.env.TRANSCODE_ROOT = path.join(root, 'hls');
process.env.TRANSCODE_CACHE_MAX_GB = '2';
process.env.PLAYBACK_DISK_RESERVE_GB = '5';
process.env.REMUX_MAX_WRITERS = '1';
process.env.REMUX_READ_RATE = '0';
process.env.VIDEO_TRANSCODE_FALLBACK = 'never';
const modulePath = new URL('../../backend-node/services/playback/remuxService.js', import.meta.url);
const svc = await import(modulePath.href);
const input = path.join(root, 'remux-source.mkv');
const directProbe = await svc.ffprobe(path.join(root, 'fullhd.mp4'));
assert.equal(svc.decidePlaybackMode(directProbe, { h264: true, hevc: false }).mode, 'direct');
const probe = await svc.ffprobe(input);
assert.equal(svc.decidePlaybackMode(probe, { h264: true, hevc: false }).mode, 'remux');
assert.ok(probe.subtitles.length > 0, 'synthetic MKV must include a subtitle track');
const subtitlePath = path.join(root, 'extracted-vi.vtt');
await svc.extractSubtitleTrack(input, probe.subtitles[0].streamIndex, subtitlePath);
const extracted = await fs.readFile(subtitlePath, 'utf8');
assert.ok(extracted.includes('01:30'), 'subtitle timeline must retain the far-seek cue');
const id = 'd'.repeat(32);
const started = performance.now();
const session = await svc.startRemuxSession({
  sessionId: id, inputUrl: input, audioChannels: 1,
  durationSeconds: 120, windowSeconds: 120,
});
try {
  await svc.waitForPlaylist(session, 30000);
  const firstPlaylistMs = Math.round(performance.now() - started);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sample remux exceeded 60 seconds')), 60000);
    const done = (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${session.stderr.slice(-500)}`)); };
    if (session.process.exitCode !== null) done(session.process.exitCode);
    else session.process.once('exit', done);
  });
  const manifest = await fs.readFile(session.playlistPath, 'utf8');
  assert.ok(manifest.includes('#EXT-X-ENDLIST'));
  const durations = [...manifest.matchAll(/#EXTINF:([\d.]+)/g)].map(m => Number(m[1]));
  assert.ok(durations.reduce((a, b) => a + b, 0) >= 119);
  const outProbe = await svc.ffprobe(session.playlistPath);
  assert.equal(outProbe.video.codec, 'h264');
  assert.equal(outProbe.audio[0].codec, 'aac');
  // Decode frames far from the head and after a backward seek.
  for (const target of [90, 10]) {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin',
      '-ss', String(target), '-i', session.playlistPath, '-t', '1', '-f', 'null', '-'], { timeout: 15000 });
    assert.equal(r.status, 0, `decode at ${target}s failed`);
  }
  const result = { passed: true, firstPlaylistMs, segments: durations.length,
    durationSeconds: durations.reduce((a, b) => a + b, 0),
    video: 'h264 copy', audio: 'AC3 to AAC', decodeAtSeconds: [90, 10],
    directMode: 'passed', extractedSubtitle: 'passed',
    scope: 'Synthetic local-file pipeline check; not a provider or concurrency benchmark.' };
  await fs.writeFile(path.join(root, 'pipeline-result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await svc.stopRemuxSession(id);
}
