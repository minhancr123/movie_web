/**
 * Disk admission for ffmpeg writers.
 *
 * The writer-concurrency cap above bounds CPU and link. Nothing bounded DISK,
 * and a remux writes the source's own bytes into the session directory: a 4K
 * film was measured landing ~14GB on a 30GB box, which the eviction planner
 * could not touch — a session is only reclaimable once complete, and one in
 * progress cannot be trimmed without cutting segments out from under a live
 * writer. The filesystem reached 100% and took the site down rather than one
 * film: `git fetch` failed with ENOSPC, so deploys stopped.
 *
 * So the decision is priced BEFORE the writer exists. The trade this encodes:
 * over-pricing costs a viewer one retry, under-pricing costs the whole box.
 *
 * Run: node tests/remux-disk-admission.test.mjs (pure policy, no ffmpeg).
 */
import assert from 'node:assert/strict';
import {
  admitRemuxDisk,
  estimateSessionBytes,
  RemuxNoSpaceError,
} from '../services/playback/remuxService.js';
import { hasTechnicalTerm } from '../services/publicVocabulary.js';

const GB = 1024 ** 3;

/* ------------------------------------------------------------- estimation */

assert.equal(
  estimateSessionBytes({ kbps: 6000, durationSeconds: 10140 }),
  Math.ceil((6000 * 1000 * 10140) / 8),
  'bitrate x duration prices a remux, which copies the source',
);
assert.equal(
  estimateSessionBytes({ kbps: 3200, durationSeconds: 3600 }) / GB,
  3200 * 1000 * 3600 / 8 / GB,
  'a 720p rung prices at its own bitrate',
);
// Priced as the WHOLE film even though a session started near its target only
// writes the remainder: that margin is what stops a 4K title being admitted
// onto a box that cannot hold it.
assert.ok(
  estimateSessionBytes({ kbps: 20000, durationSeconds: 10140 }) / GB > 14,
  'a 4K-sized remux prices above 14GB',
);
// Unknown length is priced as the documented 4K worst case, never as free.
assert.equal(estimateSessionBytes({ kbps: 20000 }), 17 * GB, 'unknown length is not free');
assert.equal(estimateSessionBytes({ kbps: 0, durationSeconds: 0, height: 480 }), 2 * GB);
assert.equal(estimateSessionBytes({ kbps: 0, durationSeconds: 0, height: 2160 }), 17 * GB);
for (const junk of [null, undefined, {}]) {
  assert.equal(estimateSessionBytes(junk), 17 * GB, `junk priced as worst case: ${JSON.stringify(junk)}`);
}

/* -------------------------------------------------------------- admission */

assert.equal(
  admitRemuxDisk({ freeBytes: 14 * GB, needBytes: 4 * GB, reserveBytes: 6 * GB }).admitted,
  true,
  'room above the floor admits',
);
assert.equal(
  admitRemuxDisk({ freeBytes: 10 * GB, needBytes: 4 * GB, reserveBytes: 6 * GB }).admitted,
  true,
  'exactly the floor still admits',
);
assert.equal(
  admitRemuxDisk({ freeBytes: 13 * GB, needBytes: 14 * GB, reserveBytes: 6 * GB }).admitted,
  false,
  'a film bigger than the free space is refused',
);
assert.equal(
  admitRemuxDisk({ freeBytes: 20 * GB, needBytes: 17 * GB, reserveBytes: 6 * GB }).admitted,
  false,
  '17GB of 4K does not fit above a 6GB reserve on a 20GB-free box',
);
assert.equal(
  admitRemuxDisk({ freeBytes: 24 * GB, needBytes: 17 * GB, reserveBytes: 6 * GB }).admitted,
  true,
  '...but it does above 23GB free',
);

// An unreadable filesystem must not read as a full one: failing closed would
// take playback down entirely rather than protect the disk.
for (const bad of [null, undefined, NaN, -1]) {
  assert.equal(
    admitRemuxDisk({ freeBytes: bad, needBytes: 4 * GB }).admitted,
    true,
    `unknown free space admits: ${String(bad)}`,
  );
}
assert.equal(
  admitRemuxDisk({ freeBytes: 13 * GB, needBytes: 0 }).admitted,
  true,
  'an unpriced session is not refused on price alone',
);

/* ------------------------------------------------------------------ error */

const err = new RemuxNoSpaceError({ needBytes: 17 * GB, freeBytes: 13 * GB, reserveBytes: 6 * GB });
assert.equal(err.status, 503, '503: the viewer is early, not locked out');
assert.equal(err.code, 'REMUX_NO_SPACE');
// Machines read the numbers from the fields: the human message stays plain,
// so it can reach a viewer untouched by the vocabulary scrubber.
assert.equal(err.needBytes, 17 * GB, 'carries what the film needs');
assert.equal(err.freeBytes, 13 * GB, 'carries what is actually free');
assert.equal(hasTechnicalTerm(err.message), false, 'message is viewer-safe');

console.log('ok - disk admission: estimation, floor, fail-open, error shape');
