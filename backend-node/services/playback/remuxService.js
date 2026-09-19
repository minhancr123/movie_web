import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

// Must stay absolute: res.sendFile() rejects relative paths, and ffmpeg's
// -hls_fmp4_init_filename is resolved against the playlist's directory.
const TRANSCODE_ROOT = path.resolve(
  process.env.TRANSCODE_ROOT || path.join(process.cwd(), 'tmp', 'transcodes')
);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';
const PROBE_TIMEOUT_MS = 8000;
const PLAYLIST_TIMEOUT_MS = 30000;
const GB = 1024 ** 3;

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CACHE_MAX_BYTES = positiveNumber(process.env.TRANSCODE_CACHE_MAX_GB, 25) * GB;
const CACHE_TTL_MS = positiveNumber(process.env.TRANSCODE_CACHE_TTL_HOURS, 2) * 60 * 60 * 1000;
const LIVE_IDLE_MS = positiveNumber(process.env.TRANSCODE_LIVE_IDLE_MINUTES, 10) * 60 * 1000;
const INCOMPLETE_GRACE_MS = positiveNumber(process.env.TRANSCODE_INCOMPLETE_GRACE_MINUTES, 10) * 60 * 1000;
const CLEANUP_INTERVAL_MS = positiveNumber(process.env.TRANSCODE_CLEANUP_INTERVAL_SECONDS, 60) * 1000;
const VIEWER_GRACE_MS = positiveNumber(process.env.TRANSCODE_VIEWER_GRACE_SECONDS, 120) * 1000;
const ACCESS_TOUCH_INTERVAL_MS = 30 * 1000;

/** HLS segment length. Shared with the rendition identity: same bytes need the same id. */
/**
 * RETIRED in build 7 (export kept so old test files still import): the name
 * the build-6 in-process sidecar used. Plain mp4 only gets its moov trailer
 * when the whole ffmpeg process exits, so the file was never readable at
 * resolve time — only after the film finished remuxing.
 */
export const SEEK_ORIGIN_FILE = 'origin.mp4';

export const REMUX_SEGMENT_SECONDS = 4;
const MAX_BROWSER_FRAME_RATE = 60.01;

const sessions = new Map();
let cleanupTimer = null;

const safeId = (value) => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** ffprobe rational ("60000/1001") or numeric value -> frames per second. */
export const parseFrameRate = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
  const raw = String(value || '').trim();
  if (!raw) return null;
  const [numeratorRaw, denominatorRaw] = raw.split('/');
  const numerator = Number(numeratorRaw);
  const denominator = denominatorRaw === undefined ? 1 : Number(denominatorRaw);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
};

/**
 * Decide whether an incomplete HLS playlist still has a writer behind it.
 * A known child that exited is dead immediately. After a Node restart the
 * in-memory child map is empty, so an orphan is reusable only when its
 * playlist is observably growing; merely being "recent" is not enough.
 */
export const shouldReuseRemuxSession = ({
  playlistComplete = false,
  hasLiveSession = false,
  liveExitCode,
  playlistFresh = false,
  playlistGrowing = false,
} = {}) => {
  if (playlistComplete) return true;
  // A child process can stay alive while its upstream socket is wedged. Reusing
  // that session reconnects the player to the same frozen playlist forever, so
  // an incomplete live session also needs recent or observable disk progress.
  if (hasLiveSession) {
    return liveExitCode === undefined && (playlistFresh || playlistGrowing);
  }
  return Boolean(playlistGrowing);
};

const run = (bin, args, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${bin} quá ${timeoutMs / 1000}s không phản hồi`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exit ${code}: ${stderr.slice(0, 600)}`));
    });
  });

const SUBS_TIMEOUT_MS = 120000;

const SUBS_ROOT = path.resolve(
  process.env.SUBS_ROOT || path.join(process.cwd(), 'tmp', 'subs')
);

/** Text codecs ffmpeg can convert to WebVTT (image subs like PGS/DVD need OCR). */
const CONVERTIBLE_SUB_CODECS = new Set([
  'subrip',
  'ass',
  'ssa',
  'mov_text',
  'webvtt',
  'subviewer',
]);

export const isConvertibleSubtitle = (codec) =>
  CONVERTIBLE_SUB_CODECS.has(String(codec || '').toLowerCase());

/**
 * Demux one embedded subtitle track to a WebVTT sidecar. No video/audio work,
 * so this finishes in seconds for text subs. Throws on image-based subs or
 * ffmpeg failure; callers decide whether to skip the track.
 */
export const extractSubtitleTrack = async (inputUrl, streamIndex, outPath) => {
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await run(
    FFMPEG_BIN,
    [
      '-hide_banner',
      '-loglevel',
      'warning',
      '-nostdin',
      '-i',
      inputUrl,
      '-map',
      `0:${Number(streamIndex)}`,
      '-c:s',
      'webvtt',
      '-f',
      'webvtt',
      '-y',
      outPath,
    ],
    { timeoutMs: SUBS_TIMEOUT_MS }
  );
  const stat = await fs.stat(outPath);
  if (!stat.size) {
    await fs.rm(outPath, { force: true });
    throw new Error('subtitle track rỗng sau khi trích');
  }
  return outPath;
};

export const subsPath = (...parts) => path.join(SUBS_ROOT, ...parts);

const SUBS_BATCH_TIMEOUT_MS = 300000;

/**
 * Extract MANY subtitle tracks in ONE ffmpeg pass. Each track used to get its
 * own process (each re-reading the whole remote file over HTTP), so 6 tracks
 * meant 6 full sequential scans. One demux pass feeds all outputs at once.
 * `jobs`: [{ streamIndex, outPath }]. Resolves per-output results; a single
 * bad track never fails the batch.
 */
export const extractSubtitleTracks = async (inputUrl, jobs) => {
  await fs.mkdir(SUBS_ROOT, { recursive: true });
  const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-i', inputUrl];
  for (const job of jobs) {
    args.push('-map', `0:${Number(job.streamIndex)}`, '-c:s', 'webvtt', '-f', 'webvtt', '-y', job.outPath);
  }
  await run(FFMPEG_BIN, args, { timeoutMs: SUBS_BATCH_TIMEOUT_MS });
  return Promise.all(
    jobs.map(async (job) => {
      try {
        const stat = await fs.stat(job.outPath);
        if (!stat.size) {
          await fs.rm(job.outPath, { force: true });
          return { ...job, ok: false };
        }
        return { ...job, ok: true };
      } catch {
        return { ...job, ok: false };
      }
    })
  );
};

export const ffprobe = async (inputUrl) => {
  const { stdout } = await run(
    FFPROBE_BIN,
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      inputUrl,
    ],
    { timeoutMs: PROBE_TIMEOUT_MS }
  );

  const data = JSON.parse(stdout);
  const streams = data.streams || [];
  const video = streams.find((stream) => stream.codec_type === 'video') || null;
  const audios = streams.filter((stream) => stream.codec_type === 'audio');
  const subtitles = streams.filter((stream) => stream.codec_type === 'subtitle');

  const startSec = (s) => {
    const v = Number(s?.start_time);
    return Number.isFinite(v) ? v : null;
  };
  return {
    format: data.format?.format_name || '',
    duration: Number(data.format?.duration || 0) || null,
    bitrate: Number(data.format?.bit_rate || 0) || null,
    video: video
      ? {
          codec: video.codec_name || '',
          profile: video.profile || '',
          level: video.level || null,
          width: video.width || null,
          height: video.height || null,
          frameRate: parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate),
          frameRateR: parseFrameRate(video.r_frame_rate),
          pixFmt: video.pix_fmt || '',
          colorTransfer: video.color_transfer || '',
          colorPrimaries: video.color_primaries || '',
          startTime: startSec(video),
          // Frames of decode-order reorder delay; drives presentationShiftMs.
          hasBFrames: Number.isFinite(Number(video.has_b_frames))
            ? Number(video.has_b_frames)
            : null,
        }
      : null,
    audio: audios.map((stream, index) => ({
      index,
      streamIndex: stream.index,
      codec: stream.codec_name || '',
      profile: stream.profile || '',
      channels: stream.channels || null,
      language: stream.tags?.language || '',
      title: stream.tags?.title || '',
      startTime: startSec(stream),
    })),
    subtitles: subtitles.map((stream) => ({
      streamIndex: stream.index,
      codec: stream.codec_name || '',
      language: stream.tags?.language || '',
    })),
  };
};

const isBrowserVideoCodec = (codec) => ['h264', 'hevc', 'av1', 'vp9'].includes(String(codec || '').toLowerCase());
const isBrowserAudioCodec = (codec, profile = null, channels = null) => {
  const c = String(codec || '').toLowerCase();
  if (c === 'mp3' || c === 'opus') return true;
  if (c === 'aac') {
    if (profile && !String(profile).toUpperCase().includes('LC')) return false;
    if (channels && Number(channels) > 2) return false;
    return true;
  }
  return false;
};
const isMp4Container = (format) => String(format || '').split(',').includes('mov') || String(format || '').includes('mp4');

export const decidePlaybackMode = (probe, caps = {}, preferredAudioIdx = null, opts = {}) => {
  if (!probe.video) {
    return { mode: 'reject', reason: 'Không tìm thấy video stream' };
  }

  const codec = probe.video.codec;
  if (!isBrowserVideoCodec(codec)) return { mode: 'reject', reason: `Không video-transcode codec ${codec}` };

  const frameRate = Number(probe.video.frameRate);
  if (Number.isFinite(frameRate) && frameRate > MAX_BROWSER_FRAME_RATE) {
    return {
      mode: 'reject',
      reason: `Video ${frameRate.toFixed(2)} fps vượt ngưỡng phát ổn định 60 fps của trình duyệt`,
    };
  }

  // Audio track choice: preferred ffprobe-order index, or default to English if available,
  // else first track. Out-of-range falls back to default.
  const audios = Array.isArray(probe.audio) ? probe.audio : [];
  let targetAudioIdx = 0;
  if (Number.isInteger(preferredAudioIdx) && audios[preferredAudioIdx]) {
    targetAudioIdx = preferredAudioIdx;
  } else {
    const englishIdx = audios.findIndex((a) =>
      /^(en|eng|english)$/i.test(String(a.language || '').trim())
    );
    targetAudioIdx = englishIdx >= 0 ? englishIdx : 0;
  }

  const audio = audios[targetAudioIdx] || null;
  const audioCopy = audio && isBrowserAudioCodec(audio.codec, audio.profile, audio.channels);
  const containerOk = isMp4Container(probe.format);

  // Codec the client cannot decode directly (HEVC/AV1 on most desktop
  // browsers): re-encode to AVC on the server instead of rejecting, when the
  // operator allows it (see VIDEO_TRANSCODE_FALLBACK). Without an allowed
  // fallback the old hard rejection stands — offering the source would mean
  // a black screen.
  const needsCodecTranscode =
    (codec === 'hevc' && !caps.hevc) || (codec === 'av1' && !caps.av1);
  if (needsCodecTranscode) {
    const capability = opts.videoTranscode || { allowed: false, hardware: false };
    const plan = capability.allowed ? planCodecTranscode(probe, caps, capability) : null;
    if (!plan) {
      return {
        mode: 'reject',
        reason: codec === 'hevc' ? 'Client không giải mã được HEVC' : 'Client không giải mã được AV1',
      };
    }
    return {
      mode: 'remux',
      reason: `${codec.toUpperCase()} không chạy trực tiếp trên client — server transcode sang AVC ${plan.height}p${plan.tonemap ? ', HDR chuyển về SDR' : ''}`,
      videoTranscode: plan,
      videoCopy: false,
      audioCopy: false,
      audioStreamIndex: audio ? audio.streamIndex : null,
      audioChannels: audio ? audio.channels : null,
      audioIndex: targetAudioIdx,
    };
  }

  if (containerOk && audioCopy && targetAudioIdx === 0) {
    return { mode: 'direct', reason: 'Container và codec đã phù hợp browser', audioStreamIndex: null, audioIndex: targetAudioIdx };
  }

  return {
    mode: 'remux',
    reason: `Remux video copy, audio ${audio?.codec || 'unknown'} -> AAC-LC`,
    videoCopy: true,
    // In HLS fMP4 remux, always transcode audio to standard AAC-LC stereo (-c:a aac -b:a 192k -ac 2).
    // Copying arbitrary source audio (e.g. AAC Main profile, HE-AAC, 5.1/7.1 channels) directly into fMP4
    // causes Chrome/MSE to reject the SourceBuffer or throw MEDIA_ERROR. Video remains copy (0% CPU).
    audioCopy: false,
    // Absolute ffprobe stream index so ffmpeg maps exactly this track.
    audioStreamIndex: audio ? audio.streamIndex : null,
    audioIndex: targetAudioIdx,
    // Drives the dialogue-forward fold; null when ffprobe did not report one.
    audioChannels: audio ? audio.channels : null,
  };
};

/**
 * Dialogue-forward 5.1 -> stereo fold.
 *
 * ffmpeg's default `-ac 2` normalises the centre channel to sit BELOW the front
 * L/R bed. Measured, not quoted: a tone on FC lands 10.6 dB down, the same tone
 * on FL lands 7.6 dB down, so dialogue starts 3.0 dB behind the music and
 * effects it competes with. On an action mix that is exactly backwards.
 *
 * These coefficients put the centre 4.7 dB ABOVE the fronts and 10.2 dB above
 * the surrounds -- a 7.7 dB swing in dialogue's favour against the default.
 *
 * The `aformat` pre-fold is not cosmetic. Applied straight to a 7.1 source this
 * matrix names only BL/BR, so SL/SR are discarded outright (measured at -91 dB,
 * i.e. gone). Folding 7.1 -> 5.1 first lets ffmpeg's own matrix merge the sides
 * into the backs; on real 5.1 it is a no-op.
 *
 * The limiter never engages on ordinary content: a hot -6 dBFS mix on all six
 * channels peaks at -4.2 dB. It is there for the pathological fully-correlated
 * case, where the coefficient sum of 1.23 would clip -- as ffmpeg's own default
 * already does at that input.
 *
 * LFE is left out, which is what the default does too.
 */
const DIALOGUE_DOWNMIX = [
  'aformat=channel_layouts=5.1',
  'pan=stereo|FL=0.65*FC+0.38*FL+0.20*BL|FR=0.65*FC+0.38*FR+0.20*BR',
  'alimiter=limit=0.95:level=disabled',
].join(',');

/**
 * Only genuine surround gets the fold. A stereo or mono source has no FC for
 * the matrix to reference and ffmpeg would fail the whole command; the odd
 * 3-5 channel layout is rare enough that plain `-ac 2` is the safer answer.
 * Unknown channel counts (null from ffprobe) fall through to `-ac 2` as well.
 */
const isSurroundLayout = (channels) => Number(channels) >= 6;


/**
 * How far the remux's clock runs ahead of the source's, in ms.
 *
 * An fMP4 timeline begins at the first DECODE timestamp. With B-frames the
 * first frame is presented `has_b_frames` frames after it is decoded, so
 * content sitting at source time T comes out at T + has_b_frames/fps. Audio
 * rides along by the same amount — lip sync is unaffected, which is why this
 * hid for so long — but subtitles are timed against the source, so they run
 * early by exactly this much unless the lookup subtracts it.
 *
 * Measured against fixtures: 2 B-frames at 24fps shifts 83ms, 4 shifts 167ms.
 * Returns 0 whenever the inputs cannot support an honest answer, so the client
 * falls back to no correction rather than an invented one.
 */
export const presentationShiftMs = (probe) => {
  const frames = Number(probe?.video?.hasBFrames);
  const fps = Number(probe?.video?.frameRate);
  if (!Number.isFinite(frames) || frames <= 0) return 0;
  if (!Number.isFinite(fps) || fps <= 0) return 0;
  // A reorder depth past one second is not a reorder depth; refuse it rather
  // than shove every subtitle somewhere arbitrary.
  const ms = Math.round((frames / fps) * 1000);
  return ms > 1000 ? 0 : ms;
};

/**
 * Which encoder is available, resolved once.
 *
 * Measured on an RTX 5070 against a 60 s 4K source: the full GPU path spends
 * 1.1 s of CPU where libx264 spends 53.7 s for the same work. That ratio is the
 * whole reason this exists — both finish faster than realtime on one stream,
 * but only one of them leaves the box able to serve anybody else.
 *
 * Deployments without a GPU fall back silently. A missing encoder must degrade
 * to software, never to a failed playback.
 */
let encoderCache = null;
export const detectVideoEncoder = async () => {
  if (encoderCache) return encoderCache;
  const forced = process.env.VIDEO_ENCODER;
  if (forced) {
    encoderCache = { encoder: forced, hardware: forced.includes('nvenc') };
    return encoderCache;
  }
  try {
    const { stdout } = await run(FFMPEG_BIN, ['-hide_banner', '-encoders'], { timeoutMs: 10000 });
    const hasNvenc = /h264_nvenc/.test(stdout);
    encoderCache = hasNvenc
      ? { encoder: 'h264_nvenc', hardware: true }
      : { encoder: 'libx264', hardware: false };
  } catch {
    encoderCache = { encoder: 'libx264', hardware: false };
  }
  console.log(`[playback] video encoder: ${encoderCache.encoder}${encoderCache.hardware ? ' (GPU)' : ' (CPU)'}`);
  return encoderCache;
};

/** Test seam: lets the suite exercise both branches without a GPU. */
export const __setEncoderForTests = (value) => { encoderCache = value; };

/**
 * Codec-transcode fallback policy (VIDEO_TRANSCODE_FALLBACK).
 *
 * Why this exists: most desktop browsers report hevc:false, so every 4K HEVC
 * release used to be rejected outright even though the server could have
 * re-encoded it to AVC on the fly. The policy decides when that fallback is
 * offered:
 *   - 'auto' (default): only with a hardware encoder. Software 4K transcode
 *     runs far below realtime and would trade a clear rejection for endless
 *     buffering, so it stays rejected.
 *   - '1'/'always': always offer it, even on libx264 (fine for small servers
 *     whose clients cap at 1080p, or operators who accept the CPU bill).
 *   - '0'/'never': previous behaviour — reject incompatible codecs outright.
 */
export const getVideoTranscodePolicy = () => {
  const raw = String(process.env.VIDEO_TRANSCODE_FALLBACK || 'auto').toLowerCase();
  const mode =
    raw === '1' || raw === 'true' || raw === 'always'
      ? 'always'
      : raw === '0' || raw === 'false' || raw === 'never'
        ? 'never'
        : 'auto';
  return { mode, hardware: encoderCache ? Boolean(encoderCache.hardware) : null };
};

/**
 * Async capability check for one resolve: warms the encoder detection (cached
 * after the first call) and folds it into the policy above.
 * @returns {Promise<{ allowed: boolean, hardware: boolean }>}
 */
export const resolveVideoTranscodeCapability = async () => {
  const { mode } = getVideoTranscodePolicy();
  if (mode === 'never') return { allowed: false, hardware: false };
  let hardware = false;
  try {
    hardware = Boolean((await detectVideoEncoder())?.hardware);
  } catch {
    hardware = false;
  }
  if (mode === 'always') return { allowed: true, hardware };
  return hardware ? { allowed: true, hardware: true } : { allowed: false, hardware: false };
};

/** HDR detection off the fields ffprobe already records. */
export const isHdrVideo = (video) => {
  const transfer = String(video?.colorTransfer || '').toLowerCase();
  const primaries = String(video?.colorPrimaries || '').toLowerCase();
  return transfer.includes('smpte2084') || transfer.includes('arib-std-b67') || primaries.includes('bt2020');
};

/** 10-bit sources need an explicit downshift: H.264 encoders take yuv420p. */
export const isTenBitVideo = (video) =>
  /10|p010|p016/i.test(String(video?.pixFmt || ''));

/**
 * Byte-level generation of the remux recipe. Bump whenever a change alters
 * the bytes of future sessions incompatibly with reuse (adelay policy,
 * filter chains, segmenting). Sessions stamped with an older build are
 * skipped by the reuse matcher so yesterday's bytes can never be served as
 * today's fix — they age out through normal expiry instead.
 *
 * Build history: 1 = pre-offset era (audio-early-only compensation);
 * 2 = symmetric per-file A/V offset compensation (both directions).
 * 3 = VFR-tolerant fMP4 muxing (fps_mode passthrough, max_interleave_delta,
 *     max_muxing_queue_size): fixes "Packet duration ... out of range" kills
 *     that broke audio-track switching and seek on VFR sources.
 * 4 = -noaccurate_seek on input seeks (audio was ~146ms ahead of the picture
 *     whenever a seek landed on a keyframe), AND retires sessions written while
 *     a seek-origin probe could report 0 for a mid-film request. Those records
 *     carry startAt: 0 beside bytes that begin minutes in, so reusing one shows
 *     the middle of a film at 00:00 with every subtitle out by that much.
 * 5 = retires sessions stored while a seek-origin CACHE MISS read as an origin
 *     of 0 (Number(null) is 0). Same damage as build 4's: startAt: 0 recorded
 *     against a seek-started stream, so a reused one answers the player with a
 *     position its bytes never contained.
  * 6 = the remux writes its own origin sidecar, so a seek-started session is
  *     labelled with where its bytes begin instead of where they were asked to.
  *     Sessions from build 5 carry the requested position and are out by the
  *     keyframe rewind (measured 1.5s), which every subtitle wears.
  * 7 = the build-6 sidecar is retired: a plain-mp4 second output only gets its
  *     moov trailer when the whole ffmpeg process exits, so while a film is
  *     still remuxing (always, at resolve time) it is unreadable and every
  *     seek-started session silently fell back to the requested position.
  *     Proven live: origin.mp4 with ftyp+mdat but no moov, readSeekOrigin null.
  *     The origin is measured again by a short-lived probe that exits at once
  *     (valid mp4 immediately), cached per file+bucket, and raced with the
  *     playlist wait so it rarely costs wall time. Build-6 sessions carry the
  *     same wrong label as build 5 and are retired too.
  */
export const REMUX_BUILD = 7;

/** VBR targets for codec-transcode rungs (H.264, SDR). */
export const transcodeKbpsForHeight = (height) => {
  const h = Number(height) || 1080;
  if (h >= 2000) return 20000;
  if (h >= 1400) return 12000;
  if (h >= 900) return 8000;
  if (h >= 600) return 4000;
  return 2000;
};

/**
 * Build the ffmpeg-side plan for a codec-incompatible source.
 * Returns null when even transcoding cannot serve it in realtime.
 */
export const planCodecTranscode = (probe, caps = {}, capability = {}) => {
  const srcH = Number(probe?.video?.height) || null;
  const capH = Number(caps?.maxHeight) > 0 ? Number(caps.maxHeight) : 1080;
  const targetH = srcH ? Math.min(srcH, capH) : capH;
  // Software transcode above 1080p never reaches realtime: keep rejecting
  // rather than trading a clear message for endless buffering.
  if (targetH > 1080 && !capability.hardware) return null;
  return {
    mode: 'transcode',
    height: targetH,
    kbps: transcodeKbpsForHeight(targetH),
    tonemap: isHdrVideo(probe?.video),
    tenBit: isTenBitVideo(probe?.video),
  };
};

/**
 * Video arguments for one delivery plan.
 *
 * `copy` is the remux path and costs nothing. The transcode path scales and
 * re-encodes; on the NVENC pipeline the frame never leaves the GPU, which is
 * where the CPU saving comes from — decoding to system memory first spends
 * 22 s of CPU per minute of 4K instead of 1.1 s.
 *
 * `video.startAt` (seconds) adds input seeking independent of copy/transcode:
 * ffmpeg jumps straight to the requested position and resets timestamps to
 * zero, so a far seek does not wait for the whole prefix to (re)mux. The
 * client maps the truncated 0-based timeline back with startOffset.
 */
/**
 * HDR -> SDR tonemap chain (zscale). Without it a transcoded HDR source
 * comes out washed out: the PQ/BT.2020 light is reinterpreted as SDR.
 * Appended after scaling; ends on yuv420p for the H.264 encoders.
 */
const TONEMAP_FILTERS = 'zscale=transfer=linear,tonemap=hable,zscale=transfer=bt709:matrix=bt709:primaries=bt709';

export const buildVideoArgs = (video, encoder) => {
  const startAt = Math.floor(Number(video?.startAt) || 0);
  // -noaccurate_seek is load-bearing, not a speed tweak. Accurate seeking cuts
  // the re-encoded audio at the exact -ss timestamp while the copied video can
  // only begin at a keyframe. When the seek lands *on* a keyframe, that frame's
  // DTS sits a B-frame reorder delay before its PTS, the two streams get
  // rebased by different amounts, and the audio comes out ~146ms ahead of the
  // picture — the direction viewers notice first, on every resume that happens
  // to land there. Seeking inexactly starts both streams at the same keyframe
  // instead. Measured in tests/remux-avsync-offset.test.mjs.
  const seekInput = startAt > 0 ? ['-noaccurate_seek', '-ss', String(startAt)] : [];
  const transcode = video?.mode === 'transcode';
  // HLS fMP4 requires HEVC to be tagged as hvc1 for Apple/browser compatibility.
  // Without it, ffmpeg exits with: "Stream HEVC is not hvc1, you should use tag:v hvc1 to set it."
  // A transcode whose encoder emits HEVC (hevc_nvenc/libx265) needs it too —
  // checking only the source codec missed those writers and killed them.
  const encodesHevc = transcode && /hevc|h265|x265/i.test(encoder?.encoder || '');
  const hevcTag = ((video?.codec === 'hevc' && !transcode) || encodesHevc) ? ['-tag:v', 'hvc1'] : [];
  if (!video || (!transcode && seekInput.length === 0)) {
    return { input: [], output: ['-c:v', 'copy', ...hevcTag] };
  }

  const height = Math.max(144, Math.round(video.height || 1080));
  const kbps = Math.max(200, Math.round(video.kbps || 3000));
  const hardware = encoder?.hardware && encoder.encoder.includes('nvenc');
  const tonemap = Boolean(video.tonemap);
  const tenBit = Boolean(video.tenBit);

  // Seek + copy costs nothing extra: same stream, later start.
  const copyOutput = ['-c:v', 'copy', ...hevcTag];
  if (!transcode) {
    return { input: seekInput, output: copyOutput };
  }

  if (hardware) {
    // scale_cuda emits GPU frames; zscale/tonemap need system memory, so HDR
    // (or 10-bit SDR, which nvenc H.264 also rejects) round-trips through a
    // download/upload pair. Decode stays on the GPU either way.
    const needsDownload = tonemap || tenBit;
    const vf = tonemap
      ? `scale_cuda=-2:${height},hwdownload,format=p010le,${TONEMAP_FILTERS},format=yuv420p,hwupload_cuda`
      : needsDownload
        ? `scale_cuda=-2:${height},hwdownload,format=yuv420p,hwupload_cuda`
        : `scale_cuda=-2:${height}`;
    return {
      input: [...seekInput, '-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda'],
      output: [
        // -2 keeps the aspect ratio and rounds to an even width, which the
        // encoder requires; an odd width fails the whole command.
        '-vf', vf,
        '-c:v', encoder.encoder,
        '-preset', 'p4',
        '-tune', 'hq',
        '-rc', 'vbr',
        '-b:v', `${kbps}k`,
        '-maxrate', `${Math.round(kbps * 1.5)}k`,
        '-bufsize', `${kbps * 2}k`,
        // Every segment must start on a keyframe or seeking lands in the middle
        // of a GOP and the player shows nothing until the next one.
        '-g', '96',
        '-no-scenecut', '1',
      ],
    };
  }

  const vf = tonemap
    ? `scale=-2:${height},${TONEMAP_FILTERS},format=yuv420p`
    : `scale=-2:${height},format=yuv420p`;
  return {
    input: seekInput,
    output: [
      '-vf', vf,
      '-c:v', encoder?.encoder || 'libx264',
      '-preset', 'veryfast',
      '-b:v', `${kbps}k`,
      '-maxrate', `${Math.round(kbps * 1.5)}k`,
      '-bufsize', `${kbps * 2}k`,
      '-g', '96',
      '-sc_threshold', '0',
    ],
  };
};

export const buildFfmpegArgs = ({ inputUrl, outputDir, audioCopy = false, segmentSeconds = REMUX_SEGMENT_SECONDS, audioStreamIndex = null, audioChannels = null, audioDelayMs = 0, video = null, encoder = null }) => {
  // Explicit output-side audio delay, chained onto any existing audio filter
  // before the stereo fold. Byte-identical to the old command when 0, which is
  // what every caller passes: a container mux offset is NOT a defect to correct
  // here, because ffmpeg already carries the source's A/V relationship through
  // the re-encode untouched (measured in tests/remux-avsync-offset.test.mjs).
  // Deriving a delay from the probe's stream start times pushes the audio late
  // by exactly that offset on every title muxed that way.
  const delayMs = Number(audioDelayMs) > 0 && !audioCopy ? Math.round(Number(audioDelayMs)) : 0;
  const surround = isSurroundLayout(audioChannels);
  const afChain = [
    ...(surround ? [DIALOGUE_DOWNMIX] : []),
    ...(delayMs > 0 ? [`adelay=${delayMs}:all=1`] : []),
  ].join(',');
  const videoArgs = buildVideoArgs(video, encoder);
  const videoCopy = !video || video.mode !== 'transcode';
  return [
  '-hide_banner',
  '-loglevel',
  'warning',
  '-nostdin',
  '-fflags',
  '+genpts',
  // Hardware decode has to be declared before the input it applies to.
  ...videoArgs.input,
  '-i',
  inputUrl,
  '-map',
  '0:v:0',
  '-map',
  // Explicit choice maps that exact ffprobe stream; otherwise the default
  // first audio (legacy behavior, byte-identical command).
  Number.isInteger(audioStreamIndex) ? `0:${audioStreamIndex}?` : '0:a:0?',
  ...videoArgs.output,
  // VFR tolerance: sources with variable frame rate (common in HEVC scene
  // encodes) produce packets whose DTS deltas go negative when copied into
  // fragmented MP4. Without these flags the mp4 muxer emits
  // "Packet duration: -N / dts ... is out of range" per packet and eventually
  // the whole writer stalls or is killed, making audio-track switches and
  // seek-started sessions fail silently.
  //
  // -fps_mode passthrough: forward VFR timestamps untouched instead of the
  //   default "cfr" normalisation that generates the negative deltas.
  //   Only meaningful on the copy path (transcode emits its own timescale).
  // -max_interleave_delta 0: disable the interleave-delta overflow check
  //   that turns those deltas into fatal muxer errors.
  // -max_muxing_queue_size 2048: raise the per-stream mux queue so a burst
  //   of out-of-order packets does not overflow the default 128 entries.
  ...(videoCopy ? ['-fps_mode:v', 'passthrough'] : []),
  '-max_interleave_delta', '0',
  '-max_muxing_queue_size', '2048',
  '-c:a',
  audioCopy ? 'copy' : 'aac',
  ...(audioCopy
    ? []
    : [
        '-b:a',
        '192k',
        ...(afChain ? ['-af', afChain] : []),
        // The fold already emits stereo, so `-ac 2` would be redundant beside it.
        ...(!surround ? ['-ac', '2'] : []),
      ]),
  '-avoid_negative_ts',
  'make_zero',
  '-sn',
  '-f',
  'hls',
  '-hls_time',
  String(segmentSeconds),
  '-hls_segment_type',
  'fmp4',
  // A movie is VOD, not a live feed. The previous flags made this a sliding
  // window: delete_segments+omit_endlist with hls_list_size 10 kept only the
  // newest ~10 segments and dropped EXT-X-ENDLIST, so EXT-X-MEDIA-SEQUENCE kept
  // climbing as ffmpeg raced ahead of the viewer. The player then treats the
  // stream as live, pins itself to the moving live edge, and the timeline drifts
  // out from under whoever is watching while already-watched segments are
  // deleted, making pause and seek-back impossible.
  // 'event' keeps every segment and marks the playlist append-only, so t=0 stays
  // t=0 while ffmpeg is still writing; ENDLIST is emitted when it exits cleanly.
  '-hls_playlist_type',
  'event',
  '-hls_flags',
  'independent_segments',
  '-hls_list_size',
  '0',
  '-hls_fmp4_init_filename',
  'init.mp4',
  '-hls_segment_filename',
  path.join(outputDir, 'seg_%05d.m4s'),
  path.join(outputDir, 'index.m3u8'),
  ];
};

/**
 * ffmpeg echoes its input URL on every run, and that URL is a short-lived
 * TorBox download link tied to the user's account. Anything derived from its
 * stderr — a log line, a stored failure detail — has to go through this first.
 */
export const redactSecrets = (text) =>
  String(text || '')
    .replace(/https?:\/\/\S+/gi, '[url-đã-ẩn]')
    .replace(/(api[_-]?key|token|password)=\S+/gi, '$1=[đã-ẩn]');

/**
 * What remote viewers are currently costing the uplink, in kbps.
 *
 * LAN sessions are excluded on purpose: their bytes never cross it, and
 * counting them would let someone watching in the next room lock out everyone
 * outside the house.
 */
export const activeEgressKbps = () => {
  let total = 0;
  for (const session of sessions.values()) {
    if (!session.process || session.exitCode !== undefined) continue;
    if (session.lan) continue;
    total += Number(session.kbps) || 0;
  }
  return total;
};

/**
 * Refusal when the box is already running as many ffmpeg writers as it may.
 * 503 rather than 500: nothing is broken, there is simply no room right now.
 */
export class RemuxBusyError extends Error {
  constructor(limit) {
    super(`Máy chủ đang phục vụ tối đa ${limit} luồng cùng lúc, thử lại sau ít phút`);
    this.name = 'RemuxBusyError';
    this.code = 'REMUX_BUSY';
    this.status = 503;
    this.limit = limit;
  }
}

/**
 * How many ffmpeg writers this box may run at once (REMUX_MAX_WRITERS).
 *
 * Three by default: enough that a household is never refused, low enough that
 * a CPU-only box is not asked to encode four films at once. Raise it only
 * alongside cores — or a GPU, where the ceiling can go much higher. 0 drains
 * the box before a restart; anything unparseable falls back to the default
 * rather than silently removing the ceiling.
 */
export const remuxWriterLimit = (env = process.env) => {
  // Unset and empty both mean "not configured" — Number('') is 0, which would
  // otherwise read a blank line in .env as an instruction to drain the box.
  const raw = String(env?.REMUX_MAX_WRITERS ?? '').trim();
  if (!raw) return 3;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 3;
  return Math.floor(n);
};

/** ffmpeg writers alive right now — reused and finished sessions cost nothing. */
export const activeWriterCount = () => {
  let live = 0;
  for (const session of sessions.values()) {
    if (!session.process || session.process.killed) continue;
    if (session.exitCode !== undefined) continue;
    live += 1;
  }
  return live;
};

/**
 * Whether one more writer may start. Fails OPEN on unusable numbers: a
 * miscount is a bad reason to refuse every viewer, since this is a safety
 * valve rather than an authorisation check.
 */
/**
 * Which superseded writers to stop so one more may start.
 *
 * A superseded writer keeps running for its grace window (see
 * SUPERSEDE_GRACE_MS) in case the viewer comes straight back, so it holds a
 * slot under the ceiling. Counting those against a viewer who is replacing
 * their OWN session turned the safety valve on the person it was protecting:
 * three seeks inside 90s and the next one came back 503. They have already
 * been replaced and nobody is watching them, so they go first — the ceiling
 * still bounds real concurrent work, it just stops guarding corpses.
 *
 * Oldest first (Map order is insertion order), and never more than needed.
 */
/**
 * Whether starting a replacement writer beats waiting for the live one.
 *
 * A session that has not yet written as far as the viewer is seeking looks
 * useless, but a replacement only helps if it can BEGIN closer to the target.
 * With truncated sessions switched off every writer starts at 0, so refusing
 * the live one spawns an identical ffmpeg, discards the progress already made,
 * and races the same bytes — which is exactly what happened on every seek:
 * four writers, all from the beginning, none able to reach the target any
 * sooner than the first.
 *
 * Unusable numbers fall toward reuse: waiting on a writer that is already
 * running is a cheaper mistake than a duplicate one.
 */
export const spawnBeatsReuse = ({
  sessionStartAt,
  freshStartAt,
  playableSeconds,
  minPlayable,
} = {}) => {
  // A writer with nothing servable yet cannot be handed to a player: the reuse
  // path answers immediately, so the client gets a playlist URL that returns
  // 409 and sits spinning. The fresh path waits for the first buffer before it
  // replies, so below the floor that wait is exactly what is wanted.
  const playable = Number(playableSeconds);
  const floor = Number(minPlayable);
  if (Number.isFinite(floor) && Number.isFinite(playable) && playable < floor) return true;

  const live = Number(sessionStartAt);
  const fresh = Number(freshStartAt);
  if (!Number.isFinite(live) || !Number.isFinite(fresh)) return false;
  return fresh > live;
};

export const reapPlan = ({ active, limit, superseded = [] } = {}) => {
  const a = Number(active);
  const l = Number(limit);
  if (!Number.isFinite(a) || !Number.isFinite(l)) return [];
  if (!Array.isArray(superseded) || superseded.length === 0) return [];
  if (a < l) return [];
  return superseded.slice(0, a - l + 1);
};

export const admitRemuxWriter = ({ active, limit } = {}) => {
  const a = Number(active);
  const l = Number(limit);
  if (!Number.isFinite(a) || !Number.isFinite(l)) return true;
  return a < l;
};

/** Budget for the one-frame seek probe. Seeking a multi-GB remote MKV means
 *  range-reading its trailing Cues first, which routinely outlasts a short
 *  budget — and a timed-out probe silently keeps the requested position as the
 *  label, putting every subtitle early by the keyframe rewind. Generous on
 *  purpose: it runs raced with the playlist/buffer waits (not after them) and
 *  its answer is cached per file+bucket, so one success fixes every later seek
 *  to the same neighbourhood. */
const SEEK_PROBE_TIMEOUT_MS = Number(process.env.SEEK_PROBE_TIMEOUT_MS) || 25000;

/**
 * Where `-ss startAt` will really put the first frame, in source seconds.
 *
 * A copied video stream cannot be cut mid-GOP, so ffmpeg rewinds to a keyframe
 * at or before the request — with -noaccurate_seek that can be most of a GOP.
 * The session used to be labelled with the *requested* position anyway, so the
 * player mapped the film clock wrong by the difference: subtitles early, seek
 * bar off, resume drifting a little further each time.
 *
 * Asking costs one keyframe: decode a single frame with -copyts, which keeps
 * source timestamps instead of rebasing to zero, and read its PTS. Measured at
 * ~50ms and 3.5KB on local media; over HTTP it is a range request or two.
 *
 * Returns null whenever the answer would be a guess — no input, a source that
 * will not seek, a position past the end, a probe that outstays its budget.
 * Callers fall back to the requested position, which is what shipped before.
 */
/**
 * Furthest a genuine keyframe rewind can reach. Real GOPs are seconds; this is
 * generous on purpose, because the job here is only to tell a keyframe apart
 * from a seek that never happened.
 */
const MAX_SEEK_REWIND_SECONDS = 60;

/**
 * Whether a measured origin can be believed.
 *
 * A source that will not seek does not fail loudly: ffmpeg quietly reads from
 * the beginning and the probe reads back 0. Taken at face value that labels a
 * session as starting from the top while the viewer asked for the middle — the
 * client then drops the offset entirely and the player sits spinning, which is
 * exactly what happened on a TorBox link asking for 900s and getting 0s back.
 *
 * After the request is impossible (bytes nobody asked for); further back than a
 * GOP could ever reach is a failed seek wearing a plausible number.
 */
export const isPlausibleSeekOrigin = ({ pts, at } = {}) => {
  const p = Number(pts);
  const a = Number(at);
  if (!Number.isFinite(p) || !Number.isFinite(a) || p < 0) return false;
  if (p > a + 0.001) return false;
  return a - p <= MAX_SEEK_REWIND_SECONDS;
};

/**
 * Whether resolve may spend a probe learning where a seek really lands.
 *
 * ON unless explicitly disabled (SEEK_ORIGIN_PROBE=0).
 *
 * Its first trial against a real debrid link answered 0s for a 900s request and
 * cost a playback, which is why isPlausibleSeekOrigin exists: an origin further
 * back than a GOP could reach is now refused and the caller keeps the requested
 * position. Measured since against an HTTP source, the probe agrees with the
 * local answer exactly when the server honours byte ranges, and returns nothing
 * usable when it does not — so with the guard in place it can only add accuracy
 * or cost one small request. Set to 0 to skip it entirely.
 */
/**
 * Whether resolve may build a session that starts partway into the film.
 *
 * ON unless explicitly disabled (PLAYBACK_SEEK_START=0).
 *
 * It was briefly the other way round, to escape a label error: `-ss` cannot cut
 * mid-GOP, so the bytes begin at a keyframe before the requested position while
 * the session carries the position asked for, and subtitles run early by the
 * difference (measured 1.5-2.4s on real releases). Turning it off does fix that
 * — and makes seeking unusable on any film not yet fully remuxed, because the
 * viewer then waits for ffmpeg to write all the way to their target. A film
 * that plays but mistimes subtitles by two seconds beats one that cannot seek,
 * so the default went back.
 *
 * seekOriginProbeEnabled closes the label error when the source can be seeked;
 * when it cannot, the label falls back to the requested position as before.
 */
/**
 * A previously measured seek origin, or null when there isn't one.
 *
 * Exists because `Number(await getCache(key))` does not: getCache answers null
 * on a miss — and on every call while Redis is unreachable — and `Number(null)`
 * is 0, which is finite, non-negative, and therefore indistinguishable from a
 * file whose seek really does land at the start. Every seek-started session was
 * consequently stored as beginning at 0 while its bytes began minutes in, so
 * the player asked for a position the stream did not contain and sat on a 409.
 *
 * Only an actual number (or a number that survived JSON as text) counts. The
 * same trap as a blank environment variable reading as a real 0.
 */
export const cachedSeekOrigin = (raw) => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

export const seekStartEnabled = (env = process.env) =>
  !/^(0|false|off|no)$/i.test(String(env?.PLAYBACK_SEEK_START ?? '').trim());

export const seekOriginProbeEnabled = (env = process.env) =>
  !/^(0|false|off|no)$/i.test(String(env?.SEEK_ORIGIN_PROBE ?? '').trim());

/**
 * RETIRED in build 7 (kept exported for tests): the build-6 sidecar the remux
 * wrote itself. A plain-mp4 second output only receives its moov trailer when
 * the whole ffmpeg process exits, so on a still-remuxing film — always, at
 * resolve time — ffprobe fails with "moov atom not found" and callers silently
 * kept the requested position. Live proof on a 2160p release: 262KB
 * ftyp+mdat, no moov, readSeekOrigin null. The resolve path measures with
 * probeSeekOrigin (a short-lived process whose mp4 is valid at once) instead.
 *
 * Where this session's bytes really begin, read from the sidecar the remux
 * wrote (SEEK_ORIGIN_FILE). Free: the frame was produced by the same process
 * and the same seek that built the playlist, so there is no second connection
 * to open and no separate timeout to lose.
 *
 * null whenever the answer would be a guess — no sidecar (a from-the-start
 * session never writes one), an unreadable one, or a position that cannot be a
 * keyframe rewind. Callers then keep the position that was requested.
 */
export const readSeekOrigin = async (sessionId, requestedStartAt) => {
  const id = safeId(sessionId);
  const at = Number(requestedStartAt);
  if (!id || !Number.isFinite(at) || at <= 0) return null;
  try {
    const { stdout } = await run(
      FFPROBE_BIN,
      ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time',
        '-of', 'csv=p=0', path.join(TRANSCODE_ROOT, id, SEEK_ORIGIN_FILE)],
      { timeoutMs: 5000 },
    );
    const first = String(stdout).split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)[0];
    const pts = Number(first);
    if (!isPlausibleSeekOrigin({ pts, at })) {
      console.warn(`[playback] seek origin ${first} không hợp lý cho -ss ${at}; dùng vị trí đã yêu cầu`);
      return null;
    }
    return pts;
  } catch {
    return null;
  }
};

export const probeSeekOrigin = async (inputUrl, startAt) => {
  const at = Number(startAt);
  if (!inputUrl || !Number.isFinite(at) || at < 0) return null;
  // From the start there is nothing to rewind to, and no probe worth paying for.
  if (at === 0) return 0;

  const tmpFile = path.join(
    os.tmpdir(),
    `seekprobe-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`,
  );
  try {
    await run(
      FFMPEG_BIN,
      [
        '-hide_banner', '-loglevel', 'error', '-nostdin',
        // Same seek flags as the remux, or the probe would answer for a
        // different frame than the one the writer will actually start on.
        '-noaccurate_seek', '-ss', String(at),
        '-i', inputUrl,
        '-map', '0:v:0', '-c', 'copy', '-frames:v', '1',
        // The point of the whole exercise: keep source timestamps instead of
        // rebasing them to zero, so the frame says where it really came from.
        // Plain mp4 on purpose — a fragmented one rebases the fragment's own
        // timeline and hands back the reorder delay instead of the position.
        '-copyts',
        '-f', 'mp4',
        '-y', tmpFile,
      ],
      { timeoutMs: SEEK_PROBE_TIMEOUT_MS },
    );
    const { stdout } = await run(
      FFPROBE_BIN,
      ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time',
        '-of', 'csv=p=0', tmpFile],
      { timeoutMs: SEEK_PROBE_TIMEOUT_MS },
    );
    const first = String(stdout).split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)[0];
    const pts = Number(first);
    if (!isPlausibleSeekOrigin({ pts, at })) {
      console.warn(`[playback] seek origin ${pts} không hợp lý cho -ss ${at}; dùng vị trí đã yêu cầu`);
      return null;
    }
    return pts;
  } catch {
    return null;
  } finally {
    await fs.rm(tmpFile, { force: true }).catch(() => {});
  }
};

export const startRemuxSession = async ({ sessionId, inputUrl, audioCopy = false, audioStreamIndex = null, audioChannels = null, audioDelayMs = 0, video = null }) => {
  const id = safeId(sessionId);
  if (!id) throw new Error('sessionId không hợp lệ');
  // A pending grace-period stop belongs to the previous writer: a fresh start
  // on the same id must not be killed by it.
  cancelScheduledStop(id);

  const existing = sessions.get(id);
  if (existing?.process && !existing.process.killed) return existing;

  // Only a genuinely new writer is gated: the reuse above already returned,
  // and finished renditions are served off disk without coming through here.
  const limit = remuxWriterLimit();
  if (!admitRemuxWriter({ active: activeWriterCount(), limit })) {
    // Free the expendable slots first — writers already replaced by a newer
    // one, still burning their grace window with nobody watching.
    for (const doomed of reapPlan({
      active: activeWriterCount(),
      limit,
      superseded: [...supersedeTimers.keys()],
    })) {
      cancelScheduledStop(doomed);
      await stopRemuxSession(doomed).catch(() => false);
    }
  }
  if (!admitRemuxWriter({ active: activeWriterCount(), limit })) {
    throw new RemuxBusyError(limit);
  }

  const outputDir = path.join(TRANSCODE_ROOT, id);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const encoder = video?.mode === 'transcode' ? await detectVideoEncoder() : null;
  const args = buildFfmpegArgs({ inputUrl, outputDir, audioCopy, audioStreamIndex, audioChannels, audioDelayMs, video, encoder });
  // cwd must be outputDir: ffmpeg resolves -hls_fmp4_init_filename against the
  // process cwd, not the playlist dir, so init.mp4 would otherwise land in the
  // backend root and every segment request would 404 on a missing init map.
  const child = spawn(FFMPEG_BIN, args, { windowsHide: true, cwd: outputDir });
  const session = {
    id,
    outputDir,
    playlistPath: path.join(outputDir, 'index.m3u8'),
    process: child,
    startedAt: new Date(),
    lastAccessAt: Date.now(),
    lastDiskTouchAt: 0,
    stderr: '',
    // Carried so admission control can price the next request without going
    // back to the database for sessions it already started.
    lan: Boolean(video?.lan),
    kbps: Number(video?.kbps) || 0,
  };
  sessions.set(id, session);

  child.stderr.on('data', (chunk) => {
    session.stderr = `${session.stderr}${chunk.toString()}`.slice(-4000);
  });
  child.on('close', (code) => {
    session.exitCode = code;
    session.closedAt = new Date();
    // A mid-stream death used to be completely silent: the playlist simply
    // stopped growing, and because an EVENT playlist has no ENDLIST the player
    // sat there waiting forever. The session record explains it eventually, but
    // only once the client asks for the playlist again — so say it out loud
    // here, where it lands in the container log at the moment it happens.
    if (code !== 0) {
      console.error(
        `ffmpeg remux ${id} thoát với mã ${code}: ${redactSecrets(session.stderr).slice(-800)}`,
      );
    }
  });

  return session;
};

export const waitForPlaylist = async (session, timeoutMs = PLAYLIST_TIMEOUT_MS) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const stat = await fs.stat(session.playlistPath);
      if (stat.size > 0) return true;
    } catch {
      // not ready yet
    }
    if (session.exitCode !== undefined) {
      throw new Error(`ffmpeg dừng sớm (${session.exitCode}): ${session.stderr.slice(-600)}`);
    }
    await wait(250);
  }
  throw new Error('ffmpeg chưa tạo playlist sau thời gian chờ');
};

export const getRemuxSession = (sessionId) => {
  const id = safeId(sessionId);
  return id ? sessions.get(id) || null : null;
};

/**
 * Of a viewer's earlier remuxes of the same title, the ones still burning
 * resources and worth stopping.
 *
 * A retry does not replace the previous remux, it adds to it: the old ffmpeg
 * keeps pulling the source and writing segments at full speed until
 * LIVE_IDLE_MS finally expires. Two of those were measured saturating ~36 MB/s
 * of link and disk between them, which stalls the very playback the retry was
 * meant to repair, so each retry made the problem worse.
 *
 * Idle time deliberately plays no part here. The player buffers up to three
 * minutes ahead and goes quiet while it drains, so "has not asked for a
 * segment lately" describes a healthy viewer just as well as an absent one.
 * Same viewer, same title, older session is the signal that cannot misfire.
 */
export const selectSupersededRemuxes = (
  priorSessionIds = [],
  keepSessionIds = [],
  isLive = () => false,
) => {
  const keepSet = new Set(
    Array.isArray(keepSessionIds) ? keepSessionIds : [keepSessionIds].filter(Boolean),
  );
  return priorSessionIds.filter((id) => id && !keepSet.has(id) && isLive(id));
};

/** Whether a session still has a running ffmpeg behind it. */
export const isRemuxSessionLive = (sessionId) => {
  const session = sessions.get(safeId(sessionId));
  return Boolean(session?.process && session.exitCode === undefined);
};

/**
 * Slow-writer failover inputs.
 *
 * A source whose upstream dribbles below realtime produces a playlist the
 * viewer can never get ahead of: watch 5 minutes, stall at the live edge,
 * wait, repeat. The speed gate in resolvePlayback rejects such a candidate
 * outright (the loop then tries the next source) instead of handing over a
 * doomed session. The thresholds are deliberately lenient: ffmpeg startup
 * (input open on a slow CDN) yields nothing for the first seconds, and a
 * software transcode that cannot hold realtime is unwatchable anyway.
 */
export const SLOW_WRITER_MIN_OBSERVE_MS = 45 * 1000;
export const SLOW_WRITER_MIN_SPEED = 0.8; // playlist-seconds per wall-second

export const computeWriteSpeed = ({ startedAtMs, bufferedSeconds, nowMs = Date.now() }) => {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(bufferedSeconds) || bufferedSeconds < 0) {
    return null;
  }
  const elapsedMs = nowMs - startedAtMs;
  if (!(elapsedMs > 0)) return null;
  return { elapsedMs, bufferedSeconds, speed: bufferedSeconds / (elapsedMs / 1000) };
};

/**
 * Did this writer die on an expired/revoked download link?
 *
 * ffmpeg holds one TorBox URL for the whole remux. When it expires mid-film
 * the child exits non-zero with auth-flavoured stderr (HTTP 401/403 and
 * friends). Deliberate stops (SIGTERM → null, clean exit → 0) never count,
 * and neither does a failure without that smell — those keep the existing
 * sampling/delete path instead of skipping reuse.
 */
const LINK_DEATH_PATTERN = /\b(401|403)\b|forbidden|unauthori[sz]ed|expir|access[^a-z0-9]{0,8}denied|token[^a-z0-9]{0,8}(invalid|revoked|expired)|link[^a-z0-9]{0,8}(expired|invalid)/i;

export const isLinkExpiryDeath = ({ exitCode = null, stderrTail = '' } = {}) => {
  if (exitCode === 0 || exitCode === null || exitCode === undefined) return false;
  if (typeof exitCode !== 'number') return false;
  return LINK_DEATH_PATTERN.test(String(stderrTail || ''));
};

export const stopRemuxSession = async (sessionId) => {
  const id = safeId(sessionId);
  cancelScheduledStop(id);
  const session = sessions.get(id);
  if (!session) return false;
  if (session.process && !session.process.killed && session.exitCode === undefined) {
    session.process.kill('SIGTERM');
  }
  sessions.delete(id);
  return true;
};

/**
 * Grace period before a superseded writer is stopped.
 *
 * Switching A -> B kills A's ffmpeg immediately, so switching back to A pays
 * a full cold remux (45s initial-buffer wait on a slow upstream) even when A
 * was healthy. Holding the old writer for a short window makes source
 * comparison cheap: returning inside the window finds the writer alive and
 * its partial playlist reusable. Bounded — one timer per session, cleared the
 * moment the session goes current again or is stopped directly.
 */
export const SUPERSEDE_GRACE_MS = 90 * 1000;
const supersedeTimers = new Map();

export const scheduleSupersededStop = (sessionId, delayMs = SUPERSEDE_GRACE_MS) => {
  const id = safeId(sessionId);
  if (!id || supersedeTimers.has(id)) return false;
  const timer = setTimeout(() => {
    supersedeTimers.delete(id);
    stopRemuxSession(id).catch(() => false);
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
  supersedeTimers.set(id, timer);
  return true;
};

export const cancelScheduledStop = (sessionId) => {
  const id = safeId(sessionId);
  const timer = id ? supersedeTimers.get(id) : undefined;
  if (!timer) return false;
  clearTimeout(timer);
  supersedeTimers.delete(id);
  return true;
};

/** Record real viewer activity without writing a marker for every segment. */
export const touchTranscodeSession = async (sessionId, now = Date.now()) => {
  const id = safeId(sessionId);
  if (!id) return false;
  const session = sessions.get(id);
  if (session) session.lastAccessAt = now;

  const lastTouch = session?.lastDiskTouchAt || 0;
  if (now - lastTouch < ACCESS_TOUCH_INTERVAL_MS) return true;
  const outputDir = path.resolve(TRANSCODE_ROOT, id);
  if (path.dirname(outputDir) !== TRANSCODE_ROOT) return false;
  try {
    await fs.mkdir(outputDir, { recursive: true });
    const marker = path.join(outputDir, '.access');
    await fs.writeFile(marker, String(now));
    const date = new Date(now);
    await fs.utimes(marker, date, date);
    if (session) session.lastDiskTouchAt = now;
    return true;
  } catch {
    return false;
  }
};

/** Pure eviction planner, exported so retention rules stay regression-testable. */
export const selectTranscodeEvictions = (
  entries,
  {
    now = Date.now(),
    maxBytes = CACHE_MAX_BYTES,
    ttlMs = CACHE_TTL_MS,
    incompleteGraceMs = INCOMPLETE_GRACE_MS,
    liveIdleMs = LIVE_IDLE_MS,
    viewerGraceMs = VIEWER_GRACE_MS,
  } = {},
) => {
  const deleteIds = [];
  const stopIds = [];
  const selected = new Set();
  let retainedBytes = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);

  const evict = (entry, stop = false) => {
    if (selected.has(entry.id)) return;
    selected.add(entry.id);
    deleteIds.push(entry.id);
    if (stop) stopIds.push(entry.id);
    retainedBytes -= entry.sizeBytes;
  };

  for (const entry of entries) {
    if (entry.live) {
      if (now - entry.lastAccessMs > liveIdleMs) evict(entry, true);
      continue;
    }
    if (!entry.complete && now - entry.modifiedMs > incompleteGraceMs) {
      evict(entry);
    } else if (entry.complete && now - entry.lastAccessMs > ttlMs) {
      evict(entry);
    }
  }

  // Enforce the byte cap with completed, inactive sessions first. Recent
  // incomplete directories may still belong to an ffmpeg orphan after a Node
  // restart, so grace time protects them from deletion while being written.
  const capCandidates = entries
    .filter((entry) => (
      entry.complete
      && !entry.live
      && !selected.has(entry.id)
      && now - entry.lastAccessMs > viewerGraceMs
    ))
    .sort((a, b) => a.lastAccessMs - b.lastAccessMs);
  for (const entry of capCandidates) {
    if (retainedBytes <= maxBytes) break;
    evict(entry);
  }

  return {
    deleteIds,
    stopIds,
    retainedBytes: Math.max(0, retainedBytes),
    overLimitBytes: Math.max(0, retainedBytes - maxBytes),
  };
};

const directorySize = async (dirPath) => {
  const items = await fs.readdir(dirPath, { withFileTypes: true });
  let total = 0;
  for (const item of items) {
    if (!item.isFile()) continue;
    total += (await fs.stat(path.join(dirPath, item.name))).size;
  }
  return total;
};

const readCacheEntry = async (dirent) => {
  // Playback session ids are 16 random bytes rendered as 32 hex characters.
  // Ignoring every other directory makes recursive removal narrowly scoped.
  if (!dirent.isDirectory() || !/^[a-f0-9]{32}$/i.test(dirent.name)) return null;
  const dirPath = path.resolve(TRANSCODE_ROOT, dirent.name);
  if (path.dirname(dirPath) !== TRANSCODE_ROOT) return null;
  const playlistPath = path.join(dirPath, 'index.m3u8');
  const markerPath = path.join(dirPath, '.access');
  const [dirStat, playlistStat, markerStat, playlist] = await Promise.all([
    fs.stat(dirPath),
    fs.stat(playlistPath).catch(() => null),
    fs.stat(markerPath).catch(() => null),
    fs.readFile(playlistPath, 'utf8').catch(() => ''),
  ]);
  const liveSession = sessions.get(dirent.name);
  const live = Boolean(liveSession?.process && liveSession.exitCode === undefined);
  const modifiedMs = Math.max(dirStat.mtimeMs, playlistStat?.mtimeMs || 0);
  const recordedAccessMs = Math.max(
    Number(liveSession?.lastAccessAt || 0),
    markerStat?.mtimeMs || 0,
  );
  // Producer writes are not viewer activity. Fall back to modification time
  // only for sessions created before access markers existed.
  const lastAccessMs = recordedAccessMs || modifiedMs;
  return {
    id: dirent.name,
    dirPath,
    sizeBytes: await directorySize(dirPath),
    modifiedMs,
    lastAccessMs,
    complete: playlist.includes('#EXT-X-ENDLIST'),
    live,
  };
};

export const cleanupTranscodeCache = async (overrides = {}) => {
  await fs.mkdir(TRANSCODE_ROOT, { recursive: true });
  const dirents = await fs.readdir(TRANSCODE_ROOT, { withFileTypes: true });
  const entries = (await Promise.all(dirents.map(readCacheEntry))).filter(Boolean);
  const plan = selectTranscodeEvictions(entries, overrides);

  for (const id of plan.stopIds) {
    await stopRemuxSession(id).catch(() => false);
  }

  const deletedIds = [];
  let deletedBytes = 0;
  for (const id of plan.deleteIds) {
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry || path.dirname(entry.dirPath) !== TRANSCODE_ROOT) continue;
    await fs.rm(entry.dirPath, { recursive: true, force: true });
    deletedIds.push(id);
    deletedBytes += entry.sizeBytes;
  }

  return {
    scanned: entries.length,
    deletedIds,
    stoppedIds: plan.stopIds.filter((id) => deletedIds.includes(id)),
    deletedBytes,
    retainedBytes: Math.max(0, entries.reduce((sum, entry) => sum + entry.sizeBytes, 0) - deletedBytes),
    overLimitBytes: plan.overLimitBytes,
    root: TRANSCODE_ROOT,
  };
};

export const startTranscodeCacheJanitor = async () => {
  const initial = await cleanupTranscodeCache();
  if (!cleanupTimer) {
    cleanupTimer = setInterval(() => {
      cleanupTranscodeCache().then((report) => {
        if (report.deletedIds.length) {
          console.log(
            `[transcode-cache] removed=${report.deletedIds.length} freedMB=${Math.round(report.deletedBytes / 1024 / 1024)}`,
          );
        }
      }).catch((error) => console.error('[transcode-cache] cleanup failed:', error.message));
    }, CLEANUP_INTERVAL_MS);
    cleanupTimer.unref?.();
  }
  return initial;
};

export const sessionPath = (sessionId, asset = 'index.m3u8') => {
  const id = safeId(sessionId);
  const name = path.basename(asset);
  return path.join(TRANSCODE_ROOT, id, name);
};

export default {
  ffprobe,
  decidePlaybackMode,
  buildFfmpegArgs,
  shouldReuseRemuxSession,
  activeEgressKbps,
  buildVideoArgs,
  detectVideoEncoder,
  getVideoTranscodePolicy,
  resolveVideoTranscodeCapability,
  isHdrVideo,
  isTenBitVideo,
  transcodeKbpsForHeight,
  planCodecTranscode,
  startRemuxSession,
  waitForPlaylist,
  getRemuxSession,
  stopRemuxSession,
  scheduleSupersededStop,
  cancelScheduledStop,
  SUPERSEDE_GRACE_MS,
  computeWriteSpeed,
  SLOW_WRITER_MIN_OBSERVE_MS,
  SLOW_WRITER_MIN_SPEED,
  isLinkExpiryDeath,
  REMUX_SEGMENT_SECONDS,
  selectSupersededRemuxes,
  isRemuxSessionLive,
  touchTranscodeSession,
  selectTranscodeEvictions,
  cleanupTranscodeCache,
  startTranscodeCacheJanitor,
  sessionPath,
};
