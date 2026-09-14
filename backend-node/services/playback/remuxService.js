import fs from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

// Must stay absolute: res.sendFile() rejects relative paths, and ffmpeg's
// -hls_fmp4_init_filename is resolved against the playlist's directory.
const TRANSCODE_ROOT = path.resolve(
  process.env.TRANSCODE_ROOT || path.join(process.cwd(), 'tmp', 'transcodes')
);
const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN || 'ffprobe';
const PROBE_TIMEOUT_MS = 20000;
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
  playlistGrowing = false,
} = {}) => {
  if (playlistComplete) return true;
  if (hasLiveSession) return liveExitCode === undefined;
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
          pixFmt: video.pix_fmt || '',
          colorTransfer: video.color_transfer || '',
          colorPrimaries: video.color_primaries || '',
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

export const decidePlaybackMode = (probe, caps = {}, preferredAudioIdx = null) => {
  if (!probe.video) {
    return { mode: 'reject', reason: 'Không tìm thấy video stream' };
  }

  const codec = probe.video.codec;
  if (codec === 'hevc' && !caps.hevc) return { mode: 'reject', reason: 'Client không giải mã được HEVC' };
  if (codec === 'av1' && !caps.av1) return { mode: 'reject', reason: 'Client không giải mã được AV1' };
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

export const buildFfmpegArgs = ({ inputUrl, outputDir, audioCopy = false, segmentSeconds = 4, audioStreamIndex = null, audioChannels = null }) => [
  '-hide_banner',
  '-loglevel',
  'warning',
  '-nostdin',
  '-fflags',
  '+genpts',
  '-i',
  inputUrl,
  '-map',
  '0:v:0',
  '-map',
  // Explicit choice maps that exact ffprobe stream; otherwise the default
  // first audio (legacy behavior, byte-identical command).
  Number.isInteger(audioStreamIndex) ? `0:${audioStreamIndex}?` : '0:a:0?',
  '-c:v',
  'copy',
  '-c:a',
  audioCopy ? 'copy' : 'aac',
  ...(audioCopy
    ? []
    : [
        '-b:a',
        '192k',
        // The fold already emits stereo, so `-ac 2` would be redundant beside it.
        ...(isSurroundLayout(audioChannels) ? ['-af', DIALOGUE_DOWNMIX] : ['-ac', '2']),
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

/**
 * ffmpeg echoes its input URL on every run, and that URL is a short-lived
 * TorBox download link tied to the user's account. Anything derived from its
 * stderr — a log line, a stored failure detail — has to go through this first.
 */
export const redactSecrets = (text) =>
  String(text || '')
    .replace(/https?:\/\/\S+/gi, '[url-đã-ẩn]')
    .replace(/(api[_-]?key|token|password)=\S+/gi, '$1=[đã-ẩn]');

export const startRemuxSession = async ({ sessionId, inputUrl, audioCopy = false, audioStreamIndex = null, audioChannels = null }) => {
  const id = safeId(sessionId);
  if (!id) throw new Error('sessionId không hợp lệ');

  const existing = sessions.get(id);
  if (existing?.process && !existing.process.killed) return existing;

  const outputDir = path.join(TRANSCODE_ROOT, id);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const args = buildFfmpegArgs({ inputUrl, outputDir, audioCopy, audioStreamIndex, audioChannels });
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
export const selectSupersededRemuxes = (priorSessionIds = [], keepSessionId, isLive = () => false) =>
  priorSessionIds.filter((id) => id && id !== keepSessionId && isLive(id));

/** Whether a session still has a running ffmpeg behind it. */
export const isRemuxSessionLive = (sessionId) => {
  const session = sessions.get(safeId(sessionId));
  return Boolean(session?.process && session.exitCode === undefined);
};

export const stopRemuxSession = async (sessionId) => {
  const id = safeId(sessionId);
  const session = sessions.get(id);
  if (!session) return false;
  if (session.process && !session.process.killed && session.exitCode === undefined) {
    session.process.kill('SIGTERM');
  }
  sessions.delete(id);
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
  startRemuxSession,
  waitForPlaylist,
  getRemuxSession,
  stopRemuxSession,
  selectSupersededRemuxes,
  isRemuxSessionLive,
  touchTranscodeSession,
  selectTranscodeEvictions,
  cleanupTranscodeCache,
  startTranscodeCacheJanitor,
  sessionPath,
};
