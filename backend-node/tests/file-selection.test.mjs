import assert from 'node:assert/strict';
import { pickBestFile, fileIdentity } from '../services/playback/fileSelection.js';
const pack = [
  { fileId: 0, name: 'Alusia.gif', size: 10 },
  { fileId: 1, name: 'The Conjuring 2 2016.mkv', size: 30 },
  { fileId: 3, name: 'The Conjuring 2013.mkv', size: 40 },
  { fileId: 4, name: 'The Conjuring Last Rites 2025.mkv', size: 100 },
  { fileId: 2, name: 'The Conjuring The Devil Made Me Do It 2021.mkv', size: 50 },
].map(f => ({ ...f, path: `The Conjuring 2013-2025/${f.name}` }));
const expected = { expectedTitles: ['The Conjuring: The Devil Made Me Do It'], expectedYear: 2021 };
assert.equal(pickBestFile(pack, expected).fileId, 2);
assert.equal(pickBestFile([...pack].reverse(), { ...expected, fileIdx: 4 }).fileId, 2, 'catalog defeats wrong addon index');
assert.equal(pickBestFile(pack.filter(f => f.fileId !== 2), expected), null, 'missing film must not select sequel');
assert.equal(pickBestFile(pack, { fileIdx: 2 }).fileId, 2, 'file ID is not array position');
assert.equal(pickBestFile([{ fileId: 0, name: 'The Conjuring The Devil Made Me Do It 2021-RARBG.mp4' }], expected).fileId, 0);
assert.equal(pickBestFile([{ fileId: 0, name: 'sample.mkv' }]), null);
assert.equal(pickBestFile(pack.slice(0, 1)), null);
assert.equal(pickBestFile([{ fileId: 1, name: 'Show.S01E05.mkv', size: 100 }, { fileId: 2, name: 'Show.S02E05.mkv', size: 1 }], { season: 2, episode: 5 }).fileId, 2);
assert.equal(fileIdentity('ABC', 0), fileIdentity('abc', '0'));
assert.notEqual(fileIdentity('abc', 2), fileIdentity('abc', 4), 'same pack different movie never shares byte-derived cache');
assert.notEqual(fileIdentity('abc', null), fileIdentity('abc', 0));
assert.ok(!fileIdentity('abc', '../../other').includes('/'));
console.log('file-selection tests passed');
