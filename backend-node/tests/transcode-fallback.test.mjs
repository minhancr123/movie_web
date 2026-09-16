/**
 * Codec-transcode fallback (HEVC/AV1 the client cannot decode -> server AVC).
 *
 * Without this, every 4K HEVC release is rejected outright on browsers that
 * report hevc:false (most desktop Chrome/Edge/Firefox), even though the
 * server could re-encode it on the fly. The policy stays conservative:
 * software transcode above 1080p never reaches realtime, so those still
 * reject instead of trading a clear message for endless buffering.
 */
import assert from 'node:assert/strict';
import {
  decidePlaybackMode,
  buildVideoArgs,
  isHdrVideo,
  isTenBitVideo,
  transcodeKbpsForHeight,
  planCodecTranscode,
  getVideoTranscodePolicy,
  resolveVideoTranscodeCapability,
  __setEncoderForTests,
} from '../services/playback/remuxService.js';
import { scoreCandidate } from '../services/playback/sourceRanker.js';

const NO_HEVC_CAPS = { hevc: false, av1: false, hdr: false, maxHeight: 1080 };
const HEVC_CAPS = { hevc: true, av1: true, hdr: true, maxHeight: 2160 };
const SW = { allowed: true, hardware: false };
const HW = { allowed: true, hardware: true };
const OFF = { allowed: false, hardware: false };

const hevcProbe = (overrides = {}) => ({
  format: 'matroska,webm',
  video: {
    codec: 'hevc',
    profile: 'Main 10',
    width: 3840,
    height: 2160,
    frameRate: 23.976,
    pixFmt: 'yuv420p10le',
    colorTransfer: 'smpte2084',
    colorPrimaries: 'bt2020',
    ...overrides,
  },
  audio: [{ index: 1, streamIndex: 1, codec: 'dts', channels: 6, language: 'eng' }],
});

/* ------------------------------------------------------- HDR detection */

assert.equal(isHdrVideo({ colorTransfer: 'smpte2084' }), true, 'PQ transfer is HDR');
assert.equal(isHdrVideo({ colorTransfer: 'arib-std-b67' }), true, 'HLG transfer is HDR');
assert.equal(isHdrVideo({ colorPrimaries: 'bt2020' }), true, 'BT.2020 primaries is HDR');
assert.equal(isHdrVideo({ colorTransfer: 'bt709', colorPrimaries: 'bt709' }), false, 'SDR stays SDR');
assert.equal(isHdrVideo({}), false, 'missing tags are not HDR');
assert.equal(isTenBitVideo({ pixFmt: 'yuv420p10le' }), true, '10-bit detected');
assert.equal(isTenBitVideo({ pixFmt: 'yuv420p' }), false, '8-bit is not 10-bit');
console.log('ok - HDR / 10-bit detection off ffprobe fields');

/* ------------------------------------------------------- transcode plan */

const plan1080 = planCodecTranscode(hevcProbe(), NO_HEVC_CAPS, SW);
assert.deepEqual(
  { mode: plan1080.mode, height: plan1080.height, tonemap: plan1080.tonemap, tenBit: plan1080.tenBit },
  { mode: 'transcode', height: 1080, tonemap: true, tenBit: true },
  '4K HDR source for a 1080p SDR client plans 1080p tonemapped 8-bit',
);
assert.ok(plan1080.kbps >= 4000, 'transcode rung carries real bandwidth');

// Software cannot do 4K in realtime: still unservable.
assert.equal(
  planCodecTranscode(hevcProbe(), { ...NO_HEVC_CAPS, maxHeight: 2160 }, SW),
  null,
  'software 4K transcode stays impossible',
);
const plan2160 = planCodecTranscode(hevcProbe(), { ...NO_HEVC_CAPS, maxHeight: 2160 }, HW);
assert.equal(plan2160?.height, 2160, 'hardware may keep full 4K');

const sdrPlan = planCodecTranscode(
  hevcProbe({ colorTransfer: 'bt709', colorPrimaries: 'bt709', pixFmt: 'yuv420p' }),
  NO_HEVC_CAPS,
  SW,
);
assert.equal(sdrPlan.tonemap, false, 'SDR needs no tonemap');
assert.equal(sdrPlan.tenBit, false, '8-bit needs no downshift');
console.log('ok - codec-transcode plan sizes height/bandwidth/tonemap correctly');

/* ------------------------------------------------------- decidePlaybackMode */

// Old behaviour is the default: no opts, no fallback.
const legacy = decidePlaybackMode(hevcProbe(), NO_HEVC_CAPS);
assert.equal(legacy.mode, 'reject');
assert.match(legacy.reason, /không giải mã được HEVC/);

// Explicitly disabled also rejects.
const disabled = decidePlaybackMode(hevcProbe(), NO_HEVC_CAPS, null, { videoTranscode: OFF });
assert.equal(disabled.mode, 'reject');

// Allowed on software for a 1080p client: remux carrying a transcode plan.
const t1080 = decidePlaybackMode(hevcProbe(), NO_HEVC_CAPS, null, { videoTranscode: SW });
assert.equal(t1080.mode, 'remux', 'HEVC becomes servable via transcode');
assert.equal(t1080.videoTranscode?.mode, 'transcode');
assert.equal(t1080.videoTranscode?.height, 1080);
assert.equal(t1080.videoTranscode?.tonemap, true, 'HDR flag survives into the ffmpeg plan');
assert.equal(t1080.audioCopy, false, 'audio still folds to AAC');
assert.match(t1080.reason, /transcode sang AVC/);

// 4K client, software encoder: honest rejection, not a doomed transcode.
const t4kSw = decidePlaybackMode(
  hevcProbe(), { ...NO_HEVC_CAPS, maxHeight: 2160 }, null, { videoTranscode: SW },
);
assert.equal(t4kSw.mode, 'reject');

// 4K client, hardware encoder: full-res transcode.
const t4kHw = decidePlaybackMode(
  hevcProbe(), { ...NO_HEVC_CAPS, maxHeight: 2160 }, null, { videoTranscode: HW },
);
assert.equal(t4kHw.mode, 'remux');
assert.equal(t4kHw.videoTranscode?.height, 2160);

// AV1 follows the same rule; native-capable clients are untouched.
const av1 = decidePlaybackMode(
  hevcProbe({ codec: 'av1' }), NO_HEVC_CAPS, null, { videoTranscode: SW },
);
assert.equal(av1.mode, 'remux');
assert.match(av1.reason, /AV1.*transcode sang AVC/);
const native = decidePlaybackMode(hevcProbe(), HEVC_CAPS, null, { videoTranscode: HW });
assert.equal(native.mode, 'remux');
assert.equal(native.videoTranscode, undefined, 'native playback never transcodes');
console.log('ok - decidePlaybackMode routes incompatible codecs into transcode');

/* ------------------------------------------------------- ffmpeg args */

const vfOf = (result) => result.output[result.output.indexOf('-vf') + 1];
const swTonemap = buildVideoArgs(
  { mode: 'transcode', height: 1080, kbps: 8000, tonemap: true }, { encoder: 'libx264', hardware: false },
);
assert.match(vfOf(swTonemap), /tonemap=/, 'software HDR chain tonemaps');
assert.match(vfOf(swTonemap), /format=yuv420p$/, 'software chain ends on 8-bit');
const swSdr = buildVideoArgs(
  { mode: 'transcode', height: 1080, kbps: 8000 }, { encoder: 'libx264', hardware: false },
);
assert.doesNotMatch(vfOf(swSdr), /tonemap=/, 'SDR skips the tonemap');
const hwTonemap = buildVideoArgs(
  { mode: 'transcode', height: 2160, kbps: 20000, tonemap: true, tenBit: true },
  { encoder: 'h264_nvenc', hardware: true },
);
assert.match(vfOf(hwTonemap), /scale_cuda/, 'GPU path keeps CUDA scaling');
assert.match(vfOf(hwTonemap), /hwdownload.*tonemap=.*hwupload_cuda/, 'GPU tonemap round-trips through system memory');
const hwSdr8 = buildVideoArgs(
  { mode: 'transcode', height: 1080, kbps: 8000 }, { encoder: 'h264_nvenc', hardware: true },
);
assert.equal(vfOf(hwSdr8), 'scale_cuda=-2:1080', 'plain 8-bit SDR keeps the zero-copy path');
const copy = buildVideoArgs(null, { encoder: 'h264_nvenc', hardware: true });
assert.deepEqual(copy.output, ['-c:v', 'copy'], 'non-transcode still copies');
console.log('ok - ffmpeg filter chains tonemap HDR and keep fast paths fast');

/* ------------------------------------------------------- ranker gating */

const hevcCandidate = {
  infoHash: 'c'.repeat(40),
  label: 'The.End.of.Oak.Street.2026.2160p.WEB-DL.HEVC 12GB',
  codec: 'hevc',
  resolution: 2160,
  seeds: 921,
  sizeBytes: 12e9,
};
const gated = scoreCandidate(hevcCandidate, NO_HEVC_CAPS, { runtimeMinutes: 100 });
assert.equal(gated.playable, false, 'no fallback configured: still rejected');
const fallback1080 = scoreCandidate(hevcCandidate, NO_HEVC_CAPS, { runtimeMinutes: 100, videoTranscode: SW });
assert.equal(fallback1080.playable, true, 'server transcode makes HEVC offerable');
assert.ok(
  fallback1080.reasons.some((r) => /transcode HEVC→AVC 1080p/.test(r)),
  'picker explains the transcode downgrade',
);
const scoredBest = scoreCandidate(
  { ...hevcCandidate, codec: 'h264' }, NO_HEVC_CAPS, { runtimeMinutes: 100, videoTranscode: SW },
);
assert.ok(scoredBest.score > fallback1080.score, 'native AVC still outranks transcoded HEVC');
const sw4k = scoreCandidate(
  hevcCandidate, { ...NO_HEVC_CAPS, maxHeight: 2160 }, { runtimeMinutes: 100, videoTranscode: SW },
);
assert.equal(sw4k.playable, false, 'software 4K transcode stays rejected in the picker too');
const hw4k = scoreCandidate(
  hevcCandidate, { ...NO_HEVC_CAPS, maxHeight: 2160 }, { runtimeMinutes: 100, videoTranscode: HW },
);
assert.equal(hw4k.playable, true, 'hardware 4K transcode is offerable');
console.log('ok - ranker offers transcodable HEVC below native, rejects the rest');

/* ------------------------------------------------------- policy */

const savedEnv = process.env.VIDEO_TRANSCODE_FALLBACK;
// Warmed detection cache: no ffmpeg spawn, deterministic in the suite.
__setEncoderForTests({ encoder: 'h264_nvenc', hardware: true });
try {
  delete process.env.VIDEO_TRANSCODE_FALLBACK;
  assert.equal(getVideoTranscodePolicy().mode, 'auto', 'default policy is auto');
  process.env.VIDEO_TRANSCODE_FALLBACK = '1';
  assert.equal(getVideoTranscodePolicy().mode, 'always');
  process.env.VIDEO_TRANSCODE_FALLBACK = '0';
  assert.equal(getVideoTranscodePolicy().mode, 'never');

  // Detection is cached: no ffmpeg spawn, deterministic in the suite.
  process.env.VIDEO_TRANSCODE_FALLBACK = 'auto';
  assert.deepEqual(await resolveVideoTranscodeCapability(), { allowed: true, hardware: true });
  process.env.VIDEO_TRANSCODE_FALLBACK = '0';
  assert.deepEqual(await resolveVideoTranscodeCapability(), { allowed: false, hardware: false });
  __setEncoderForTests({ encoder: 'libx264', hardware: false });
  process.env.VIDEO_TRANSCODE_FALLBACK = 'auto';
  assert.deepEqual(await resolveVideoTranscodeCapability(), { allowed: false, hardware: false });
  process.env.VIDEO_TRANSCODE_FALLBACK = '1';
  assert.deepEqual(await resolveVideoTranscodeCapability(), { allowed: true, hardware: false });
} finally {
  __setEncoderForTests(null);
  if (savedEnv === undefined) delete process.env.VIDEO_TRANSCODE_FALLBACK;
  else process.env.VIDEO_TRANSCODE_FALLBACK = savedEnv;
}
assert.equal(transcodeKbpsForHeight(2160), 20000);
assert.equal(transcodeKbpsForHeight(1080), 8000);
console.log('ok - VIDEO_TRANSCODE_FALLBACK policy matrix (auto/always/never × hw/sw)');
