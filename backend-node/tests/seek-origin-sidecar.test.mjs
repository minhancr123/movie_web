/**
 * Build 7: no in-process origin sidecar.
 *
 * Build 6 added a second output to the remux command (one frame, -copyts,
 * plain mp4) so the session could be labelled with where `-ss` really landed
 * instead of the requested position. It measured correctly — but only AFTER
 * the ffmpeg process exited: a plain-mp4 muxer writes its moov trailer at the
 * end, so while a film is still remuxing (always, at resolve time) the file
 * holds ftyp+mdat with no moov and ffprobe fails with "moov atom not found".
 * Proven live on a 2160p release (262KB, no moov, readSeekOrigin null) and on
 * a fixture with `-re` pacing: unreadable at every poll while alive.
 *
 * So every seek-started build-6 session silently fell back to the requested
 * position and wore every subtitle early by the keyframe rewind. The origin is
 * measured again by probeSeekOrigin (a short-lived process whose mp4 is valid
 * at once, cached per file+bucket) — covered end to end in
 * tests/seek-origin.test.mjs. This file only pins the retired shape: the
 * remux command must be a single HLS output again.
 *
 * Run: node tests/seek-origin-sidecar.test.mjs (no ffmpeg needed).
 */
import assert from 'node:assert';
import { buildFfmpegArgs, SEEK_ORIGIN_FILE } from '../services/playback/remuxService.js';

const argsFor = (startAt) => buildFfmpegArgs({
  inputUrl: 'http://example/x.mkv',
  outputDir: 'C:\tmp\out',
  audioCopy: false,
  video: startAt > 0 ? { mode: 'remux', startAt } : { mode: 'remux' },
});

const plain = argsFor(0);
assert.ok(!plain.some((a) => String(a).includes(SEEK_ORIGIN_FILE)),
  'a from-the-start session writes no sidecar');
assert.ok(!plain.includes('-copyts'), 'and carries no -copyts');

const seeked = argsFor(600);
assert.ok(!seeked.some((a) => String(a).includes(SEEK_ORIGIN_FILE)),
  'a seek-started session writes no sidecar either (build 7 retired it)');
assert.ok(!seeked.includes('-copyts'), 'no second output, no -copyts on the remux');
assert.ok(String(seeked[seeked.length - 1]).endsWith('index.m3u8'),
  'playlist stays the single final output');
console.log('ok - the remux is a single HLS output; the origin comes from the cached probe');
