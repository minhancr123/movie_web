/**
 * Cluster D, test #9: rendition eviction respects viewer leases.
 *
 * A finished rendition being watched used to be evictable the moment it
 * turned LRU-oldest. Pins (fed by session heartbeat/leave) make it
 * inviolable until every viewer leaves or lapses; expiry and over-cap
 * eviction both skip pinned ids, and an all-pinned store evicts nothing.
 *
 * Run: node tests/rendition-lease-pin.test.mjs
 */
import assert from 'node:assert/strict';
import {
  selectRenditionEvictions,
  pinRenditionViewer,
  unpinRenditionViewer,
  getPinnedRenditionIds,
  isRenditionPinned,
} from '../services/playback/renditions.js';
import { VIEWER_LEASE_MS } from '../services/playback/remuxService.js';

const GB = 1024 ** 3;
const DAY = 24 * 60 * 60 * 1000;
const now = 1_000_000_000;
const rid = (n) => n.toString(16).padStart(32, '0');

// Three renditions, 60 GB total against a 25 GB cap: oldest-first LRU would
// evict `oldest` (30 GB) first. With it pinned, the planner must take the
// next-oldest instead (20 GB → 10 GB left, under cap).
const entries = [
  { renditionId: rid(1), bytes: 30 * GB, lastAccessAtMs: now - 3 * DAY },
  { renditionId: rid(2), bytes: 20 * GB, lastAccessAtMs: now - 2 * DAY },
  { renditionId: rid(3), bytes: 10 * GB, lastAccessAtMs: now - 1 * DAY },
];
const opts = { now, maxBytes: 25 * GB, ttlMs: 14 * DAY };

/* --------------------------------------- pin shields the LRU victim */

assert.equal(pinRenditionViewer(rid(1), 'viewer-a', now), true, 'pin sticks');
assert.deepEqual(
  selectRenditionEvictions(entries, { ...opts, pinnedIds: getPinnedRenditionIds({ now }) }),
  { evict: [rid(2), rid(3)], expiredBytes: 0 },
  'pinned oldest survives; unpinned victims drain until pinned-only total fits (30 GB pinned still counts)',
);
console.log('ok - pin shields the LRU victim');

/* ----------------------- pinned bytes still count toward the cap */

// 80 GB pinned (watched) + 35 GB unpinned against a 100 GB cap: the disk
// really holds 115 GB, so the unpinned 35 GB must go even though the pinned
// 80 GB can never be a victim.
pinRenditionViewer(rid(1), 'watcher', now);
{
  const big = [
    { renditionId: rid(1), bytes: 80 * GB, lastAccessAtMs: now - 1 * DAY },
    { renditionId: rid(2), bytes: 35 * GB, lastAccessAtMs: now - 2 * DAY },
  ];
  assert.deepEqual(
    selectRenditionEvictions(big, {
      now, maxBytes: 100 * GB, ttlMs: 14 * DAY, pinnedIds: getPinnedRenditionIds({ now }),
    }),
    { evict: [rid(2)], expiredBytes: 0 },
    'pinned bytes count toward the cap; only unpinned victims evict',
  );
}
unpinRenditionViewer(rid(1), 'watcher');
console.log('ok - pinned bytes count toward the cap');

/* -------------------------------------- leave re-arms the eviction */

assert.equal(unpinRenditionViewer(rid(1), 'viewer-a'), 0, 'last leave prunes the id');
assert.deepEqual(
  selectRenditionEvictions(entries, { ...opts, pinnedIds: getPinnedRenditionIds({ now }) }).evict,
  [rid(1), rid(2)],
  'after leave the oldest is evictable again (30+20 GB to get 60 GB under a 25 GB cap)',
);
console.log('ok - leave re-arms eviction');

/* --------------------------------- lapsed leases do not pin forever */

pinRenditionViewer(rid(1), 'crashed-tab', now - VIEWER_LEASE_MS - 1000);
assert.deepEqual(
  [...getPinnedRenditionIds({ now })],
  [],
  'crashed tab without heartbeat lapses out of the pin set',
);
assert.deepEqual(
  selectRenditionEvictions(entries, { ...opts, pinnedIds: getPinnedRenditionIds({ now }) }).evict,
  [rid(1), rid(2)],
  'lapsed pin evicts normally (same math as unpinned)',
);
console.log('ok - lapsed leases stop pinning');

/* --------------------------------------- all pinned evicts nothing */

pinRenditionViewer(rid(1), 'a', now);
pinRenditionViewer(rid(2), 'b', now);
pinRenditionViewer(rid(3), 'c', now);
assert.deepEqual(
  selectRenditionEvictions(entries, { ...opts, pinnedIds: getPinnedRenditionIds({ now }) }),
  { evict: [], expiredBytes: 0 },
  'an all-pinned store evicts nothing (log, never delete what plays)',
);
console.log('ok - all-pinned store evicts nothing');

/* ----------------- single-id re-check for the pre-unlink guard */

pinRenditionViewer(rid(4), 'watcher', now);
assert.equal(isRenditionPinned(rid(4), { now }), true, 'live pin reads pinned');
assert.equal(isRenditionPinned(rid(4), { now: now + VIEWER_LEASE_MS + 1 }), false, 'lapsed pin reads unpinned');
assert.equal(isRenditionPinned(rid(9), { now }), false, 'unknown id reads unpinned');
assert.equal(isRenditionPinned('junk', { now }), false, 'junk id reads unpinned');
unpinRenditionViewer(rid(4), 'watcher');
console.log('ok - single-id pin re-check');

/* ------------------------------------------------- pin hygiene */

assert.equal(pinRenditionViewer('not-an-id', 'x'), false, 'junk rendition id refused');
assert.equal(pinRenditionViewer(rid(1), ''), false, 'empty viewer refused');
assert.equal(unpinRenditionViewer(rid(9), 'ghost'), 0, 'unknown id reports 0');
// Two viewers, one leaves: still pinned.
unpinRenditionViewer(rid(1), 'a');
assert.deepEqual([...getPinnedRenditionIds({ now })].sort(), [rid(2), rid(3)].sort(), 'second viewer keeps the pin');
unpinRenditionViewer(rid(2), 'b');
unpinRenditionViewer(rid(3), 'c');
assert.deepEqual([...getPinnedRenditionIds({ now })], [], 'cleanup leaves no pins behind');
console.log('ok - pin hygiene (multi-viewer, junk input)');

console.log('ok - rendition lease pins (cluster D)');
