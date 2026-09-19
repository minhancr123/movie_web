/**
 * Where a seek-started session's bytes actually begin.
 *
 * `-ss S` on a copied video stream cannot cut mid-GOP: ffmpeg starts at a
 * keyframe at or before S, and with -noaccurate_seek that can be most of a GOP
 * early. The session was nonetheless labelled with S, so the player mapped
 * every timestamp onto a film clock that was wrong by the difference —
 * subtitles early, seek bar off, resume position drifting.
 *
 * probeSeekOrigin asks ffmpeg where it would really land, by decoding exactly
 * one frame with -copyts and reading its presentation timestamp. One keyframe
 * of I/O, not a scan.
 *
 * It must fail SOFT: a source that will not seek, a dead link or a slow answer
 * has to fall back to the requested position rather than stall the resolve.
 *
 * Run: node tests/seek-origin.test.mjs (needs ffmpeg + ffprobe on PATH).
 */
import { spawnSync } from 'node:child_process';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  probeSeekOrigin,
  isPlausibleSeekOrigin,
  seekOriginProbeEnabled,
  seekStartEnabled,
  cachedSeekOrigin,
} from '../services/playback/remuxService.js';

/* ------------------------------------------------- plausibility (no ffmpeg) */

// A seek that silently did not happen reads back as "the file starts at 0".
// Believing it cost a real playback: the session was labelled as starting from
// the beginning while the viewer had asked for 16:30, the client gave up on the
// offset and the player sat spinning. No GOP is minutes long, so an origin that
// far before the request is a failed seek, not a keyframe.
assert.ok(isPlausibleSeekOrigin({ pts: 895, at: 900 }), 'a few seconds back is a keyframe');
assert.ok(isPlausibleSeekOrigin({ pts: 880, at: 900 }), 'a long GOP is still a keyframe');
assert.ok(isPlausibleSeekOrigin({ pts: 900, at: 900 }), 'landing exactly on it');
assert.ok(!isPlausibleSeekOrigin({ pts: 0, at: 900 }), 'zero for a 900s request is a failed seek');
assert.ok(!isPlausibleSeekOrigin({ pts: 10, at: 900 }), 'minutes back is a failed seek');
assert.ok(!isPlausibleSeekOrigin({ pts: 901, at: 900 }), 'never after the request');
assert.ok(!isPlausibleSeekOrigin({ pts: NaN, at: 900 }), 'unusable reading');
assert.ok(!isPlausibleSeekOrigin({ pts: -1, at: 900 }), 'negative reading');
// Small requests must still work: 0 is a fine origin when 5s was asked for.
assert.ok(isPlausibleSeekOrigin({ pts: 0, at: 5 }), 'zero is plausible near the start');
console.log('ok - implausible seek origins rejected');

/* ------------------------------------------------------- cached origin */

// The whole point: a cache MISS must not read as "the session starts at 0".
// getCache returns null when it misses (and whenever Redis is down), and
// Number(null) is 0, which is finite and non-negative and sailed straight
// through the guard. Every seek-started session was then stored as starting
// from the top while its bytes began minutes in — the player asked for 11:01,
// got a stream built from 0, and sat on a 409.
assert.equal(cachedSeekOrigin(null), null, 'a miss is not a position');
assert.equal(cachedSeekOrigin(undefined), null);
assert.equal(cachedSeekOrigin(''), null, 'Number("") is 0 too');
assert.equal(cachedSeekOrigin('  '), null);
assert.equal(cachedSeekOrigin(false), null, 'and Number(false)');
assert.equal(cachedSeekOrigin([]), null, 'and Number([])');
assert.equal(cachedSeekOrigin({}), null);
assert.equal(cachedSeekOrigin(NaN), null);
assert.equal(cachedSeekOrigin(-1), null, 'negative is not a position');

// A real stored value comes back untouched, including a genuine zero.
assert.equal(cachedSeekOrigin(0), 0, 'a measured 0 is still a real answer');
assert.equal(cachedSeekOrigin(598.4), 598.4);
assert.equal(cachedSeekOrigin('600'), 600, 'a number that survived JSON as text');
console.log('ok - a cache miss is told apart from a measured zero');

/* ---------------------------------------------------------------- gating */

// On, because isPlausibleSeekOrigin makes the bad answer harmless and the
// measurement has since been shown to work over HTTP wherever byte ranges are
// honoured. Only an explicit 0/off turns it back into a skipped step.
assert.equal(seekOriginProbeEnabled({}), true, 'on by default — the guard makes it safe');
assert.equal(seekOriginProbeEnabled({ SEEK_ORIGIN_PROBE: '1' }), true);
assert.equal(seekOriginProbeEnabled({ SEEK_ORIGIN_PROBE: '0' }), false);
assert.equal(seekOriginProbeEnabled({ SEEK_ORIGIN_PROBE: 'off' }), false);
assert.equal(seekOriginProbeEnabled({ SEEK_ORIGIN_PROBE: '' }), true, 'blank is not a decision');
console.log('ok - seek origin probe runs unless switched off');

// Seek-started sessions are opt-in for the same reason, one level up: without a
// working origin probe their label is out by however far -ss had to rewind, and
// two renditions of one film measured 3.4s apart. Subtitles wear that gap.
// On by default: a film whose subtitles are two seconds out still plays, while
// one that cannot seek past the written head does not.
assert.equal(seekStartEnabled({}), true, 'on by default');
assert.equal(seekStartEnabled({ PLAYBACK_SEEK_START: '0' }), false);
assert.equal(seekStartEnabled({ PLAYBACK_SEEK_START: 'off' }), false);
assert.equal(seekStartEnabled({ PLAYBACK_SEEK_START: '' }), true, 'blank is not a decision');
console.log('ok - seek-started sessions run unless switched off');

const have = (bin) => spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0;
if (!have('ffmpeg') || !have('ffprobe')) {
  console.log('skip - ffmpeg/ffprobe not on PATH');
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seek-origin-'));
try {
  // 60s at 24fps with a keyframe every 10s and nothing else forcing one.
  const src = path.join(tmp, 'gop.mkv');
  const made = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=60',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-bf', '2',
    '-g', '240', '-keyint_min', '240', '-sc_threshold', '0',
    '-an', src,
  ], { encoding: 'utf8' });
  assert.equal(made.status, 0, `fixture build failed: ${made.stderr}`);

  // Every request must land on the keyframe at or before it — never after,
  // which would mean the player is shown bytes it did not ask for.
  //
  // Note [10, 0]: asking for a position that IS a keyframe rewinds a whole
  // extra GOP, because -noaccurate_seek takes the keyframe strictly before the
  // request. That is exactly the kind of surprise this probe exists to measure
  // rather than model — a formula would have said 10.
  for (const [asked, expected] of [[0, 0], [10, 0], [15, 10], [25, 20], [39.9, 30], [59, 50]]) {
    const origin = await probeSeekOrigin(src, asked);
    assert.ok(Number.isFinite(origin), `no origin for -ss ${asked}`);
    assert.ok(origin <= asked + 0.001, `origin ${origin} is AFTER the request ${asked}`);
    assert.ok(
      Math.abs(origin - expected) < 0.5,
      `-ss ${asked} should land near ${expected}s, got ${origin}s`,
    );
    console.log(`  -ss ${String(asked).padStart(4)} -> origin ${origin}s`);
  }
  console.log('ok - seek origin measured, never after the request');

  // Fail soft, every way it can go wrong.
  assert.equal(await probeSeekOrigin(path.join(tmp, 'nope.mkv'), 10), null, 'missing file -> null');
  assert.equal(await probeSeekOrigin(src, 0), 0, 'from the start needs no probe');
  assert.equal(await probeSeekOrigin(src, -5), null, 'negative request -> null');
  assert.equal(await probeSeekOrigin('', 10), null, 'no input -> null');
  // Past the end, ffmpeg clamps to the last keyframe — which is indistinguishable
  // from a seek that never happened, and believing either one costs a playback.
  // Refusing both is the safe reading; the caller keeps the requested position.
  assert.equal(await probeSeekOrigin(src, 9999), null, 'a clamp minutes away is refused');
  console.log('ok - unusable input falls back instead of stalling the resolve');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('ok - seek origin probe');
