import assert from 'node:assert/strict';
import {
  isResolveId,
  setResolveStage,
  getResolveStage,
  clearResolveStages,
  RESOLVE_STAGE_TTL_MS,
} from '../services/playback/resolveProgress.js';

clearResolveStages();

// IDs are validated loosely: long enough to be unguessable, strict charset.
assert.equal(isResolveId('r-8f3ka9x2-qwerty12'), true);
assert.equal(isResolveId('short'), false);
assert.equal(isResolveId('has space'), false);
assert.equal(isResolveId('semi;colon'), false);
assert.equal(isResolveId(''), false);
assert.equal(isResolveId(null), false);
assert.equal(isResolveId(undefined), false);
console.log('ok - resolve ids validated');

// Unknown ids read as null, never throw.
assert.equal(getResolveStage('r-doesnotexist-00000000'), null);
assert.equal(getResolveStage('junk'), null);

// Set then read round-trips stage + detail (+ append-only history).
assert.equal(setResolveStage('r-roundtrip-00000001', 'probe'), true);
assert.equal(getResolveStage('r-roundtrip-00000001').stage, 'probe');
assert.equal(getResolveStage('r-roundtrip-00000001').detail, '');
assert.equal(setResolveStage('r-roundtrip-00000001', 'prepare', '2/5'), true);
assert.equal(getResolveStage('r-roundtrip-00000001').detail, '2/5');
assert.deepEqual(
  getResolveStage('r-roundtrip-00000001').history.map((h) => h.stage),
  ['probe', 'prepare'],
);
console.log('ok - resolve stage set/read round-trips');

// Empty stage and junk ids never write.
assert.equal(setResolveStage('r-roundtrip-00000002', ''), false);
assert.equal(setResolveStage('junk', 'probe'), false);
assert.equal(getResolveStage('r-roundtrip-00000002'), null);

// Stale entries rot instead of lingering.
assert.equal(setResolveStage('r-stale-entry-00000003', 'buffer'), true);
assert.equal(
  getResolveStage('r-stale-entry-00000003', Date.now() + RESOLVE_STAGE_TTL_MS + 1000),
  null,
);
assert.equal(getResolveStage('r-stale-entry-00000003'), null);
console.log('ok - stale resolve stages expire');

// The map is capped so abandoned polls cannot grow memory.
clearResolveStages();
for (let i = 0; i < 600; i++) {
  setResolveStage(`r-cap-probe-${String(i).padStart(6, '0')}`, 'rank');
}
assert.equal(getResolveStage('r-cap-probe-000000'), null);
assert.equal(getResolveStage('r-cap-probe-000599')?.stage, 'rank');
console.log('ok - resolve stage map capped');
