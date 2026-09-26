/**
 * Admission control for ffmpeg writers.
 *
 * Every fresh remux spawns an ffmpeg that runs for as long as someone watches.
 * Nothing used to cap that: ten viewers on ten different films meant ten
 * processes, and on the audio-only copy path that is survivable while on the
 * video-transcode path it is not (measured in this repo at 53.7s of CPU per
 * 60s of 4K on libx264). A public deployment needs a ceiling and an honest
 * "busy" answer rather than a box that thrashes until every stream stalls.
 *
 * Reuse is deliberately NOT gated: joining a session that is already running,
 * or serving a finished rendition off disk, spawns nothing and must keep
 * working however busy the box is — otherwise the cap would start refusing
 * the very viewers it costs nothing to serve.
 *
 * Run: node tests/remux-concurrency.test.mjs (pure policy, no ffmpeg).
 */
import assert from 'node:assert/strict';
import {
  admitRemuxWriter,
  remuxWriterLimit,
  RemuxBusyError,
  reapPlan,
  idleWriterIds,
  spawnBeatsReuse,
} from '../services/playback/remuxService.js';

/* ------------------------------------------------------------- admission */

assert.equal(admitRemuxWriter({ active: 0, limit: 3 }), true, 'idle box admits');
assert.equal(admitRemuxWriter({ active: 2, limit: 3 }), true, 'below the ceiling admits');
assert.equal(admitRemuxWriter({ active: 3, limit: 3 }), false, 'at the ceiling refuses');
assert.equal(admitRemuxWriter({ active: 9, limit: 3 }), false, 'over the ceiling refuses');

// A limit of 0 means "no new writers", not "unlimited": an operator draining a
// box before a restart must be able to say so.
assert.equal(admitRemuxWriter({ active: 0, limit: 0 }), false, 'zero drains the box');

// Junk must fail OPEN. A miscounted session is a bad reason to refuse every
// viewer; the ceiling is a safety valve, not an authorisation check.
assert.equal(admitRemuxWriter({ active: NaN, limit: 3 }), true, 'unknown count admits');
assert.equal(admitRemuxWriter({ active: 1, limit: NaN }), true, 'unknown limit admits');
assert.equal(admitRemuxWriter({ active: 1 }), true, 'missing limit admits');
console.log('ok - writer admission counts spawns, fails open on junk');

/* ----------------------------------------------------------------- limit */

assert.equal(remuxWriterLimit({}), 3, 'default ceiling');
assert.equal(remuxWriterLimit({ REMUX_MAX_WRITERS: '8' }), 8, 'operator override');
assert.equal(remuxWriterLimit({ REMUX_MAX_WRITERS: '0' }), 0, 'zero is a real setting');
assert.equal(remuxWriterLimit({ REMUX_MAX_WRITERS: '' }), 3, 'blank falls back');
assert.equal(remuxWriterLimit({ REMUX_MAX_WRITERS: 'lots' }), 3, 'nonsense falls back');
assert.equal(remuxWriterLimit({ REMUX_MAX_WRITERS: '-2' }), 3, 'negative falls back');
assert.equal(remuxWriterLimit({ REMUX_MAX_WRITERS: '2.7' }), 2, 'floors to whole processes');
console.log('ok - writer ceiling read from the environment');

/* ----------------------------------------------------------------- error */

const err = new RemuxBusyError(3);
assert.ok(err instanceof Error, 'is an Error so existing handlers still work');
assert.equal(err.code, 'REMUX_BUSY', 'carries a code the controller can branch on');
assert.equal(err.status, 503, 'maps to Service Unavailable, not a 500');
assert.match(err.message, /3/, 'says what the ceiling was');
console.log('ok - busy refusal is typed, not a generic crash');

/* ------------------------------------------------------------------ reaping */

// A writer that has been superseded still runs ffmpeg for its 90s grace, so it
// costs a slot — but it has already been replaced and nobody is watching it.
// Counting it against the ceiling let ONE viewer lock themselves out: three
// seeks inside the grace window and their next seek came back 503. Expendable
// writers must be reaped before anyone is refused.
assert.deepEqual(reapPlan({ active: 3, limit: 3, superseded: ['a', 'b'] }), ['a'],
  'free exactly one slot, oldest first');
assert.deepEqual(reapPlan({ active: 5, limit: 3, superseded: ['a', 'b', 'c'] }), ['a', 'b', 'c'],
  'over the ceiling reaps as many as it can');
assert.deepEqual(reapPlan({ active: 2, limit: 3, superseded: ['a'] }), [],
  'room to spare reaps nothing — the grace window is worth keeping');
assert.deepEqual(reapPlan({ active: 3, limit: 3, superseded: [] }), [],
  'nothing expendable: the refusal is real');
assert.deepEqual(reapPlan({ active: 9, limit: 3, superseded: ['a'] }), ['a'],
  'reaps what exists even when that is not enough');
assert.deepEqual(reapPlan({}), [], 'junk reaps nothing');
console.log('ok - superseded writers are reaped before anyone is refused');

/* ------------------------------------------------------ idle-writer reaping */

// On a box configured for ONE writer, the slot is the whole capacity, and a
// writer nobody has fetched from still holds it. Measured: a viewer took 503
// three times and then sat through a retry ladder for ~40s while the slot
// belonged to a session whose last playlist request was minutes old. A writer
// that has not been requested from is not the viewer who is waiting.
{
  const now = 1_000_000;
  const live = { process: { killed: false }, exitCode: undefined, lastAccessAt: now - 200_000 };
  const fresh = { process: { killed: false }, exitCode: undefined, lastAccessAt: now - 1_000 };
  const sessions = new Map([['stale', live], ['watched', fresh]]);

  assert.deepEqual(idleWriterIds(sessions, { now, idleMs: 90_000 }), ['stale'],
    'only the unrequested writer is reapable');
  assert.deepEqual(idleWriterIds(sessions, { now, idleMs: 500_000 }), [],
    'nothing is stale yet');
  // Oldest first, so the longest-abandoned slot is freed.
  const older = { process: { killed: false }, lastAccessAt: now - 900_000 };
  const newer = { process: { killed: false }, lastAccessAt: now - 100_000 };
  assert.deepEqual(
    idleWriterIds(new Map([['newer', newer], ['older', older]]), { now, idleMs: 90_000 }),
    ['older', 'newer'],
    'oldest access first',
  );
  // A writer that already exited, or was killed, holds no slot to free.
  const exited = { process: { killed: false }, exitCode: 0, lastAccessAt: now - 900_000 };
  const killed = { process: { killed: true }, lastAccessAt: now - 900_000 };
  assert.deepEqual(idleWriterIds(new Map([['e', exited], ['k', killed]]), { now, idleMs: 1_000 }), [],
    'a dead writer is not a slot');
  // Fails safe: never reap on a shape we do not understand.
  assert.deepEqual(idleWriterIds(null, { now, idleMs: 1_000 }), []);
  assert.deepEqual(idleWriterIds(sessions, { now, idleMs: 0 }), []);
  assert.deepEqual(idleWriterIds(sessions, { now, idleMs: NaN }), []);
  console.log('ok - only a writer nobody is watching may be reaped');
}

// Superseded writers keep priority: nobody is watching those by definition.
// Idle ones are the fallback, and a writer must not be listed twice.
assert.deepEqual(
  reapPlan({ active: 4, limit: 3, superseded: ['a'], idle: ['a', 'b', 'c'] }),
  ['a', 'b'],
  'two slots short: superseded first, then idle, never twice',
);
assert.deepEqual(
  reapPlan({ active: 3, limit: 3, superseded: [], idle: ['x'] }),
  ['x'],
  'an idle writer is reaped when nothing is superseded',
);
assert.deepEqual(
  reapPlan({ active: 2, limit: 3, superseded: ['a'], idle: ['b'] }),
  [],
  'room to spare still reaps nothing — a watched writer is never sacrificed',
);
console.log('ok - an idle writer is reaped only to make room for one who is waiting');

/* ------------------------------------------------ duplicate writers on seek */

// A live session that has not yet written as far as the viewer wants is still
// the best answer when a replacement would begin no earlier: spawning one then
// throws away the progress already made and races the same bytes twice. That
// is what happened on every seek once truncated sessions were switched off —
// four ffmpegs, all from 0, all equally unable to reach the target.
assert.equal(spawnBeatsReuse({ sessionStartAt: 0, freshStartAt: 0 }), false,
  'a replacement from the same origin is pure waste');
assert.equal(spawnBeatsReuse({ sessionStartAt: 300, freshStartAt: 300 }), false,
  'same origin, same waste');

// When a fresh writer really could start closer to the target, it earns itself.
assert.equal(spawnBeatsReuse({ sessionStartAt: 0, freshStartAt: 900 }), true,
  'seek-started writer skips ahead of a from-the-start one');
assert.equal(spawnBeatsReuse({ sessionStartAt: 300, freshStartAt: 900 }), true);

// Never spawn something that would start FURTHER from what the viewer wants.
assert.equal(spawnBeatsReuse({ sessionStartAt: 900, freshStartAt: 0 }), false);

// ...but only once it has something playable. Reusing a writer that has not
// yet produced a servable playlist hands the client a URL that answers 409 and
// leaves the player spinning, because the reuse path returns immediately while
// the fresh path waits for the first buffer. Below the floor, spawn and wait.
assert.equal(spawnBeatsReuse({ sessionStartAt: 0, freshStartAt: 0, playableSeconds: 0, minPlayable: 8 }), true,
  'a writer with nothing written yet cannot be handed to a player');
assert.equal(spawnBeatsReuse({ sessionStartAt: 0, freshStartAt: 0, playableSeconds: 3, minPlayable: 8 }), true,
  'below the servable floor');
assert.equal(spawnBeatsReuse({ sessionStartAt: 0, freshStartAt: 0, playableSeconds: 8, minPlayable: 8 }), false,
  'at the floor it is playable, so reuse');
assert.equal(spawnBeatsReuse({ sessionStartAt: 0, freshStartAt: 0, playableSeconds: 600, minPlayable: 8 }), false,
  'well buffered and same origin: reuse, as before');
// Omitting the floor keeps the origin-only rule these cases started with.
assert.equal(spawnBeatsReuse({ sessionStartAt: 0, freshStartAt: 0, playableSeconds: 0 }), false,
  'no floor given, no opinion about buffering');

// Junk falls toward reuse: a wasted wait beats a duplicate ffmpeg.
assert.equal(spawnBeatsReuse({ sessionStartAt: NaN, freshStartAt: 900 }), false);
assert.equal(spawnBeatsReuse({}), false);
console.log('ok - a replacement writer must start closer than the one it replaces');

console.log('ok - remux concurrency policy');
