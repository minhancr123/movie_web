/**
 * Group C: a disabled video-transcode policy must block EVERY video-encode
 * path while leaving copy-video + audio-encode alone.
 *
 * Repro that motivated this file (plan §C):
 *   MP4 / H.264 / AAC / 1080p / 10 Mbps, VIDEO_TRANSCODE_FALLBACK=never,
 *   remote client → delivery said transcode → direct was forced into a
 *   remux with videoCopy=false. A direct upstream URL costs the VPS no
 *   egress, so the ladder/egress budget must never push it into an encode.
 *
 * Env note: TRANSCODE_ROOT is set BEFORE the service import below, because
 * the service reads it once at module load. The policy throw happens before
 * any spawn, so this test never executes ffmpeg.
 *
 * Run: node tests/video-transcode-policy-guard.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const OLD_FALLBACK = process.env.VIDEO_TRANSCODE_FALLBACK;
const OLD_ROOT = process.env.TRANSCODE_ROOT;
const sandbox = mkdtempSync(path.join(tmpdir(), 'policy-guard-'));
process.env.VIDEO_TRANSCODE_FALLBACK = 'never';
process.env.TRANSCODE_ROOT = sandbox;

const {
  decidePlaybackMode,
  resolveVideoTranscodeCapability,
  startRemuxSession,
  assertVideoTranscodeAllowed,
  planCandidateDelivery,
  isHevcMain10,
  VideoTranscodeForbiddenError,
} = await import('../services/playback/remuxService.js');
const { planDelivery, planAdmission } = await import('../services/playback/deliveryPlan.js');
const { normalizeCapabilities } = await import('../services/playback/sourceRanker.js');

/* ------------------------------------------- 1. compatible file → direct */

const mp4Probe = {
  format: 'mov,mp4,m4a,3gp,3g2,mj2',
  video: { codec: 'h264', width: 1920, height: 1080, frameRate: 23.976, pixFmt: 'yuv420p' },
  audio: [{ index: 1, streamIndex: 0, codec: 'aac', channels: 2, language: 'eng' }],
  bitrate: 10_000_000,
};
const REMOTE_CAPS = { hevc: false, av1: false, hdr: false, maxHeight: 1080 };

const direct = decidePlaybackMode(mp4Probe, REMOTE_CAPS, null, {
  videoTranscode: { allowed: false, hardware: false },
});
assert.equal(direct.mode, 'direct', 'browser-safe MP4 stays direct under a disabled policy');

/* ------------------------- 2. audio-only work still allowed (pure plan) */

const mkvDtsProbe = {
  format: 'matroska,webm',
  video: { codec: 'h264', width: 1920, height: 1080, frameRate: 23.976, pixFmt: 'yuv420p' },
  audio: [{ index: 1, streamIndex: 1, codec: 'dts', channels: 6, language: 'eng' }],
};
const mkvDecision = decidePlaybackMode(mkvDtsProbe, REMOTE_CAPS, null, {
  videoTranscode: { allowed: false, hardware: false },
});
assert.equal(mkvDecision.mode, 'remux', 'DTS source still remuxes');
assert.equal(mkvDecision.videoCopy, true, 'video stays copy');
assert.equal(mkvDecision.audioCopy, false, 'audio still encodes to AAC');

/* ---------------------------------- 3. unsupported codec rejects cleanly */

const hevcProbe = {
  format: 'matroska,webm',
  video: { codec: 'hevc', width: 1920, height: 1080, frameRate: 23.976, pixFmt: 'yuv420p' },
  audio: [{ index: 1, streamIndex: 1, codec: 'aac', channels: 2, language: 'eng' }],
};
const hevcDecision = decidePlaybackMode(hevcProbe, REMOTE_CAPS, null, {
  videoTranscode: { allowed: false, hardware: false },
});
assert.equal(hevcDecision.mode, 'reject', 'HEVC with no decoder and no policy rejects instead of encoding');

/* ------------------------------- 4. ladder never promises an encode when
   the policy forbids it; admission refuses honestly instead */

const overRung = planDelivery({ lan: false, sourceHeight: 1080, sourceKbps: 10000, canTranscode: false });
assert.equal(overRung.mode, 'remux', 'ladder keeps remux shape when transcode is off');
assert.equal(overRung.kbps, 10000, 'source bitrate kept, not a rung promise');

const admitted = planAdmission({
  activeKbps: 0, lan: false, sourceHeight: 1080, sourceKbps: 10000,
  budgetKbps: 25000, canTranscode: false,
});
assert.equal(admitted.admitted, true, 'fits the uplink: admitted at source rate');
assert.equal(admitted.mode, 'remux', 'admitted as remux, never transcode');

const refused = planAdmission({
  activeKbps: 20000, lan: false, sourceHeight: 1080, sourceKbps: 10000,
  budgetKbps: 25000, canTranscode: false,
});
assert.equal(refused.admitted, false, 'over budget with no transcode: honest refusal');
assert.equal(refused.mode, 'reject', 'refusal carries reject mode, not a transcode promise');

// Default stays backward compatible for existing callers/tests.
const legacy = planDelivery({ lan: false, sourceHeight: 1080, sourceKbps: 10000 });
assert.equal(legacy.mode, 'transcode', 'default keeps the old ladder behaviour');

/* --------------------------------------- 5. spawn guard fails closed */

const capability = await resolveVideoTranscodeCapability();
assert.equal(capability.allowed, false, 'never policy resolves to disallowed');

// The extracted gate, both directions, with no process ever spawned.
await assert.rejects(
  assertVideoTranscodeAllowed({ mode: 'transcode', height: 1080, kbps: 6000 }),
  (error) => error instanceof VideoTranscodeForbiddenError && error.code === 'VIDEO_TRANSCODE_FORBIDDEN',
  'transcode request throws the policy error',
);
await assertVideoTranscodeAllowed(null);
await assertVideoTranscodeAllowed({ mode: 'copy' });
console.log('ok - policy gate allows copy/audio work, throws on video transcode');

// End to end through startRemuxSession: throws before directories, slot
// checks, or any spawn — the sandbox stays empty.
let threw = null;
try {
  await startRemuxSession({
    sessionId: 'policy-guard-probe',
    inputUrl: 'http://127.0.0.1:9/nope.mkv',
    video: { mode: 'transcode', height: 1080, kbps: 6000 },
  });
} catch (error) {
  threw = error;
}
assert.ok(threw instanceof VideoTranscodeForbiddenError, 'transcode spawn throws the policy error');
assert.deepEqual(readdirSync(sandbox), [], 'forbidden spawn creates no session directory');

/* ----------------- 6. coordination: decide first, admit second (the two
   misses the split-function tests could not see) */

// Repro 1: MP4/H264/AAC 10 Mbps direct while the box serves 20/25 Mbps of
// remux — the budget must not refuse a file that costs it nothing.
{
  const out = planCandidateDelivery({
    probe: mp4Probe,
    caps: REMOTE_CAPS,
    videoTranscode: { allowed: false, hardware: false },
    lan: false,
    activeKbps: 20000,
    budgetKbps: 25000,
  });
  assert.equal(out.rejected, undefined, 'busy box does not reject a direct file');
  assert.equal(out.decision.mode, 'direct', 'still direct');
  assert.equal(out.delivery.admitted, true, 'direct skips the egress budget');
}

// Repro 2: a 30 Mbps direct file on an idle box is not "over budget".
{
  const big = { ...mp4Probe, bitrate: 30_000_000 };
  const out = planCandidateDelivery({
    probe: big,
    caps: REMOTE_CAPS,
    videoTranscode: { allowed: false, hardware: false },
    lan: false,
    activeKbps: 0,
    budgetKbps: 25000,
  });
  assert.equal(out.decision.mode, 'direct', 'still direct at 30 Mbps');
  assert.equal(out.delivery.admitted, true, 'admitted without consulting the budget');
}

// Policy reject keeps status + code for the exhausted answer (422 + code,
// not a retryable-looking 502 without one)...
{
  const out = planCandidateDelivery({
    probe: hevcProbe,
    caps: REMOTE_CAPS,
    videoTranscode: { allowed: false, hardware: false },
    lan: false,
    activeKbps: 0,
    budgetKbps: 25000,
  });
  assert.ok(out.rejected instanceof VideoTranscodeForbiddenError, 'policy reject is typed');
  assert.equal(out.rejected.status, 422, 'typed reject carries 422');
  assert.equal(out.rejected.code, 'VIDEO_TRANSCODE_FORBIDDEN', 'typed reject carries its code');
}

// ...while a non-policy codec reject (4K target on software, which never
// reaches realtime even when allowed) stays a plain error — never
// mislabelled as a policy refusal.
{
  const huge = {
    ...hevcProbe,
    video: { ...hevcProbe.video, width: 3840, height: 2160, pixFmt: 'yuv420p10le' },
  };
  const bigScreenCaps = { hevc: false, av1: false, hdr: true, maxHeight: 2160 };
  const out = planCandidateDelivery({
    probe: huge,
    caps: bigScreenCaps,
    videoTranscode: { allowed: true, hardware: false },
    lan: false,
    activeKbps: 0,
    budgetKbps: 25000,
  });
  assert.ok(out.rejected instanceof Error, 'oversized software transcode still rejects');
  assert.ok(
    !(out.rejected instanceof VideoTranscodeForbiddenError),
    '...but not as a policy refusal',
  );
}
console.log('ok - coordination: direct skips the budget, rejects keep their type');

/* ----------------- 7. HEVC Main 10 routes separately from Main profile
   (Devil May Cry class: an 8-bit-only decoder served a Main 10 copy dies
   with MEDIA_ERROR after a successful remux) */

const main10Probe = {
  format: 'matroska,webm',
  video: {
    codec: 'hevc', profile: 'Main 10', width: 1920, height: 1080,
    frameRate: 23.976, pixFmt: 'yuv420p10le',
  },
  audio: [{ index: 1, streamIndex: 1, codec: 'aac', channels: 2, language: 'eng' }],
};
assert.equal(isHevcMain10(main10Probe.video), true, 'profile tag detects Main 10');
assert.equal(
  isHevcMain10({ codec: 'hevc', pixFmt: 'yuv420p10le' }),
  true,
  '10-bit pixfmt detects Main 10 without a profile tag',
);
assert.equal(isHevcMain10({ codec: 'hevc', pixFmt: 'yuv420p' }), false, '8-bit HEVC is not Main 10');
assert.equal(isHevcMain10({ codec: 'h264', pixFmt: 'yuv420p10le' }), false, '10-bit H.264 is not HEVC Main 10');
assert.equal(isHevcMain10({ codec: 'hevc', profile: 'Main 12', pixFmt: 'yuv420p12le' }), true, '12-bit rarity routes with Main 10');

// Old clients send no hevcMain10: inherit `hevc`, behaviour unchanged.
assert.equal(normalizeCapabilities({ hevc: true }).hevcMain10, true, 'old client inherits hevc');
assert.equal(
  normalizeCapabilities({ hevc: true, hevcMain10: false }).hevcMain10,
  false,
  'explicit Main 10 incapability survives normalization',
);

// 8-bit-capable but Main-10-incapable client, policy off: typed reject with
// a Main-10-specific reason (→ 422 + code at the exhausted answer).
{
  const caps = { ...REMOTE_CAPS, hevc: true, hevcMain10: false };
  const out = planCandidateDelivery({
    probe: main10Probe,
    caps,
    videoTranscode: { allowed: false, hardware: false },
    lan: false,
    activeKbps: 0,
    budgetKbps: 25000,
  });
  assert.ok(out.rejected instanceof VideoTranscodeForbiddenError, 'Main 10 reject is typed');
  assert.match(out.rejected.message, /Main 10/, 'reason names Main 10, not generic HEVC');
}

// Same client, policy on: server transcodes instead of rejecting.
{
  const caps = { ...REMOTE_CAPS, hevc: true, hevcMain10: false };
  const d = decidePlaybackMode(main10Probe, caps, null, {
    videoTranscode: { allowed: true, hardware: false },
  });
  assert.equal(d.mode, 'remux', 'policy-on transcodes Main 10 for the client');
  assert.equal(d.videoCopy, false, 'video re-encodes');
}

// Old client behaviour preserved: hevc:true with no Main 10 signal still
// gets the copy it always got (e.g. Apple Silicon plays it fine).
{
  const caps = normalizeCapabilities({ hevc: true });
  const mp4Main10 = {
    format: 'mov,mp4,m4a,3gp,3g2,mj2',
    video: { codec: 'hevc', profile: 'Main 10', width: 1920, height: 1080, frameRate: 23.976, pixFmt: 'yuv420p10le' },
    audio: [{ index: 1, streamIndex: 0, codec: 'aac', channels: 2, language: 'eng' }],
  };
  const d = decidePlaybackMode(mp4Main10, caps, null, {
    videoTranscode: { allowed: false, hardware: false },
  });
  assert.equal(d.mode, 'direct', 'old client keeps its Main 10 direct play');
}
console.log('ok - HEVC Main 10 routes separately from 8-bit HEVC');

if (OLD_FALLBACK === undefined) delete process.env.VIDEO_TRANSCODE_FALLBACK;
else process.env.VIDEO_TRANSCODE_FALLBACK = OLD_FALLBACK;
if (OLD_ROOT === undefined) delete process.env.TRANSCODE_ROOT;
else process.env.TRANSCODE_ROOT = OLD_ROOT;
rmSync(sandbox, { recursive: true, force: true });

console.log('ok - disabled policy keeps direct, allows copy+audio-encode, blocks every video encode');
