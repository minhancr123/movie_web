import test from 'node:test';
import assert from 'node:assert/strict';
import { selectEmbeddedSubtitleTracks, needsEmbeddedInventory } from '../services/playback/subtitleInventory.js';

const convertible = codec => codec === 'subrip';
const subtitles = Array.from({ length: 43 }, (_, i) => ({
  streamIndex: i + 2, codec: 'subrip', language: i < 2 ? 'eng' : i === 42 ? 'vie' : 'fra',
}));

test('Vietnamese after dozens of tracks survives the extraction cap with its original stream identity', () => {
  const picked = selectEmbeddedSubtitleTracks(subtitles, convertible);
  assert.equal(picked.length, 6);
  assert.equal(picked[0].inventoryIndex, 42);
  assert.equal(picked[0].streamIndex, 44);
  assert.deepEqual(picked.slice(1, 3).map(s => s.inventoryIndex), [0, 1]);
  assert.equal(subtitles[0].language, 'eng', 'source ordering must not mutate');
  const image = [{ language: 'vie', codec: 'hdmv_pgs_subtitle' }, ...subtitles];
  assert.equal(selectEmbeddedSubtitleTracks(image, convertible)[0].inventoryIndex, 43);
});

test('explicit full inventory upgrades online results only for an owned playing file', () => {
  const request = { externalOnly: false, ownedSession: {}, probeFacts: { subtitles }, readyTracks: [], convertible };
  assert.equal(needsEmbeddedInventory(request), true);
  assert.equal(needsEmbeddedInventory({ ...request, externalOnly: true }), false, 'prefetch stays cheap');
  assert.equal(needsEmbeddedInventory({ ...request, ownedSession: null }), false, 'foreign sessions cannot trigger extraction');
  const readyTracks = selectEmbeddedSubtitleTracks(subtitles, convertible).map(s => ({ id: `file:${s.inventoryIndex}` }));
  assert.equal(needsEmbeddedInventory({ ...request, readyTracks }), false);
  assert.equal(needsEmbeddedInventory({ ...request, probeFacts: { subtitles: [] } }), false);
  assert.equal(needsEmbeddedInventory({ ...request, probeFacts: null }), true);
});
