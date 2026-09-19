import assert from 'node:assert/strict';
import {
  computeWriteSpeed,
  SLOW_WRITER_MIN_OBSERVE_MS,
  SLOW_WRITER_MIN_SPEED,
} from '../services/playback/remuxService.js';

// Healthy writer: ~2x realtime over a minute.
assert.deepEqual(
  computeWriteSpeed({ startedAtMs: 0, bufferedSeconds: 120, nowMs: 60_000 }),
  { elapsedMs: 60_000, bufferedSeconds: 120, speed: 2 },
);

// Coyote-class dribble: 4 minutes of playlist after 5+ minutes of wall time.
const slow = computeWriteSpeed({ startedAtMs: 0, bufferedSeconds: 240, nowMs: 320_000 });
assert.ok(slow && slow.speed < SLOW_WRITER_MIN_SPEED);
assert.ok(slow.elapsedMs >= SLOW_WRITER_MIN_OBSERVE_MS);
console.log('ok - slow writer measured below the failover floor');

// Unmeasurable inputs never arm the gate.
assert.equal(
  computeWriteSpeed({ startedAtMs: NaN, bufferedSeconds: 10, nowMs: 60_000 }),
  null,
);
assert.equal(
  computeWriteSpeed({ startedAtMs: 0, bufferedSeconds: 10, nowMs: 0 }),
  null,
);
assert.equal(
  computeWriteSpeed({ startedAtMs: 0, bufferedSeconds: -1, nowMs: 60_000 }),
  null,
);
console.log('ok - unmeasurable writers skip the gate');

// Gate constants are sane: observe well past ffmpeg startup, demand ~realtime.
assert.ok(SLOW_WRITER_MIN_OBSERVE_MS >= 30_000);
assert.ok(SLOW_WRITER_MIN_SPEED > 0.5 && SLOW_WRITER_MIN_SPEED < 1);
console.log('ok - failover thresholds sane');
