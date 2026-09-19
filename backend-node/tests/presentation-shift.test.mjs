/**
 * How far a remux's clock runs ahead of the source's.
 *
 * An fMP4 timeline starts at the first DECODE timestamp. With B-frames the
 * first frame is presented `has_b_frames` frames after it is decoded, so
 * content sitting at source time T lands at T + has_b_frames/fps in the output.
 * Audio is carried along by the same amount, which is why lip sync is fine —
 * but subtitles, embedded or sidecar, are timed against the *source*, so they
 * run early by exactly this much unless the lookup compensates.
 *
 * Measured, not derived: a 2-B-frame 24fps fixture shifts 83ms and a 4-B-frame
 * one shifts 167ms, both matching has_b_frames/fps to the millisecond.
 * tests/remux-avsync-offset.test.mjs pins the measurement end to end.
 *
 * Run: node tests/presentation-shift.test.mjs (pure arithmetic, no ffmpeg).
 */
import assert from 'node:assert/strict';
import { presentationShiftMs } from '../services/playback/remuxService.js';

const probe = (hasBFrames, frameRate) => ({ video: { hasBFrames, frameRate } });

assert.equal(presentationShiftMs(probe(2, 24)), 83, '2 B-frames at 24fps');
assert.equal(presentationShiftMs(probe(4, 24)), 167, '4 B-frames at 24fps (the Moana release)');
assert.equal(presentationShiftMs(probe(3, 23.976)), 125, 'NTSC film rate');
assert.equal(presentationShiftMs(probe(2, 60)), 33, 'high frame rate shifts less');

assert.equal(presentationShiftMs(probe(0, 24)), 0, 'no B-frames, no shift');
assert.equal(presentationShiftMs(probe(2, 0)), 0, 'unknown frame rate cannot be turned into time');
assert.equal(presentationShiftMs(probe(undefined, 24)), 0, 'missing count -> no guess');
assert.equal(presentationShiftMs({ video: null }), 0, 'no video stream');
assert.equal(presentationShiftMs(null), 0, 'no probe at all');
assert.equal(presentationShiftMs(probe(-1, 24)), 0, 'nonsense count ignored');

// A reorder delay beyond a second is not a real one: refuse rather than shove
// subtitles somewhere arbitrary.
assert.equal(presentationShiftMs(probe(400, 24)), 0, 'absurd reorder depth refused');
assert.equal(presentationShiftMs(probe(23, 24)), 958, 'deep but plausible reorder still counts');

console.log('ok - presentation shift derived from B-frame reorder depth');
