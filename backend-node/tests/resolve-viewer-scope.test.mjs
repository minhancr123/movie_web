import assert from 'node:assert/strict';
import { registerViewerResolve } from '../services/playback/resolveViewerScope.js';

const active = new Map();
const cancelled = [];
const releases = [];
function request(userId, viewerId, ref) {
  const record = { userId, viewerId, ref, controller: new AbortController() };
  releases.push(registerViewerResolve(active, record, r => cancelled.push(r)));
  return record;
}
// Three simultaneous films on one login must all keep preparing.
const a = request('account', 'tab-a', 'movie:299534:full');
const b = request('account', 'tab-b', 'movie:157336:full');
const c = request('account', 'tab-c', 'tv:213331:1:6');
assert.ok([a, b, c].every(r => !r.controller.signal.aborted));
assert.equal(cancelled.length, 0);
// Same-player retries stay tracked; a real episode switch cancels both.
const retry = request('account', 'tab-c', c.ref);
const next = request('account', 'tab-c', 'tv:213331:1:7');
assert.ok(c.controller.signal.aborted && retry.controller.signal.aborted);
assert.ok(!next.controller.signal.aborted && !a.controller.signal.aborted);
assert.deepEqual(cancelled, [c, retry]);
// Completing an older request cannot remove the newer intent's registry.
releases[2](); releases[3]();
const nextAgain = request('account', 'tab-c', 'tv:213331:1:8');
assert.ok(next.controller.signal.aborted && !nextAgain.controller.signal.aborted);
// Identities are account-scoped; legacy and malformed clients cannot abort
// unrelated films, nor collide with a valid viewer's namespace.
const otherAccount = request('other', 'tab-a', 'movie:2:full');
const legacy = request('account', undefined, 'movie:3:full');
const oldOther = request('account', undefined, 'movie:4:full');
const invalid = request('account', 'bad:id', 'movie:5:full');
assert.ok([a, b, otherAccount, legacy, oldOther, invalid].every(r => !r.controller.signal.aborted));
for (const release of releases) release();
assert.equal(active.size, 0);
console.log('ok - resolve cancellation is isolated per account/player, including legacy clients');
