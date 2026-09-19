/**
 * Audio-filter wiring of the ffmpeg command: the explicit output-side delay,
 * the surround fold, the VFR-tolerant fMP4 flags, and rendition identity.
 *
 * The delay is opt-in and nothing in the resolve path asks for one. A source
 * whose audio and video streams start at different times is not out of sync —
 * ffmpeg carries that relationship through the re-encode, so deriving a delay
 * from the probe's start times pushes the audio late by exactly the container
 * offset. tests/remux-avsync-offset.test.mjs measures that end to end; here we
 * only pin how an explicitly requested delay reaches the command line.
 *
 * Run: node tests/remux-audio-delay.test.mjs (pure arg building, no ffmpeg).
 */
import assert from 'node:assert/strict';
import { buildFfmpegArgs } from '../services/playback/remuxService.js';
import { buildRenditionId } from '../services/playback/renditions.js';

/* ------------------------------------------------------- ffmpeg wiring */

const base = {
  inputUrl: 'http://example/x.mkv',
  outputDir: 'C:\\tmp\\out',
  audioCopy: false,
  segmentSeconds: 4,
  audioStreamIndex: null,
  audioChannels: 2,
  video: { mode: 'remux' },
  encoder: null,
};

const afOf = (args) => args[args.indexOf('-af') + 1];

const stereo = buildFfmpegArgs({ ...base, audioDelayMs: 500 });
assert.ok(stereo.includes('-af'), 'delayed stereo gains an audio filter');
assert.match(afOf(stereo), /adelay=500:all=1/, 'delay value lands in the filter');
assert.ok(stereo.includes('-ac'), 'stereo fold kept beside the delay');
assert.deepEqual(
  afOf(stereo).split(','),
  ['adelay=500:all=1'],
  'no downmix leaking into a stereo track',
);

const surround = buildFfmpegArgs({ ...base, audioChannels: 6, audioDelayMs: 250 });
assert.match(afOf(surround), /pan=stereo/, 'surround keeps its dialogue fold');
assert.match(afOf(surround), /adelay=250:all=1/, 'delay chained after the fold');
assert.ok(!surround.includes('-ac'), 'fold still emits stereo on its own');

const plain = buildFfmpegArgs(base);
assert.ok(!plain.includes('-af'), 'no delay configured -> command byte-identical to before');
assert.ok(plain.includes('-ac'), 'plain stereo keeps the -ac 2 fold');

const copied = buildFfmpegArgs({ ...base, audioCopy: true, audioDelayMs: 500 });
assert.ok(!copied.includes('-af'), 'stream copy cannot filter: delay skipped, not crashed');
console.log('ok - adelay chained correctly, copy path untouched');

/* ------------------------------------------ VFR-tolerant fMP4 flags */

// Copy path (mode !== 'transcode'): must include -fps_mode:v passthrough
// so VFR timestamps are forwarded without the negative-duration clamping
// that kills writers on variable-frame-rate sources.
const copyArgs = buildFfmpegArgs({ ...base, video: null });
assert.ok(
  copyArgs.includes('-fps_mode:v') && copyArgs[copyArgs.indexOf('-fps_mode:v') + 1] === 'passthrough',
  'copy path carries -fps_mode:v passthrough for VFR sources',
);
assert.ok(
  copyArgs.includes('-max_interleave_delta') && copyArgs[copyArgs.indexOf('-max_interleave_delta') + 1] === '0',
  'interleave delta check disabled',
);
assert.ok(
  copyArgs.includes('-max_muxing_queue_size') && copyArgs[copyArgs.indexOf('-max_muxing_queue_size') + 1] === '2048',
  'mux queue raised for VFR bursts',
);

// Transcode path: fps_mode passthrough must NOT be set — the encoder
// emits its own constant timescale and passthrough would fight it.
const transcodeArgs = buildFfmpegArgs({
  ...base,
  video: { mode: 'transcode', height: 720, kbps: 4000 },
  encoder: { encoder: 'libx264', hardware: false },
});
assert.ok(
  !transcodeArgs.includes('-fps_mode:v'),
  'transcode path omits fps_mode passthrough (encoder owns timescale)',
);
// Interleave delta and queue size are still present (harmless, help with
// quirky source containers on the audio side too).
assert.ok(transcodeArgs.includes('-max_interleave_delta'), 'interleave delta present on transcode too');
assert.ok(transcodeArgs.includes('-max_muxing_queue_size'), 'mux queue present on transcode too');
console.log('ok - VFR-tolerant flags set correctly per path');

/* ------------------------------------------------------- rendition id */

const idBase = { infoHash: 'a'.repeat(40), fileId: 7 };
const idPlain = buildRenditionId(idBase);
assert.equal(buildRenditionId({ ...idBase }), idPlain, 'stable without delay');
assert.equal(buildRenditionId({ ...idBase, audioDelayMs: 0 }), idPlain, 'explicit 0 keeps the id');
assert.notEqual(
  buildRenditionId({ ...idBase, audioDelayMs: 500 }),
  idPlain,
  'compensated bytes must not share an id with uncompensated ones',
);
console.log('ok - rendition id forks on compensation only');

console.log('ok - audio filter wiring, VFR flags and rendition identity');
