import test from 'node:test';
import assert from 'node:assert/strict';
import { recordViewingPresence, activeViewingQuery, VIEWING_FIELDS } from '../services/playback/viewingPresence.js';

const now = new Date('2026-11-01T07:00:00Z');
const session = { sessionId: 'session-a', tmdbId: 42246, mediaType: 'movie', expiresAt: new Date(+now + 100000) };
const fixture = () => {
  const writes = [];
  return { writes, collection: name => ({ updateOne: async (...args) => writes.push({ name, args }) }) };
};
test('resource leases and malformed player reports never mark someone as watching', async () => {
  const db = fixture();
  for (const report of [undefined, {}, { state: 'playing', position: NaN }, { state: 'playing', position: '12' }, { state: 'playing', position: -1 }, { state: 'fake', position: 1 }]) {
    await recordViewingPresence(db, session, 'owner', 'tab-a', report, now);
  }
  await recordViewingPresence(db, { ...session, expiresAt: now }, 'owner', 'tab-a', { state: 'playing', position: 12 }, now);
  assert.equal(db.writes.length, 0);
});
test('presence uses authenticated owner and server content identity, with separate per-tab records', async () => {
  const db = fixture();
  await recordViewingPresence(db, session, 'owner', 'tab-a', { state: 'playing', position: 125, userIdStr: 'attacker', tmdbId: 999 }, now);
  await recordViewingPresence(db, session, 'owner', 'tab-b', { state: 'paused', position: 20 }, now);
  const first = db.writes[0].args;
  assert.deepEqual(first[0], { userIdStr: 'owner', sessionId: 'session-a', viewerId: 'tab-a' });
  assert.equal(first[1].$set.tmdbId, 42246);
  assert.equal(first[1].$set.state, 'playing');
  assert.equal(+first[1].$set.expiresAt - now, 75000);
  assert.equal(db.writes[1].args[0].viewerId, 'tab-b');
  assert.equal(db.writes[1].args[1].$set.state, 'paused');
});
test('active admin reads require playing and recent unexpired evidence, and project no media credentials', () => {
  const query = activeViewingQuery(['owner'], now);
  assert.equal(query.state, 'playing');
  assert.deepEqual(query.userIdStr, { $in: ['owner'] });
  assert.equal(+query.seenAt.$gt, +now - 75000);
  assert.equal(+query.expiresAt.$gt, +now);
  for (const key of ['directUrl', 'sourceToken', 'infoHash', 'viewerId', 'authToken']) assert.equal(VIEWING_FIELDS[key], undefined);
});

test('viewing filters combine state and film on the same tab and keep paused films visible', async () => {
  const {filterViewingOwners,freshViewingQuery}=await import('../services/playback/viewingPresence.js');
  const rows=[{userIdStr:'a',state:'playing',type:'movie',tmdbId:1},{userIdStr:'a',state:'paused',type:'movie',tmdbId:2},{userIdStr:'b',state:'playing',type:'tv',tmdbId:2}];
  assert.deepEqual(filterViewingOwners(rows,{viewing:'paused'}),['a']);
  assert.deepEqual(filterViewingOwners(rows,{viewing:'playing',content:'movie:2'}),[]);
  assert.deepEqual(filterViewingOwners(rows,{viewing:'playing',content:'tv:2'}),['b']);
  assert.deepEqual(freshViewingQuery(now).state.$in,['playing','paused','buffering']);
});
