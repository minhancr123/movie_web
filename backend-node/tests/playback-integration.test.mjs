/**
 * A/B/D integration: the per-module suites prove each half; this file plays
 * them together the way one unlucky viewing does — a far seek onto a
 * bucketed session whose grant dies mid-watch while the single writer slot
 * turns over to the next film, with a finished rendition pinned throughout.
 *
 * No DB, no ffmpeg, no network: real modules (mediaGrant, remuxService,
 * renditions) with short TTLs and a limit of 1. Frontend timeline math
 * (origin 600 / target 780 → local 180) is covered in
 * frontend/tests/playback-progress.test.mjs; here the backend holds its end
 * of the same contract.
 *
 * Run: node tests/playback-integration.test.mjs
 */
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-login-jwt-secret-0123456789abcdef';
process.env.MEDIA_GRANT_SECRET = 'test-media-grant-secret-fedcba9876543210';

const grant = await import('../services/playback/mediaGrant.js');
const svc = await import('../services/playback/remuxService.js');
const rend = await import('../services/playback/renditions.js');

const GB = 1024 ** 3;
const SID_A = 'a'.repeat(32);
const SID_B = 'b'.repeat(32);
const RID = 'c'.repeat(32);
const expiredToken = (sid) => jwt.sign(
  {
    pur: grant.MEDIA_GRANT_PURPOSE,
    aud: grant.MEDIA_GRANT_AUDIENCE,
    sid,
    exp: Math.floor(Date.now() / 1000) - 30,
  },
  process.env.MEDIA_GRANT_SECRET,
);

/* --- 1. seek session + grant dies mid-watch + writer turns over (A/B/D) */

{
  // Film A holds the only writer slot via reservation (limit=1 production).
  const holdA = await svc.acquireWriterReservation({ sessionId: SID_A, needBytes: 5 * GB, limit: 1 });
  assert.equal(holdA.admitted, true, 'A holds the writer slot');

  // A's manifest grant dies mid-watch: reads expired, stable cache misses,
  // rotation mints a fresh grant for the SAME session (position preserved:
  // the player restores local=180 from targetAt, never re-resolves).
  const dead = expiredToken(SID_A);
  assert.equal(grant.verifyMediaGrant(dead, { expectSessionId: SID_A }).reason, 'expired');
  grant.clearStableGrants();
  const fresh = grant.mintMediaGrant({ sessionId: SID_A });
  assert.equal(grant.verifyMediaGrant(fresh.token, { expectSessionId: SID_A }).ok, true);
  grant.putStableGrant(`s:${SID_A}`, fresh.token, fresh.expiresAtMs);

  // Viewer switches to film B: B cannot take the held slot...
  const holdB = await svc.acquireWriterReservation({ sessionId: SID_B, needBytes: 5 * GB, limit: 1 });
  assert.equal(holdB.admitted, false, 'B refused while A holds the slot');
  assert.ok(holdB.error && holdB.error.code === 'REMUX_BUSY', 'refusal is typed 503');

  // ...until A hands over: leave drains A's lease, B acquires.
  svc.releaseWriterReservation(holdA.reservationId);
  const retryB = await svc.acquireWriterReservation({ sessionId: SID_B, needBytes: 5 * GB, limit: 1 });
  assert.equal(retryB.admitted, true, 'B admits after handoff');
  svc.releaseWriterReservation(retryB.reservationId);

  console.log('ok - seek session survives grant rotation while the writer slot turns over');
}

/* --- 2. pinned finished bytes survive a budget eviction during the above */

{
  const now = 1_000_000_000;
  const rid = (n) => n.toString(16).padStart(32, '0');
  // Finished rendition of film A, watched right now; two stale unpinned
  // piles push the store 20 GB over a 50 GB cap.
  rend.pinRenditionViewer(RID, 'viewer-a', now);
  const entries = [
    { renditionId: RID, bytes: 40 * GB, lastAccessAtMs: now - 1000 },
    { renditionId: rid(2), bytes: 20 * GB, lastAccessAtMs: now - 10 * 86400_000 },
    { renditionId: rid(3), bytes: 10 * GB, lastAccessAtMs: now - 11 * 86400_000 },
  ];
  const { evict } = rend.selectRenditionEvictions(entries, {
    now, maxBytes: 50 * GB, ttlMs: 14 * 86400_000, pinnedIds: rend.getPinnedRenditionIds({ now }),
  });
  assert.ok(!evict.includes(RID), 'watched bytes never evict');
  assert.ok(evict.includes(rid(2)), 'stale bytes evict instead (40 pinned counts toward the cap)');
  rend.unpinRenditionViewer(RID, 'viewer-a');
  assert.deepEqual([...rend.getPinnedRenditionIds({ now })], [], 'no pins leak');

  console.log('ok - pinned rendition survives budget pressure during handoff');
}

/* --- 3. expired grant never authorizes; scope still enforced after rotation */

{
  const dead = expiredToken(SID_A);
  assert.equal(grant.verifyMediaGrant(dead, { expectSessionId: SID_A }).ok, false);
  // Expiry is evaluated before scope: a dead token reads expired on every
  // URL, never leaking which scope it once carried.
  assert.equal(grant.verifyMediaGrant(dead, { expectSessionId: SID_B }).reason, 'expired');
  const fresh = grant.mintMediaGrant({ sessionId: SID_B });
  assert.equal(grant.verifyMediaGrant(fresh.token, { expectSessionId: SID_A }).ok, false);
  assert.equal(grant.verifyMediaGrant(fresh.token, { expectSessionId: SID_B }).ok, true);

  console.log('ok - rotation never widens scope, expiry never authorizes');
}

console.log('PASS playback-integration checks');
