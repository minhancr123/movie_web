/**
 * Cluster D, test #8: atomic writer admission.
 *
 * Two resolves for different titles used to check a free slot across an
 * `await` and both spawn past REMUX_MAX_WRITERS=1. Reservations close it:
 * the take is synchronous (no await between check and hold), reaps
 * expendable writers when full, self-releases on TTL, and releases in
 * `finally` on every non-spawn exit. Direct plays and finished renditions
 * never take one (they spawn nothing — asserted by code path, no acquire
 * call exists outside startRemuxSession).
 *
 * Run: node tests/remux-atomic-admission.test.mjs
 */
import assert from 'node:assert/strict';
import {
  acquireWriterReservation,
  releaseWriterReservation,
  consumeWriterReservation,
  reservedWriterCount,
  pendingReservationBytes,
  admitRemuxDisk,
  RemuxBusyError,
  writerSlotStatus,
} from '../services/playback/remuxService.js';

const GB = 1024 ** 3;

/* --------------------------------- atomic take, limit=1 (production) */

{
  const first = await acquireWriterReservation({ sessionId: 'film-a', needBytes: 5 * GB, limit: 1 });
  assert.equal(first.admitted, true, 'first resolve holds the only slot');
  assert.ok(first.reservationId, 'reservation token issued');
  assert.equal(reservedWriterCount(), 1, 'one outstanding reservation');

  // Synchronous second take: must refuse, never double-hold. This is the
  // exact interleaving that used to spawn two writers.
  const second = await acquireWriterReservation({ sessionId: 'film-b', needBytes: 5 * GB, limit: 1 });
  assert.equal(second.admitted, false, 'second resolve refused while the slot is held');
  assert.ok(second.error instanceof RemuxBusyError, 'refusal is a typed 503, not a crash');

  // Stage feed reports full honestly while the slot is promised away.
  const slot = writerSlotStatus({ limit: 1 });
  assert.equal(slot.full, true, 'slot status counts the reservation');

  // Handoff: A releases (abort/fail/switch), B admits immediately.
  assert.equal(releaseWriterReservation(first.reservationId), true, 'release works');
  assert.equal(reservedWriterCount(), 0, 'no outstanding reservations');
  const third = await acquireWriterReservation({ sessionId: 'film-b', needBytes: 5 * GB, limit: 1 });
  assert.equal(third.admitted, true, 'freed slot admits the next film');
  releaseWriterReservation(third.reservationId);

  // Double release is a no-op, never a throw.
  assert.equal(releaseWriterReservation(third.reservationId), false, 'second release reports false');
  assert.equal(releaseWriterReservation('rsv-nope'), false, 'unknown id reports false');
  console.log('ok - reservation take is atomic under limit=1, handoff works');
}

/* ----------------- consume-before-spawn: a TTL-expired token never spawns
   blind. If the disk/encoder awaits outlast the TTL, consume re-validates:
   live token converts, dead token re-takes a free slot or refuses. */

{
  // Live token converts (returns the held id).
  const live = await acquireWriterReservation({ sessionId: 'film-d', needBytes: GB, limit: 1 });
  assert.equal(consumeWriterReservation(live.reservationId, { limit: 1 }), live.reservationId, 'live token consumes');
  assert.equal(reservedWriterCount(), 0, 'consumed token holds nothing');

  // Expired token with a free slot re-takes instead of spawning blind.
  const stale = await acquireWriterReservation({
    sessionId: 'film-e', needBytes: GB, limit: 1, timeoutMs: 30,
  });
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(reservedWriterCount(), 0, 'TTL released the stale token');
  const retaken = consumeWriterReservation(stale.reservationId, { limit: 1 });
  assert.ok(retaken && retaken !== stale.reservationId, 'free slot re-taken atomically under a fresh id');
  assert.equal(reservedWriterCount(), 1, 're-take holds exactly one slot');

  // Expired token with the slot taken elsewhere refuses instead of
  // oversubscribing past REMUX_MAX_WRITERS=1.
  assert.equal(consumeWriterReservation('rsv-dead-beef', { limit: 1 }), false, 'dead token refuses when full');

  // Unknown id with a free slot takes one (same path, no special case).
  releaseWriterReservation(retaken);
  const fresh = consumeWriterReservation('rsv-dead-beef', { limit: 1 });
  assert.ok(fresh, 'free slot takes one');
  assert.equal(reservedWriterCount(), 1, 'exactly one slot held');
  releaseWriterReservation(fresh);
  assert.equal(reservedWriterCount(), 0, 'cleanup leaves no reservations');
  console.log('ok - consume re-validates instead of spawning blind');
}

/* ------------------------------------------------------- TTL backstop */

{
  const held = await acquireWriterReservation({
    sessionId: 'crashed-resolve', needBytes: GB, limit: 1, timeoutMs: 30,
  });
  assert.equal(held.admitted, true, 'slot taken');
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(reservedWriterCount(), 0, 'crashed resolve self-releases after TTL');
  const next = await acquireWriterReservation({ sessionId: 'film-c', needBytes: GB, limit: 1 });
  assert.equal(next.admitted, true, 'box recovers without operator help');
  releaseWriterReservation(next.reservationId);
  console.log('ok - reservation TTL bounds a wedged slot');
}

/* ------------------------------------- disk counts promised bytes (test
   #9 case 3: 14 GB free, 6 GB floor → 8 GB usable; job 1 needs 5 GB and is
   admitted but has written nothing; job 2 needs 5 GB and must be refused) */

{
  const free = 14 * GB;
  const reserve = 6 * GB;
  const r1 = await acquireWriterReservation({ sessionId: 'job-1', needBytes: 5 * GB, limit: 3 });
  assert.equal(r1.admitted, true, 'job 1 admitted');
  assert.equal(pendingReservationBytes(), 5 * GB, 'promised bytes tracked');

  const job2 = admitRemuxDisk({
    freeBytes: free,
    needBytes: 5 * GB,
    reserveBytes: reserve,
    reservedBytes: pendingReservationBytes(),
  });
  assert.equal(job2.admitted, false, 'job 2 refused: 8 - 5 = 3 < 5 GB');

  const withoutAccounting = admitRemuxDisk({ freeBytes: free, needBytes: 5 * GB, reserveBytes: reserve });
  assert.equal(withoutAccounting.admitted, true, 'sanity: no accounting would have admitted (the old bug)');

  // Own reservation never counts against itself (no double charge inside
  // startRemuxSession, which excludes its own id).
  const self = admitRemuxDisk({
    freeBytes: free,
    needBytes: 5 * GB,
    reserveBytes: reserve,
    reservedBytes: pendingReservationBytes(r1.reservationId),
  });
  assert.equal(self.admitted, true, 'excluding self admits the holder itself');

  releaseWriterReservation(r1.reservationId);
  assert.equal(pendingReservationBytes(), 0, 'release clears the accounting');
  console.log('ok - disk admission counts admitted-but-unwritten jobs');
}

console.log('ok - atomic admission (cluster D)');
