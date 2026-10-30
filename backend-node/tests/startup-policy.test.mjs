import test from 'node:test';
import assert from 'node:assert/strict';
import { bucketSeekStart, seekBufferFloor, startupTarget, sessionStartupTarget, hasPlayableBuffer, initialStartupFloor, sessionPlaylistFloor } from '../services/playback/startupPolicy.js';

test('a cold seek never asks the writer to prepare a long unused prefix', () => {
  for (const at of [0, 1, 3, 29, 30, 299, 402, 1798, 7201.5]) {
    const origin = bucketSeekStart(at);
    assert.ok(origin <= at && at - origin < 4);
    const measuredOrigin = Math.max(0, origin - 1.5);
    const needed = seekBufferFloor({ requestedAt: at, origin: measuredOrigin });
    assert.ok(measuredOrigin + needed >= at + 4, 'target frame and segment are available');
    assert.ok(needed < 10, 'no half-minute head start for cold seeks');
  }
  assert.equal(bucketSeekStart(NaN), 0);
  assert.equal(bucketSeekStart(-10), 0);
});
const base = { configuredSeconds: 12, minimumSeconds: 8, initialDuration: 4, bufferedSeconds: 8, elapsedMs: 2000 };
test('a real Endgame GOP covers the exact seek runway without waiting for the next GOP', () => {
  // Production window: request 1347s, measured source origin 1340.84s,
  // EXTINF 10.427 then 10.385. The old ceil required 11s (two GOPs),
  // even though the first already contains the target plus the full 4s cushion.
  const localTarget = 1347 - 1340.84;
  const floor = seekBufferFloor({ requestedAt: 1347, origin: 1340.84 });
  const firstGop = { exists: true, ended: false, duration: 10.427 };
  assert.ok(floor >= localTarget + 4, 'retain the entire configured runway');
  assert.equal(hasPlayableBuffer(firstGop, floor), true);
  assert.equal(hasPlayableBuffer({ ...firstGop, duration: localTarget + 3.99 }, floor), false,
    'a genuinely incomplete runway must still wait');
  assert.equal(startupTarget({ ...base, seeking: true, minimumSeconds: floor }), floor);
  assert.equal(sessionStartupTarget({ startupTargetSeconds: floor }, 4), floor);
});
test('fast sources can start with two segments; slow or unmeasured writers retain the larger buffer', () => {
  assert.equal(startupTarget(base), 8);
  assert.equal(startupTarget({ ...base, elapsedMs: 6000 }), 12);
  assert.equal(startupTarget({ ...base, elapsedMs: 100 }), 12, 'a cached read alone is not a speed sample');
  assert.equal(startupTarget({ ...base, initialDuration: 8 }), 12);
  assert.equal(startupTarget({ ...base, seeking: true, minimumSeconds: 7 }), 7, 'seek target coverage is never reduced');
});
test('polling restores the exact session buffer target rather than the old global threshold', () => {
  assert.equal(sessionStartupTarget({startupTargetSeconds:8},12),8);
  assert.equal(sessionStartupTarget({startupTargetSeconds:7},4),7);
  for (const value of [undefined, NaN, 0, -1]) assert.equal(sessionStartupTarget({startupTargetSeconds:value},12),12);
});

test('a fast first playlist with an eight-second GOP does not pay for a second GOP', () => {
  const firstPlaylist={...base,initialDuration:8.008,bufferedSeconds:8.008,elapsedMs:0};
  assert.equal(startupTarget({...firstPlaylist,writerElapsedMs:2500}),8);
  assert.equal(startupTarget({...firstPlaylist,writerElapsedMs:8000}),12,'slow writer retains the larger cushion');
  for(const writerElapsedMs of [null,NaN,0,-1,100]) {
    assert.equal(startupTarget({...firstPlaylist,writerElapsedMs}),12,'no invented speed from an invalid/too-short sample');
  }
  assert.equal(startupTarget({...firstPlaylist,writerElapsedMs:2500,bufferedSeconds:4}),12,'cannot skip the minimum buffer');
  assert.equal(startupTarget({...firstPlaylist,writerElapsedMs:2500,seeking:true,minimumSeconds:11}),11,'seek coverage remains intact');
});

test('variable-length source GOPs can start at a verified fast floor, consistently with serving', () => {
  const sample={defaultMinimum:8,bufferedSeconds:5.672,writerElapsedMs:2500,seeking:false};
  const minimum=initialStartupFloor(sample);
  assert.equal(minimum,4);
  const target=startupTarget({configuredSeconds:12,minimumSeconds:minimum,
    initialDuration:5.672,bufferedSeconds:5.672,elapsedMs:0,writerElapsedMs:2500});
  assert.equal(target,4);
  const floor=sessionPlaylistFloor({startupTargetSeconds:target},8);
  assert.equal(floor,4);
  assert.equal(hasPlayableBuffer({exists:true,duration:5.672,ended:false},floor),true,'no 409 after resolve says ready');
  assert.equal(initialStartupFloor({...sample,bufferedSeconds:3.9}),8);
  assert.equal(initialStartupFloor({...sample,writerElapsedMs:4000}),8,'insufficient speed sample retains cushion');
  assert.equal(initialStartupFloor({...sample,seeking:true}),8,'seek coverage is never reduced');
  for(const startupTargetSeconds of [undefined,NaN,0,-1]) assert.equal(sessionPlaylistFloor({startupTargetSeconds},8),8);
});

test('a complete short tail is playable, while an incomplete or empty playlist is held', () => {
  assert.equal(hasPlayableBuffer({exists:true,duration:3,ended:true},8),true);
  assert.equal(hasPlayableBuffer({exists:true,duration:3,ended:false},8),false);
  assert.equal(hasPlayableBuffer({exists:true,duration:0,ended:true},8),false);
  assert.equal(hasPlayableBuffer({exists:false,duration:10,ended:false},8),false);
});
