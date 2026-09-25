/**
 * Playback resolution + HLS asset serving.
 *
 * Pipeline for POST /api/playback/resolve:
 *   catalog detail (IMDb id) -> addon candidates -> TorBox cached check ->
 *   ranker -> prepare source -> ffprobe decision -> direct URL or remux HLS.
 *
 * Security invariants:
 *   - provider API keys and TorBox download URLs never reach logs, Mongo,
 *     Redis (outside TorBox's own short-lived per-user link cache), or the
 *     job queue. `playback_sessions` stores torrent/file ids only.
 *   - HLS assets are served only to the session owner (cross-user check on
 *     every request) with path-traversal-safe filenames.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { getDB } from '../config/database.js';
import { publicText, publicFileName } from '../services/publicVocabulary.js';
import { ObjectId } from 'mongodb';
import { cached, getCache, setCache, CACHE_TTL } from '../config/redis.js';
import { isMediaType } from '../services/contentRef.js';
import * as tmdb from '../services/tmdb.js';
import {
  getStreamCandidates,
  getSubtitleCandidates,
  subtitleVariantLabel,
  releaseNamesMatch,
} from '../services/addonClient.js';
import * as torbox from '../services/debrid/torbox.js';
import { DebridError } from '../services/debrid/torbox.js';
import { rankCandidates, normalizeCapabilities } from '../services/playback/sourceRanker.js';
import {
  ffprobe,
  decidePlaybackMode,
  preferredAudioIndex,
  presentationShiftMs,
  startRemuxSession,
  RemuxBusyError,
  probeSeekOrigin,
  seekOriginProbeEnabled,
  seekStartEnabled,
  spawnBeatsReuse,
  cachedSeekOrigin,
  waitForPlaylist,
  getRemuxSession,
  stopRemuxSession,
  scheduleSupersededStop,
  cancelScheduledStop,
  computeWriteSpeed,
  SLOW_WRITER_MIN_OBSERVE_MS,
  SLOW_WRITER_MIN_SPEED,
  isLinkExpiryDeath,
  REMUX_SEGMENT_SECONDS,
  activeEgressKbps,
  selectSupersededRemuxes,
  isRemuxSessionLive,
  touchTranscodeSession,
  shouldReuseRemuxSession,
  sessionPath,
  resolveVideoTranscodeCapability,
  extractSubtitleTrack,
  extractSubtitleTracks,
  REMUX_BUILD,
  subsPath,
  isConvertibleSubtitle,
  // Single definition on purpose: a redaction that exists in two places is one
  // that will be tightened in one of them and left leaking in the other.
  redactSecrets,
} from '../services/playback/remuxService.js';
import { isLanClient } from '../services/playback/clientNetwork.js';
import {
  buildRenditionId,
  readRenditionState,
  publishRendition,
  renditionPath,
  selectRenditionEvictions,
  RENDITION_MAX_BYTES,
} from '../services/playback/renditions.js';
import { setResolveStage, getResolveStage as readResolveStage } from '../services/playback/resolveProgress.js';
import { planAdmission } from '../services/playback/deliveryPlan.js';
import { getDecryptedKey } from '../services/providers/connectionStore.js';
import { computeOpenSubtitlesHash } from '../services/playback/opensubtitlesHash.js';
import * as opensubtitles from '../services/playback/opensubtitles.js';
import { resolveVimoSource, getVimoStreams } from '../services/playback/vimoClient.js';
import { resolveYaStreamSource } from '../services/playback/yastreamClient.js';

const PROVIDER = 'torbox';
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
// A torrent's real codec never changes, so remember what ffprobe found. Without
// this, a release whose label omits the codec gets probed again on every single
// resolve, and sources already proven undecodable keep burning retry slots.
const PROBE_FACTS_TTL = 7 * 24 * 60 * 60;
/**
 * The bytes behind an infohash are immutable, so this could live forever; a
 * week simply keeps the keyspace from growing without bound for films nobody
 * returns to.
 */
const PROBE_RESULT_TTL = 7 * 24 * 60 * 60;
/**
 * Shape version for the cached ffprobe result.
 *
 * Entries live for a week, so a field added to the probe is absent from every
 * entry already in Redis — and code reading it sees a legitimate-looking zero
 * rather than a miss. That is exactly how `presentationShiftMs` came back 0 for
 * a file with 2 B-frames: the cached probe predated `hasBFrames`. Bump this
 * whenever the probe shape changes; old entries are then simply never read.
 */
const PROBE_SHAPE_VERSION = 2;

const probeFactsKey = (infoHash) =>
  `playback:probe:v${PROBE_SHAPE_VERSION}:${String(infoHash).toLowerCase()}`;
/** Measured keyframe a given -ss lands on; the file never changes, so this keeps. */
const seekOriginKey = (infoHash, at) =>
  `playback:seekorigin:${String(infoHash).toLowerCase()}:${at}`;
/** Origins are keyed on immutable bytes: one success fixes every later seek. */
const SEEK_ORIGIN_TTL = 7 * 24 * 60 * 60;
// OpenSubtitles hash of the picked file. Cached so repeat resolves of the same
// source never re-issue the two range requests.
const fileHashKey = (infoHash) => `playback:oshash:${String(infoHash).toLowerCase()}`;
/** Clamp a lip-sync delay to the UI range [0, 1000] ms. */
const clampLipSyncMs = (v) => Math.min(1000, Math.max(0, Math.round(Number(v) || 0)));

/**
 * Full ffprobe output for one file inside one torrent.
 *
 * Keyed on the file, not the torrent: a release can hold several, and their
 * streams differ. The bytes behind an infohash never change, so what ffprobe
 * says about them cannot change either — a long TTL is safe, and the only thing
 * re-probing buys is another round trip to the debrid CDN for a moov atom that
 * was already read minutes ago.
 *
 * This is separate from probeFactsKey, which stores the handful of fields the
 * ranker filters on. That one exists to skip bad sources; this one exists to
 * skip the probe itself.
 */
const probeResultKey = (infoHash, fileId) =>
  `playback:probefull:v${PROBE_SHAPE_VERSION}:${String(infoHash).toLowerCase()}:${String(fileId ?? 'default')}`;

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ success: false, message, ...extra });

/**
 * Per-language verdict on whether a subtitle exists that was timed for the
 * exact file being played.
 *
 * `matched: false` is the useful case: it means every available subtitle in
 * that language was made for some other release, so drift is expected and no
 * constant delay will fully fix it. The player surfaces that instead of letting
 * the viewer discover it mid-film.
 *
 * Best-effort throughout: no API key, no hash, or an API outage all degrade to
 * `checked: false` and never block the subtitle list.
 */
const buildSubtitleMatchReport = async ({ imdbId, season, episode, moviehash }) => {
  if (!opensubtitles.isConfigured() || !moviehash || !imdbId) {
    return { checked: false, languages: {} };
  }

  try {
    const results = await opensubtitles.searchSubtitles({
      imdbId,
      season,
      episode,
      moviehash,
      languages: ['vi', 'en'],
    });

    const languages = {};
    for (const result of results) {
      const current = languages[result.language] || { matched: false, release: '', count: 0 };
      current.count += 1;
      // Report the release name of whichever entry we would actually pick.
      if (result.moviehashMatch && !current.matched) {
        current.matched = true;
        current.release = result.release;
      } else if (!current.release) {
        current.release = result.release;
      }
      languages[result.language] = current;
    }
    return { checked: true, languages };
  } catch (error) {
    console.warn(`opensubtitles match report bỏ qua: ${error.message}`);
    return { checked: false, languages: {} };
  }
};

const toObjectIdOrRaw = (userId) => {
  try {
    if (userId instanceof ObjectId) return userId;
    return new ObjectId(String(userId));
  } catch {
    return userId;
  }
};

export const buildSessionId = () => crypto.randomBytes(16).toString('hex');

// Serialise resolves for one viewer + title inside this backend process. React
// StrictMode deliberately remounts effects in development, so a ref owned by
// the component cannot deduplicate the two requests: the remount gets a fresh
// ref. Without a backend gate both requests pass the "reusable session" lookup
// before either has saved its session, then each starts an ffmpeg process.
const playbackResolveTails = new Map();

export const withPlaybackResolveLock = async (key, task) => {
  const lockKey = String(key || '');
  const previous = playbackResolveTails.get(lockKey) || Promise.resolve();
  let unlock;
  const gate = new Promise((resolve) => { unlock = resolve; });
  const tail = previous.catch(() => {}).then(() => gate);
  playbackResolveTails.set(lockKey, tail);

  // A failed earlier resolve must not poison the queue for the next attempt.
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    unlock();
    if (playbackResolveTails.get(lockKey) === tail) {
      playbackResolveTails.delete(lockKey);
    }
  }
};

/** Owner comparison that works for ObjectId and legacy string rows. */
export const isSessionOwner = (session, userId) =>
  String(session?.userIdStr ?? session?.userId ?? '') === String(userId ?? '');

/* ------------------------------------------------------------- file picking */

const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.webm', '.m2ts', '.ts', '.m4v'];

const lowerName = (file) => `${file?.path || ''}\n${file?.name || ''}`.toLowerCase();

const isVideoFile = (file) => {
  const name = lowerName(file);
  if (/sample|trailer|proof|rarbg|subpack|\.srt$|\.nfo$|\.jpg$|\.png$/.test(name)) return false;
  return VIDEO_EXTENSIONS.some((ext) => name.includes(ext));
};

/**
 * Pick the file to play. Episode-aware: when season/episode are known, a
 * filename carrying SxxEyy wins over a larger sibling (e.g. a season pack's
 * biggest file may be a different episode).
 */
export const pickBestFile = (files, { season = null, episode = null } = {}) => {
  const list = Array.isArray(files) ? files.filter((f) => f && f.fileId !== undefined) : [];
  if (!list.length) return null;

  const videos = list.filter(isVideoFile);
  const pool = videos.length ? videos : [...list].sort((a, b) => Number(b.size || 0) - Number(a.size || 0));

  if (Number.isInteger(season) && Number.isInteger(episode)) {
    const pad = (n) => String(n).padStart(2, '0');
    const patterns = [
      `s${pad(season)}e${pad(episode)}`,
      `${season}x${pad(episode)}`,
      `e${pad(episode)}`,
      `ep${pad(episode)}`,
      `tap ${episode}`,
    ];
    const matched = pool.filter((file) => {
      const name = lowerName(file);
      return patterns.some((p) => name.includes(p));
    });
    if (matched.length) {
      matched.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
      return matched[0];
    }
  }

  pool.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
  return pool[0];
};

/**
 * Titles a release name may legitimately use, so the ranker can reject torrents
 * an addon mapped to the wrong IMDb id. Scene releases almost always use the
 * original (English) title, but keep the localized one as an alias too.
 */
/**
 * Overlay previously probed facts onto candidates.
 *
 * Labels lie by omission: many releases never state the codec, so the ranker
 * scores them "codec unknown" and the loop only discovers HEVC after paying for
 * a TorBox link plus an ffprobe. Replaying what we already learned lets the
 * ranker reject those up front, which is what makes retries hit new sources.
 */
const applyProbeFacts = async (candidates) => {
  const facts = await Promise.all(
    candidates.map((candidate) => getCache(probeFactsKey(candidate.infoHash))),
  );
  return candidates.map((candidate, index) => {
    const fact = facts[index];
    if (!fact) return candidate;
  return {
    ...candidate,
    // Probed truth outranks the label for codec; keep label resolution as a
    // fallback since ffprobe only sees the one file we happened to pick.
    codec: fact.codec || candidate.codec,
    probedCodec: fact.codec || null,
    probedHeight: fact.height || null,
    probedFrameRate: fact.frameRate || null,
    // Probed audio/subtitle languages feed the player's track menu.
    audioTracks: Array.isArray(fact.audio) ? fact.audio : [],
    subtitleTracks: Array.isArray(fact.subtitles) ? fact.subtitles : [],
  };
  });
};

const rememberProbeFacts = (infoHash, probe) =>
  setCache(
    probeFactsKey(infoHash),
    {
      codec: probe?.video?.codec || null,
      height: probe?.video?.height || null,
      frameRate: probe?.video?.frameRate || null,
      hasBFrames: probe?.video?.hasBFrames ?? null,
      audio: (probe?.audio || []).map((a) => ({
        streamIndex: a.streamIndex,
        language: a.language || '',
        title: a.title || '',
        codec: a.codec || '',
        channels: a.channels || null,
      })),
      subtitles: (probe?.subtitles || []).map((s) => ({
        streamIndex: s.streamIndex,
        language: s.language || '',
        codec: s.codec || '',
      })),
    },
    PROBE_FACTS_TTL,
  );

/**
 * Seconds of playable content a new remux must have before the player starts.
 *
 * This used to be 45, and resolve blocked until it was reached — measured at
 * 23 s end to end, of which ~15 s was this wait and ~9 s was finding the source.
 * The viewer saw one unchanging line of text for the whole of it, which reads
 * as a hang rather than as work.
 *
 * 15 s is enough to absorb ordinary upstream jitter, and a source that stalls
 * after that is caught by the player's own no-progress detector, which exists
 * anyway and covers the case this wait was guarding against.
 */
const STARTUP_BUFFER_SECONDS = Math.max(
  4,
  Number(process.env.PLAYBACK_STARTUP_BUFFER_SECONDS) || 12,
);
const SEEK_STARTUP_BUFFER_SECONDS = Math.max(
  4,
  Number(process.env.PLAYBACK_SEEK_STARTUP_BUFFER_SECONDS) || 4,
);
export const SEEK_BUCKET_SECONDS = 300;
export const bucketStartAt = (sec = 0) => {
  const val = Number(sec);
  if (!Number.isFinite(val) || val <= 0) return 0;
  // Small offsets stay exact: bucketing them to 0 silently turns every early
  // resume/seek (< 1 bucket) into a from-start session — a duplicate remux,
  // a supersede of the playing session, and a lost position. Buckets only
  // pay off at/above the bucket size (shared mid-film seeks).
  if (val < SEEK_BUCKET_SECONDS) return Math.floor(val);
  return Math.floor(val / SEEK_BUCKET_SECONDS) * SEEK_BUCKET_SECONDS;
};

/**
 * How long resolve itself will wait before handing the session over.
 *
 * Past this it answers anyway, marked as still warming up, and the client polls
 * for the rest. Blocking the whole time is what made progress impossible to
 * show: with no session id in the client's hands there is nothing to ask about.
 */
const RESOLVE_BUFFER_WAIT_MS = 6000;

/**
 * The floor below which the HLS endpoint refuses to serve at all.
 *
 * This and the head start above have to be read together. They used to
 * disagree: the endpoint demanded 30 s while resolve handed the session over at
 * 15 s or less, so the player received a session whose every request answered
 * 409 and it sat at readyState 0 forever. A gate the producer cannot satisfy is
 * not a safety check, it is a deadlock, so the floor is derived from the target
 * rather than written down twice.
 */
const PLAYLIST_MIN_SECONDS = Math.min(8, STARTUP_BUFFER_SECONDS);
const SEEK_PLAYLIST_MIN_SECONDS = Math.min(4, SEEK_STARTUP_BUFFER_SECONDS);
const startupBufferForStartAt = (startAt = 0) => (startAt > 0 ? SEEK_STARTUP_BUFFER_SECONDS : STARTUP_BUFFER_SECONDS);
const playlistMinForStartAt = (startAt = 0) => (startAt > 0 ? SEEK_PLAYLIST_MIN_SECONDS : PLAYLIST_MIN_SECONDS);

const readPlaylistState = async (sessionId) => {
  try {
    const playlist = await fs.readFile(sessionPath(sessionId, 'index.m3u8'), 'utf8');
    const duration = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce(
      (sum, match) => sum + Number(match[1] || 0),
      0,
    );
    return { exists: true, ended: playlist.includes('#EXT-X-ENDLIST'), duration };
  } catch {
    return { exists: false, ended: false, duration: 0 };
  }
};

const playlistHasEnoughBuffer = async (sessionId, seconds = 120) => {
  const state = await readPlaylistState(sessionId);
  return state.exists && state.duration >= seconds;
};

const waitForInitialBuffer = async (sessionId, seconds = 120, timeoutMs = 15000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await playlistHasEnoughBuffer(sessionId, seconds)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
};

const titleExpectation = (detail) => ({
  expectedTitles: [detail?.englishTitle, detail?.originalTitle, detail?.title].filter(Boolean),
  expectedYear: Number.isInteger(detail?.year) ? detail.year : null,
});

/** Strip anything the UI must not see (magnets carry trackers; hashes add nothing). */
/** Production hides how the stream is made; development needs to see it. */
const PUBLIC_MODE = process.env.NODE_ENV === 'production';

export const sanitizeCandidateForResponse = (candidate) => ({
  // Resolution and HDR describe the picture a viewer is getting, so they stay.
  // Codec, release group, size, seed count and ranking notes describe HOW it
  // is obtained and encoded — that is the operator's business, and in
  // production it is one devtools tab away from every viewer.
  resolution: candidate.resolution || null,
  codec: PUBLIC_MODE ? null : (candidate.codec || null),
  hdr: candidate.hdr || null,
  releaseSource: PUBLIC_MODE ? null : (candidate.releaseSource || null),
  sizeBytes: PUBLIC_MODE ? null : (candidate.sizeBytes || null),
  seeds: PUBLIC_MODE ? null : (typeof candidate.seeds === 'number' ? candidate.seeds : null),
  cached: Boolean(candidate.cached),
  score: PUBLIC_MODE ? null : (candidate.score ?? null),
  reasons: PUBLIC_MODE ? [] : (Array.isArray(candidate.reasons) ? candidate.reasons.slice(0, 6) : []),
  audioTracks: Array.isArray(candidate.audioTracks) ? candidate.audioTracks : [],
  subtitleTracks: Array.isArray(candidate.subtitleTracks) ? candidate.subtitleTracks : [],
});

/**
 * The infohash the client echoes back as `sourceToken` to pin a release.
 * Every resolve success payload must carry it: without it the client
 * re-picks freely on each resume/recovery and can land on a different cut
 * of the same title (subs mistimed, different audio mix). The magnet still
 * never leaves the server.
 */
export const resolveSourceToken = (candidate) => String(candidate?.infoHash || '').toLowerCase();

/**
 * Same shape as above plus the infohash, which the client sends back as
 * `sourceToken` to force a specific release. The magnet still never leaves
 * the server. `origin` survives so the picker can badge non-torrent rows
 * (e.g. Vimo direct HLS).
 */
const sanitizeCandidateForPicker = (candidate) => ({
  ...sanitizeCandidateForResponse(candidate),
  sourceToken: String(candidate.infoHash || '').toLowerCase(),
  filename: candidate.filename || '',
  playable: candidate.playable !== false,
  origin: candidate.origin || null,
});

/* ------------------------------------------------------------------ resolve */

export const parseResolveBody = (body = {}) => {
  const type = String(body.type || body.mediaType || '').toLowerCase();
  const tmdbId = Number(body.tmdbId);
  const season = body.season === undefined || body.season === null || body.season === '' ? null : Number(body.season);
  const episode = body.episode === undefined || body.episode === null || body.episode === '' ? null : Number(body.episode);

  if (!isMediaType(type)) return { error: 'type phải là movie hoặc tv' };
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) return { error: 'tmdbId không hợp lệ' };
  if (type === 'tv' && (body.season !== undefined || body.episode !== undefined)) {
    if (!Number.isInteger(season) || season < 0) return { error: 'season không hợp lệ' };
    if (!Number.isInteger(episode) || episode <= 0) return { error: 'episode không hợp lệ' };
  }

  return {
    type,
    tmdbId,
    season: type === 'tv' ? season : null,
    episode: type === 'tv' ? episode : null,
    capabilities:
      body.capabilities && typeof body.capabilities === 'object'
        ? body.capabilities
        : body.caps && typeof body.caps === 'object'
          ? body.caps
          : {},
    // Manual pick: an infohash the user chose from GET /playback/sources.
    sourceToken:
      typeof body.sourceToken === 'string' && /^[a-f0-9]{40}$/i.test(body.sourceToken.trim())
        ? body.sourceToken.trim().toLowerCase()
        : null,
    // Manual Vimo pick: `vimo|<movie|series>|<vimoId>[:s:e]` from the picker.
    // Kept separate from sourceToken (infohash-only) so torrent lookups that
    // compare hashes never see it.
    vimoToken:
      typeof body.sourceToken === 'string' &&
      /^vimo\|(movie|series)\|[A-Za-z0-9_\-]+(?::\d+:\d+)?$/.test(body.sourceToken.trim())
        ? body.sourceToken.trim()
        : typeof body.vimoToken === 'string' &&
          /^vimo\|(movie|series)\|[A-Za-z0-9_\-]+(?::\d+:\d+)?$/.test(body.vimoToken.trim())
          ? body.vimoToken.trim()
          : null,
    yastreamToken:
      typeof body.yastreamToken === 'string' && /^yastream:.+$/.test(body.yastreamToken.trim())
        ? body.yastreamToken.trim()
        : typeof body.sourceToken === 'string' && /^yastream:.+$/.test(body.sourceToken.trim())
          ? body.sourceToken.trim()
          : null,
    playbackSessionId:
      typeof body.playbackSessionId === 'string' && /^[a-f0-9]{32}$/i.test(body.playbackSessionId.trim())
        ? body.playbackSessionId.trim().toLowerCase()
        : null,
    externalOnly: body.externalOnly === true,
    // Audio track choice: ffprobe-order index into the file's audio streams.
    // Invalid values fall back to the default (first) track downstream.
    audioIndex:
      body.audioIndex === undefined || body.audioIndex === null || body.audioIndex === ''
        ? null
        : Number(body.audioIndex),
    // Seek-start: begin the (re)mux at this many seconds into the file so a
    // far seek does not wait for the whole prefix. The client maps the
    // truncated 0-based timeline back with the returned startOffset.
    startAt:
      Number.isFinite(Number(body.startAt)) && Number(body.startAt) > 0
        ? Math.floor(Number(body.startAt))
        : 0,
  };
};

const saveSession = async (db, doc) => {
  const now = new Date();
  const record = {
    ...doc,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  };
  await db.collection('playback_sessions').insertOne(record);
  return record;
};

/**
 * Reuse overshoot tolerance, seconds. Measured keyframe origins routinely land
 * a fraction past a later request (178.178s vs a seek to 178s); rejecting them
 * spawns a duplicate writer for the same spot. Serves at most this far past
 * the request — the player starts at the session origin, off by a blink.
 */
export const REUSE_START_TOLERANCE_SECONDS = 2;
const findReusableRemuxSession = async (db, { userId, type, tmdbId, season, episode, infoHash, audioIndex, caps, startAt = 0 }) => {  const requestedStartAt = Number.isFinite(Number(startAt)) && Number(startAt) > 0 ? Math.floor(Number(startAt)) : 0;
  // A measured origin can overshoot a later request by milliseconds (session
  // at 178.178s vs a new seek to 178s): without tolerance every such seek
  // spawns a duplicate writer 2s apart and supersedes a healthy session.
  // From-start requests stay exact — missing the film's first seconds
  // silently is never acceptable.
  const startTolerance = requestedStartAt > 0 ? REUSE_START_TOLERANCE_SECONDS : 0;
  const sessions = await db.collection('playback_sessions').find(
    {
      userIdStr: String(userId),
      provider: PROVIDER,
      mediaType: type,
      tmdbId,
      season: type === 'tv' ? season : null,
      episode: type === 'tv' ? episode : null,
      infoHash: String(infoHash).toLowerCase(),
      // A remux bakes in ONE audio track: a different choice needs its own session.
      audioIndex: audioIndex ?? 0,
      // Candidate sessions started at or before requested offset (plus a
      // small overshoot tolerance for measured origins, see above).
      startAt: { $lte: requestedStartAt + startTolerance },
      mode: 'remux',
      expiresAt: { $gt: new Date() },
    },
    { sort: { startAt: -1, createdAt: -1 } },
  ).toArray();

  for (const session of sessions) {
    if (!session?.playlistUrl) continue;
    // Generation gate: bytes remuxed under an older recipe (missing stamp =
    // build 1) predate current compensation policy and must never be served
    // as fixed. Checked before the local ffprobe so stale sessions do not
    // even cost a probe; they age out through normal expiry.
    if (session.remuxBuild !== REMUX_BUILD) continue;

    try {
      const playlistPath = sessionPath(session.sessionId, 'index.m3u8');
      await fs.access(playlistPath);
      await fs.access(sessionPath(session.sessionId, 'init.mp4'));
      const playlist = await fs.readFile(playlistPath, 'utf8');
      const complete = playlist.includes('#EXT-X-ENDLIST');

      // Check if session has buffered enough to cover requestedStartAt + buffer
      const duration = [...playlist.matchAll(/#EXTINF:([\d.]+)/g)].reduce(
        (sum, match) => sum + Number(match[1] || 0),
        0,
      );
      const sessionHead = (session.startAt || 0) + duration;
      const minRequiredCoverage = requestedStartAt + (requestedStartAt > 0 ? SEEK_STARTUP_BUFFER_SECONDS : STARTUP_BUFFER_SECONDS);
      if (!complete && sessionHead < minRequiredCoverage) {
        // Behind the viewer — but only worth abandoning if a replacement could
        // start closer to where they are going. It cannot when truncated
        // sessions are off: every writer begins at 0, so walking away here
        // spawns an identical ffmpeg and throws this one's progress out. That
        // is one duplicate writer per seek, which is how a single viewer
        // filled the concurrency ceiling and got themselves a 503.
        const freshStartAt = seekStartEnabled() ? bucketStartAt(requestedStartAt) : 0;
        if (spawnBeatsReuse({
          sessionStartAt: session.startAt || 0,
          freshStartAt,
          // What this writer can actually serve right now. Handing back one
          // below the floor answers the player with 409s until it gives up.
          playableSeconds: duration,
          minPlayable: PLAYLIST_MIN_SECONDS,
        })) {
          continue;
        }
      }

    // Sessions created before frame-rate metadata existed can still be in the
    // cache for hours. Probe the local HLS once before reusing them; otherwise a
    // 143.98 fps HEVC session is returned forever and every recovery attempt
    // reconnects the browser to the exact same frozen stream.
    let reusableProbe;
    if (session.videoCodec) {
      reusableProbe = {
        format: 'hls',
        video: {
          codec: session.videoCodec,
          profile: session.videoProfile || '',
          height: session.videoHeight || null,
          frameRate: session.videoFrameRate || null,
        },
        audio: [],
      };
    } else {
      // Add a timeout to ffprobe for existing sessions to avoid kinking the UI
      reusableProbe = await Promise.race([
        ffprobe(playlistPath),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ffprobe timeout on reusable session')), 5000))
      ]).catch(err => {
        console.warn(`[playback] Reusable session ${session.sessionId} probe failed: ${err.message}`);
        return null;
      });
      
      if (!reusableProbe) {
         // Mark as failed to avoid retrying this session
         await db.collection('playback_sessions').updateOne(
           { sessionId: session.sessionId },
           { $set: { mode: 'failed', failureReason: 'probe_timeout_during_reuse', failedAt: new Date() } }
         );
         continue;
      }

      await db.collection('playback_sessions').updateOne(
        { sessionId: session.sessionId },
        {
          $set: {
            videoCodec: reusableProbe.video?.codec || null,
            videoProfile: reusableProbe.video?.profile || '',
            videoHeight: reusableProbe.video?.height || null,
            videoFrameRate: reusableProbe.video?.frameRate || null,
            updatedAt: new Date(),
          },
        },
      );
    }
      const compatibility = decidePlaybackMode(reusableProbe, caps, audioIndex);
      if (compatibility.mode === 'reject') {
        await db.collection('playback_sessions').updateOne(
          { sessionId: session.sessionId },
          {
            $set: {
              mode: 'failed',
              failureStage: 'compatibility',
              failureReason: compatibility.reason,
              failedAt: new Date(),
              updatedAt: new Date(),
            },
          },
        );
        continue;
      }
      if (complete) {
        // Back in use: revoke any pending grace-period stop.
        cancelScheduledStop(session.sessionId);
        // Eager publish: a finished session other viewers may already have
        // completed becomes tomorrow's instant start. Milliseconds of local
        // hardlinks; failures only skip sharing, never playback.
        if (session.renditionKey) {
          try {
            await enforceRenditionBudget(db);
            const pub = await publishRendition({
              renditionId: session.renditionKey,
              sessionId: session.sessionId,
            });
            if (pub.ok && !pub.dedup) {
              await db.collection('published_renditions').updateOne(
                { renditionId: session.renditionKey },
                {
                  $set: {
                    infoHash: session.infoHash || null,
                    fileId: session.fileId ?? null,
                    fileName: publicFileName(session.fileName || ''),
                    audioIndex: session.audioIndex ?? null,
                    bytes: pub.bytes,
                    segments: pub.segments,
                    durationSeconds: pub.duration,
                    lastAccessAt: new Date(),
                  },
                  $setOnInsert: { createdAt: new Date() },
                },
                { upsert: true },
              );
            } else if (pub.ok) {
              await touchPublishedRendition(db, session.renditionKey);
            }
          } catch {
            // Sharing is best effort.
          }
        }
        return session;
      }

      // Link-death fast path (incomplete sessions only: a complete playlist
      // needs no link at all). A writer that exited on an auth-flavoured error
      // was killed by its expired download URL, and the cached URL would kill
      // the next ffmpeg the same way — no sampling wait can fix that. Drop
      // everything and bust the link cache so the fresh attempt mints a new
      // link instead of replaying the corpse.
      {
        const writer = getRemuxSession(session.sessionId);
        if (isLinkExpiryDeath({ exitCode: writer?.exitCode, stderrTail: writer?.stderr })) {
          try {
            await stopRemuxSession(session.sessionId).catch(() => false);
            await db.collection('playback_sessions').deleteOne({ sessionId: session.sessionId });
            await fs.rm(sessionPath(session.sessionId), { recursive: true, force: true });
            await torbox.dropDownloadUrl({
              torrentId: session.torrentId,
              fileId: session.fileId,
              userId: String(userId),
            });
          } catch {
            // Cleanup failure must not block fresh playback.
          }
          continue;
        }
      }

      // Liveness: reject a known exited child immediately. After a Node restart
      // the child map is empty, so sample the playlist instead of trusting its
      // age: only an observably growing orphan still has a writer behind it.
      const live = getRemuxSession(session.sessionId);
      const before = await fs.stat(playlistPath);
      const playlistFresh = Date.now() - before.mtimeMs <= SESSION_STALE_MS;
      let playlistGrowing = false;
      // Orphans must prove that another writer still owns them. A known child is
      // sampled only after its playlist goes stale, which keeps healthy reuse fast
      // while catching ffmpeg processes whose upstream socket is wedged.
      if (!live || !playlistFresh) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        const after = await fs.stat(playlistPath);
        playlistGrowing = after.size > before.size || after.mtimeMs > before.mtimeMs;
      }
      const reusable = shouldReuseRemuxSession({
        playlistComplete: complete,
        hasLiveSession: Boolean(live),
        liveExitCode: live?.exitCode,
        playlistFresh,
        playlistGrowing,
      });
      if (!reusable) {
        // Dead writer: drop the record + partial segments (best effort) so the
        // next resolve starts a fresh remux instead of replaying the corpse.
        try {
          await stopRemuxSession(session.sessionId).catch(() => false);
          await db.collection('playback_sessions').deleteOne({ sessionId: session.sessionId });
          await fs.rm(sessionPath(session.sessionId), { recursive: true, force: true });
        } catch {
          // Cleanup failure must not block fresh playback.
        }
        continue;
      }
      cancelScheduledStop(session.sessionId);
      return session;
    } catch {
      continue;
    }
  }
  return null;
};

/**
 * Shared finished remuxes: lookup + budget, both DB-backed.
 *
 * findPublishedRendition re-verifies the bytes on disk (an evicted row's
 * leftovers must never be served). enforceRenditionBudget runs before each
 * publish so the store cannot grow without bound; expiry + LRU order comes
 * from the pure planner, which is unit-tested.
 */
const findPublishedRendition = async (db, renditionKey) => {
  if (!renditionKey) return null;
  const row = await db.collection('published_renditions').findOne({ renditionId: renditionKey });
  if (!row) return null;
  const state = await readRenditionState(renditionKey);
  if (!state.exists || !state.ended) {
    await db.collection('published_renditions').deleteOne({ renditionId: renditionKey }).catch(() => {});
    return null;
  }
  return row;
};

const enforceRenditionBudget = async (db) => {
  const rows = await db.collection('published_renditions').find({}).toArray();
  const { evict } = selectRenditionEvictions(
    rows.map((row) => ({
      renditionId: row.renditionId,
      bytes: row.bytes,
      lastAccessAtMs: row.lastAccessAt ? new Date(row.lastAccessAt).getTime() : 0,
    })),
    { now: Date.now(), maxBytes: RENDITION_MAX_BYTES },
  );
  for (const victim of evict) {
    try {
      await fs.rm(renditionPath(victim, '.'), { recursive: true, force: true });
      await db.collection('published_renditions').deleteOne({ renditionId: victim });
    } catch {
      // Best effort: a half-evicted row is reaped on the next pass.
    }
  }
  return evict.length;
};

const touchPublishedRendition = async (db, renditionKey) => {
  if (!renditionKey) return;
  await db.collection('published_renditions').updateOne(
    { renditionId: renditionKey },
    { $set: { lastAccessAt: new Date() } },
  ).catch(() => {});
};

const SESSION_STALE_MS = 30 * 60 * 1000; // 30 minutes instead of 15s

/**
 * Newborn-writer amnesty for the poll-driven hung-writer kills below.
 *
 * A writer that is still OPENING its input (TorBox TLS + first bytes take
 * seconds on a slow upstream) has no playlist yet, so its mtime age reads as
 * infinity and every freshness check fails: on a single snapshot it looks
 * exactly like a wedged writer. Killing it there creates a death loop —
 * every candidate's writer is executed seconds after spawn (empty stderr,
 * exit code null), resolve burns all attempts, and the pill grinds 1/5 →
 * 5/5 forever. Resolve's own gates (waitForPlaylist 30s, 8s floor 45s)
 * remain the authority on newborns; the poll killers only judge writers old
 * enough to have proven themselves.
 */
const YOUNG_WRITER_AMNESTY_MS = 45 * 1000;

const isYoungWriter = (live) => {
  if (!live || live.exitCode !== undefined) return false;
  const startedAtMs = live.startedAt ? new Date(live.startedAt).getTime() : NaN;
  return Number.isFinite(startedAtMs) && Date.now() - startedAtMs < YOUNG_WRITER_AMNESTY_MS;
};

/**
 * Serve a Vimo direct-HLS source (Vietnamese catalog, Vietsub streams).
 *
 * Unlike torrents this needs no TorBox, no probe and no ffmpeg: the addon's
 * media hosts allow CORS and hotlinking, so the browser plays the m3u8
 * directly through the existing `direct` mode. Either replays an explicit
 * picker token (`vimo|<movie|series>|<vimoId>[:s:e]`) or bridges a fresh
 * TMDB-detail lookup when the torrent flow has nothing.
 *
 * Returns `{ data }` on success, `{ empty: true }` when Vimo simply has no
 * such title, or `{ error }` when the token/stream is unusable.
 */
const serveVimoDirect = async ({ db, req, detail, type, tmdbId, season, episode, vimoToken = null }) => {
  let streamType = type === 'tv' ? 'series' : 'movie';
  let vimoId = null;
  let vimoName = '';
  let epSeason = season;
  let epEpisode = episode;

  if (vimoToken) {
    const match = /^vimo\|(movie|series)\|([A-Za-z0-9_\-]+)(?::(\d+):(\d+))?$/.exec(vimoToken);
    if (!match) return { error: 'Token Vimo không hợp lệ' };
    streamType = match[1];
    vimoId = match[2];
    if (match[3] !== undefined && match[4] !== undefined) {
      epSeason = Number(match[3]);
      epEpisode = Number(match[4]);
    }
  } else {
    if (!detail) return { empty: true };
    const found = await resolveVimoSource({ type, season, episode, detail });
    if (!found?.streams?.length) return { empty: true };
    vimoId = found.vimoId;
    vimoName = found.name || '';
  }

  const streams = await getVimoStreams({
    vimoId,
    type: streamType === 'series' ? 'tv' : 'movie',
    season: epSeason,
    episode: epEpisode,
  }).catch(() => []);
  const pick = streams[0];
  if (!pick?.url) {
    return vimoToken
      ? { error: 'Vimo hiện không có link cho tập này' }
      : { empty: true };
  }

  const sessionId = buildSessionId();
  const candidate = sanitizeCandidateForResponse({
    resolution: pick.resolution,
    codec: null,
    hdr: null,
    releaseSource: 'vimo • vietsub',
    sizeBytes: null,
    seeds: null,
    cached: false,
    score: null,
    reasons: [],
    audioTracks: [],
    subtitleTracks: [],
  });
  await saveSession(db, {
    sessionId,
    userId: toObjectIdOrRaw(req.user.userId),
    userIdStr: String(req.user.userId),
    provider: 'vimo',
    contentRef: detail?.contentRef,
    mediaType: type,
    tmdbId,
    season: type === 'tv' ? epSeason : null,
    episode: type === 'tv' ? epEpisode : null,
    imdbId: detail?.imdbId || null,
    infoHash: null,
    torrentId: null,
    fileId: null,
    fileName: pick.title || vimoName || '',
    videoHash: null,
    videoSize: null,
    mode: 'direct',
    audioIndex: 0,
    progress: 100,
    candidate,
  });
  return {
    data: {
      mode: 'direct',
      sessionId,
      url: pick.url,
      expiresIn: 900,
      fileName: pick.title || vimoName || '',
      audioIndex: 0,
      candidate,
      sourceToken: `vimo|${streamType}|${streamType === 'series' ? `${vimoId}:${epSeason}:${epEpisode}` : vimoId}`,
      vimo: { id: vimoId, name: vimoName || pick.title || '' },
    },
  };
};

export const resolvePlayback = async (req, res) => {
  const parsed = parseResolveBody(req.body);
  if (parsed.error) return fail(res, 400, parsed.error);

   const { type, tmdbId, season, episode, capabilities, sourceToken } = parsed;
   const vimoToken = parsed.vimoToken || null;
   const yastreamToken = parsed.yastreamToken || null;
   const requestedStartAt = Number.isFinite(parsed.startAt) && parsed.startAt > 0 ? Math.floor(parsed.startAt) : 0;
   // Kill switch for seek-started sessions (PLAYBACK_SEEK_START=off|0|false).
   // Off, every resolve remuxes from the beginning and the player seeks inside
   // it — the behaviour before truncated sessions existed, and the only path
   // with no keyframe snap: no ~1.6s gap between a session's real origin and
   // the offset it reports, so subtitles and the seek bar line up exactly.
   // The cost is what the feature bought: a far seek waits for the prefix.
   const startAt = seekStartEnabled() ? bucketStartAt(requestedStartAt) : 0;
   const caps = normalizeCapabilities(capabilities);
   // Preferred embedded audio track (ffprobe order); null = default first track.
   const audioIdx =
     Number.isInteger(parsed.audioIndex) && parsed.audioIndex >= 0 ? parsed.audioIndex : null;
   // Lip-sync compensation set on this device (setup-constant, persisted
   // in cine_player_prefs). The server bakes it into the remux as adelay
   // so every HLS segment carries the corrected audio timestamps.
   const lipSyncMs = clampLipSyncMs(Number(req.body?.lipSyncMs) || 0);

  // Client-generated progress key (see services/playback/resolveProgress.js).
  // Absent on old clients: stages are then simply not tracked.
  const resolveId =
    typeof req.body?.resolveId === 'string' ? req.body.resolveId : null;
  const stage = (name, detail) => setResolveStage(resolveId, name, detail);

  // One account can still deliberately change source/audio after the current
  // resolve finishes. Only concurrent work for the same title is queued; this
  // is the invariant needed to prevent duplicate remux writers.
  const resolveLockKey = [
    String(req.user?.userId || ''),
    type,
    tmdbId,
    type === 'tv' ? season : 'movie',
    type === 'tv' ? episode : 'full',
  ].join(':');

  // Seek-resolves must not queue behind the resolve they replace: each one
  // can take up to a minute (prepare + probe + head start), so serialising
  // them turns scrubbing into a traffic jam. They carry distinct startAt
  // values and the superseded-stop pass reaps the losers, so each runs on
  // its own key. (Same-millisecond double fires share a key and serialise —
  // the safe fallback.)
  const lockKey = startAt > 0 ? `${resolveLockKey}:seek:${startAt}:${Date.now()}` : resolveLockKey;
  const tResolveStart = Date.now();
  // Source-file A/V start offset (ms, audio minus video) from the winning
  // probe, for the summary line. Null until a probe with startTime lands.
  let lastAvSrcOffsetMs = null;
  // Per-file lip-sync compensation actually applied (adelay ms, 0 = none).
  let lastAudioDelayMs = 0;
  // Video fps as avg(r_frame): a wandering avg far from the container rate
  // smells like VFR/timestamp wobble, the drift class no constant delay fixes.
  let lastVfps = null;
  // Reorder lead handed to the client for subtitle lookups; logged so a
  // session that predates the field (or a reuse that lost it) is visible
  // as pshift=0 instead of looking like a mistimed subtitle file.
  let lastShiftMs = null;
  // Where a seek-started session's bytes really begin, once measured.
  let lastSeekOrigin = null;
  const outcome = await withPlaybackResolveLock(lockKey, async () => {
    const db = getDB();

    try {
    // 1. Catalog detail -> IMDb id + runtime (cached like the catalog routes).
    //
    // The :vN suffix is the shape of the normalized detail, and it has to be
    // bumped whenever a field is added to it. Entries live for a day, so a new
    // field silently reads as undefined on every title cached before the
    // deploy: adding originalLanguage without a bump left this route picking
    // the English audio track for a Japanese show for the rest of the day,
    // exactly the bug that field was added to fix.
    stage('detail');
    const detail = await cached(`catalog:detail:${type}:${tmdbId}:v3`, CACHE_TTL.DETAIL, () =>
      tmdb.getDetail(type, tmdbId),
    );
    if (!detail) return fail(res, 404, 'Không tìm thấy nội dung');
    if (type === 'tv' && (season === null || episode === null)) {
      return fail(res, 400, 'Thiếu season/episode cho nội dung TV');
    }
    const runtimeMinutes = Number(detail.runtime) > 0 ? Number(detail.runtime) : null;

    // 1b. Ưu tiên Vietsub TRỰC TIẾP lên đầu CHỈ DÀNH CHO phim Việt Nam
    const isVietnamese = detail.originalLanguage === 'vi';
    if (!sourceToken && !vimoToken && !yastreamToken && isVietnamese) {
      try {
        stage('vietsub-lookup');
        const vietsubData = await cached(`playback:vietsub:${type}:${tmdbId}:${season}:${episode}`, 12 * 60 * 60, async () => {
            const yaSource = await resolveYaStreamSource({ type, tmdbId, season, episode, detail }).catch(() => null);
            if (yaSource?.streams?.length > 0) return { yastream: yaSource, vimo: null };

            const vimoSource = await resolveVimoSource({ type, tmdbId, season, episode, detail }).catch(() => null);
            return { yastream: null, vimo: vimoSource };
        });

        if (vietsubData.yastream?.streams?.length > 0) {
            const first = vietsubData.yastream.streams[0];
            console.log(`[playback] Resolved via YaStream (Vietnamese Priority): ${tmdbId} ${detail.title}`);
            return res.json({
                success: true,
                data: {
                    mode: 'direct', 
                    sessionId: `yastream-${tmdbId}-${Date.now()}`,
                    url: first.url,
                    playlistUrl: first.url,
                    fileName: first.title || detail.title,
                    reason: 'YaStream Vietsub (Phim Việt)',
                    sourceToken: first.sourceToken, 
                    streams: vietsubData.yastream.streams,
                    skipProbe: true
                }
            });
        }
      } catch (e) {
        console.warn(`[playback] Vietnamese priority lookup failed: ${e.message}`);
      }
    }

    // Manual YaStream pick: direct HLS, bypassing all torrent/debrid/probe logic.
    if (yastreamToken) {
      stage('yastream');
      try {
        let yaSource = null;
        try {
          const vietsubData = await cached(
            `playback:vietsub:${type}:${tmdbId}:${season}:${episode}`,
            12 * 60 * 60,
            () => null,
          );
          if (vietsubData?.yastream?.streams?.length > 0) {
            yaSource = vietsubData.yastream;
          }
        } catch {}
        if (!yaSource) {
          yaSource = await resolveYaStreamSource({ type, tmdbId, season, episode, detail });
        }
        const pick = yaSource?.streams?.find(
          (s) => s.sourceToken === yastreamToken || s.id === yastreamToken
        ) || yaSource?.streams?.[0];
        if (pick?.url) {
          return res.json({
            success: true,
            data: {
              mode: 'direct',
              sessionId: `yastream-${tmdbId}-${Date.now()}`,
              url: pick.url,
              playlistUrl: pick.url,
              fileName: pick.title || detail.title,
              reason: 'YaStream Vietsub',
              sourceToken: pick.sourceToken,
              streams: yaSource.streams,
              skipProbe: true,
            },
          });
        }
      } catch (e) {
        console.warn(`[playback] Manual YaStream lookup failed: ${e.message}`);
      }
      return fail(res, 404, 'YaStream hiện không có link cho nội dung này');
    }

    // 1c. Manual Vimo pick: direct HLS, no debrid key / torrent / probe needed.
    if (vimoToken) {
      stage('vimo');
      const served = await serveVimoDirect({ db, req, detail, type, tmdbId, season, episode, vimoToken });
      if (served.error) return fail(res, 404, served.error);
      if (served.data) return res.json({ success: true, data: served.data });
      return fail(res, 404, 'Vimo hiện không có link cho nội dung này');
    }

    // 2. Caller-owned debrid key (never logged, never stored in the session).
    let debridKey;
    try {
      ({ key: debridKey } = await getDecryptedKey(db, req.user.userId, PROVIDER));
    } catch (error) {
      return fail(res, error.status || 500, error.message, error.code ? { code: error.code } : {});
    }

    // 3. Addon candidates keyed on the Stremio id.
    stage('sources');
    const { candidates, errors: addonErrors } = detail.imdbId 
      ? await getStreamCandidates({
          imdbId: detail.imdbId,
          mediaType: type,
          season,
          episode,
        })
      : { candidates: [], errors: [] };
      
    if (!candidates.length && !yastreamToken && !vimoToken) {
      // If we don't have torrents and we aren't already resolving a direct source,
      // check if we have any direct sources available before failing.
      const vietsubData = await cached(`playback:vietsub:${type}:${tmdbId}:${season}:${episode}`, 12 * 60 * 60, async () => {
          const yaSource = await resolveYaStreamSource({ type, tmdbId, season, episode, detail }).catch(() => null);
          const vimoSource = await resolveVimoSource({ type, tmdbId, season, episode, detail }).catch(() => null);
          return { yastream: yaSource, vimo: vimoSource };
      });

      if (!vietsubData.yastream?.streams?.length && !vietsubData.vimo) {
        return fail(res, 404, 'Phim này hiện chưa có nguồn phát trực tuyến hoặc chưa phát hành bản kỹ thuật số.');
      }
    }

    // 4. Cached check (per-user entitlements; failure degrades to "not cached").
    stage('rank');
    let cachedMap = {};
    try {
      cachedMap = await torbox.checkCached(
        debridKey,
        candidates.map((c) => c.infoHash),
      );
    } catch (error) {
      if (error instanceof DebridError && error.code === 'invalid_token') {
        return fail(res, 401, 'TorBox từ chối API key, vui lòng kết nối lại', { code: error.code });
      }
      cachedMap = {};
    }
    const enriched = await applyProbeFacts(
      candidates.map((c) => ({
        ...c,
        cached: Boolean(cachedMap[String(c.infoHash).toLowerCase()]),
      })),
    );

    // 5. Rank for this client. The codec-transcode capability is resolved once
    // (encoder detection caches after the first call): when the server can
    // re-encode, HEVC/AV1 the browser cannot decode stays playable instead of
    // being rejected outright.
    const videoTranscode = await resolveVideoTranscodeCapability();
    const { best, playable, rejected } = rankCandidates(enriched, caps, {
      runtimeMinutes,
      ...titleExpectation(detail),
      videoTranscode,
    });

    // 5b. Manual pick wins over the ranker: the user saw the badge list and
    // asked for that exact release, so try only it (still probed like any other).
    let attempts;
    if (sourceToken) {
      const picked = [...playable, ...rejected].find(
        (c) => String(c.infoHash).toLowerCase() === sourceToken,
      );
      if (!picked) {
        return fail(res, 404, 'Nguồn đã chọn không còn khả dụng, vui lòng tải lại danh sách');
      }
      // A manual pick may override quality/codec warnings, but never a wrong
      // film: that is a mismatch in the addon's data, not a user preference.
      if (picked.titleMatched === false) {
        return fail(res, 422, 'Nguồn đã chọn không khớp phim đang xem');
      }
      if (picked.playable === false) {
        return fail(res, 422, picked.reasons?.[0] || 'Nguồn đã chọn không phát được trên thiết bị này');
      }
      attempts = [picked];
    } else {
      if (!best || !playable.length) {
        return fail(res, 422, 'Không có nguồn nào phát được trên thiết bị này', {
          rejected: rejected.slice(0, 5).map(sanitizeCandidateForResponse),
        });
      }
      attempts = playable.slice(0, MAX_ATTEMPTS);
    }

    for (const candidate of attempts) {
      stage('reuse');
      // Default audio follows the film's own language (TMDB original_language
      // matched against ffprobe tags), English as fallback, first track last —
      // never blindly the first track or always English.
      const defaultAudioIndex = (() => {
        if (!Array.isArray(candidate.audioTracks) || candidate.audioTracks.length === 0) return 0;
        const preferred = preferredAudioIndex(candidate.audioTracks, detail?.originalLanguage);
        return preferred >= 0 ? preferred : 0;
      })();
      const resolvedAudioForReuse = audioIdx !== null ? audioIdx : defaultAudioIndex;

      const reusable = await findReusableRemuxSession(db, {
        userId: req.user.userId,
        type,
        tmdbId,
        season,
        episode,
        infoHash: candidate.infoHash,
        audioIndex: resolvedAudioForReuse,
        caps,
        // A seek-started session holds truncated bytes: check if an existing
        // session at or before requestedStartAt covers our target.
        startAt: requestedStartAt,
      });
      if (reusable) {
        // Sessions stored before this field existed would otherwise report no
        // correction at all, leaving their subtitles early for the session's
        // whole life. Fall back to the cached probe facts for the same file.
        let reuseShiftMs = Number(reusable.presentationShiftMs);
        if (!Number.isFinite(reuseShiftMs)) {
          const facts = await getCache(probeFactsKey(candidate.infoHash));
          reuseShiftMs = facts ? presentationShiftMs({ video: facts }) : 0;
        }
        lastShiftMs = reuseShiftMs;
        return res.json({
          success: true,
          data: {
            mode: 'remux',
            sessionId: reusable.sessionId,
            playlistUrl: reusable.playlistUrl,
            reason: publicText('Dùng lại phiên remux đang có', 'Đang phát'),
            fileName: publicFileName(reusable.fileName || ''),
            durationSeconds:
              typeof reusable.durationSeconds === 'number'
                ? reusable.durationSeconds
                : (reusable.runtimeMinutes ? Math.round(reusable.runtimeMinutes * 60) : null),
            audioIndex: reusable.audioIndex ?? resolvedAudioForReuse,
            candidate: sanitizeCandidateForResponse(candidate),
            sourceToken: resolveSourceToken(candidate),
            startOffset: reusable.startAt ?? 0,
            // Whether truncated sessions are offered at all. Without it the
            // client cannot tell a server that ignored the seek from one that
            // deliberately serves the whole film, and warns about the wrong one.
            seekStartSupported: seekStartEnabled(),
            // fMP4 starts its clock at the first decode timestamp, so the
            // picture sits this far ahead of source time. Subtitles are timed
            // against the source; the player subtracts it when looking cues up.
            presentationShiftMs: reuseShiftMs,
          },
        });
      }
    }

    // 6. Try the top candidates until one yields a playable file.
    let lastError = null;
    let attemptNo = 0;
    for (const candidate of attempts) {
      attemptNo += 1;
      const attemptTag = attempts.length > 1 ? `${attemptNo}/${attempts.length}` : '';
      stage('prepare', attemptTag);
      let prepared;
      try {
        prepared = await torbox.prepareSource(debridKey, {
          magnet: candidate.magnet,
          infoHash: candidate.infoHash,
        });
      } catch (error) {
        if (error instanceof DebridError && error.code === 'invalid_token') {
          return fail(res, 401, 'TorBox từ chối API key, vui lòng kết nối lại', { code: error.code });
        }
        lastError = error;
        continue;
      }

      if (prepared.state !== 'ready') {
        const sessionId = buildSessionId();
        await saveSession(db, {
          sessionId,
          userId: toObjectIdOrRaw(req.user.userId),
          userIdStr: String(req.user.userId),
          provider: PROVIDER,
          contentRef: detail.contentRef,
          mediaType: type,
          tmdbId,
          season,
          episode,
          imdbId: detail.imdbId,
          infoHash: String(candidate.infoHash).toLowerCase(),
          torrentId: prepared.torrentId ?? null,
          fileId: null,
          fileName: '',
          mode: 'downloading',
          progress: Number(prepared.progress || 0),
          candidate: sanitizeCandidateForResponse(candidate),
        });
        return res.status(202).json({
          success: true,
          message: 'Nguồn đang được tải về TorBox, vui lòng thử lại sau ít phút',
          data: {
            mode: 'downloading',
            sessionId,
            progress: Number(prepared.progress || 0),
            candidate: sanitizeCandidateForResponse(candidate),
          },
        });
      }

      const file = pickBestFile(prepared.files, { season, episode });
      if (!file) {
        lastError = new Error('Torrent không có file video nào');
        continue;
      }

      // 7. Resolve a fresh short-lived download URL (owner-only, never persisted).
      stage('link', attemptTag);
      let inputUrl;
      try {
        inputUrl = await torbox.getDownloadUrl(debridKey, {
          torrentId: prepared.torrentId,
          fileId: file.fileId,
          userId: String(req.user.userId),
        });
      } catch (error) {
        if (error instanceof DebridError && error.code === 'invalid_token') {
          return fail(res, 401, 'TorBox từ chối API key, vui lòng kết nối lại', { code: error.code });
        }
        lastError = error;
        continue;
      }

      // 8. ffprobe decides direct vs remux; a probe failure tries the next source.
      // Measured: a cold resolve spent ~8.7 s before ffmpeg even started, and
      // the addon lookup accounts for ~0.2 s of it. Most of the rest is this
      // call pulling a moov atom across the debrid CDN — work that is identical
      // every time for the same file.
      stage('probe', attemptTag);
      const probeCacheKey = probeResultKey(candidate.infoHash, file.fileId);
      let probe = await getCache(probeCacheKey);
      // Probes cached before startTime tracking predate the A/V-offset
      // telemetry and would keep it blind for the whole 7-day TTL: re-probe
      // once instead (the fresh doc then serves everyone).
      if (probe && probe.video && !('startTime' in probe.video)) probe = null;
      if (!probe) {
        try {
          probe = await ffprobe(inputUrl);
        } catch (error) {
          console.error(`resolvePlayback probe failed tmdb=${tmdbId} mode=retry`);
          lastError = error;
          continue;
        }
        await setCache(probeCacheKey, probe, PROBE_RESULT_TTL);
      }
      // Record before acting on it: a rejection here is exactly the fact the
      // ranker needs next time so this source stops consuming a retry slot.
      await rememberProbeFacts(candidate.infoHash, probe);
      // Declared here (loop-body scope) so the rendition key and the remux
      // below share one value.
      let audioDelayMs = 0;
      // How far this remux's clock leads source time (B-frame reorder delay).
      // Stored on the session so a later reuse can answer without the probe.
      const shiftMs = presentationShiftMs(probe);
      lastShiftMs = shiftMs;
      // Source-level A/V start offset (container audio delay): re-encoding
      // drops it, so a file whose audio starts far from its video plays with
      // a constant lip-sync error no client setting can explain. Audible in
      // logs, where "audio ahead on a strong machine" can finally be told
      // apart from weak decode — and applied just below, so the file's own
      // offset never reaches the viewer's per-device slider.
      {
        const vStart = Number(probe?.video?.startTime);
        const firstAudio = (probe?.audio || []).find((a) => Number.isFinite(Number(a?.startTime)));
        const aStart = firstAudio ? Number(firstAudio.startTime) : NaN;
        if (Number.isFinite(vStart) && Number.isFinite(aStart)) {
          const offMs = Math.round((aStart - vStart) * 1000);
          lastAvSrcOffsetMs = offMs;
          if (Math.abs(offMs) > 200) {
            console.warn(
              `[playback] source A/V start offset tmdb=${tmdbId} ${offMs}ms ` +
                `(audio ${offMs > 0 ? 'behind' : 'ahead of'} video in the file itself)`,
            );
          }
        }
        const frAvg = Number(probe?.video?.frameRate);
        const frR = Number(probe?.video?.frameRateR);
        if (Number.isFinite(frAvg)) {
          lastVfps = Number.isFinite(frR) && Math.abs(frR - frAvg) > 0.01
            ? `${frAvg.toFixed(2)}(${frR.toFixed(2)})`
            : frAvg.toFixed(2);
        }
      }
      // No per-file compensation: the offset logged just above is the source's
      // own, and ffmpeg carries it through the re-encode intact, so "correcting"
      // it here would delay the audio by that amount on every title muxed that
      // way. tests/remux-avsync-offset.test.mjs measures both directions.
      // Lip-sync for the viewer's own display chain stays client-side, in the
      // browser DelayNode behind "Trễ tiếng".
      lastAudioDelayMs = audioDelayMs;

      // Identify the exact file for subtitle matching. Best-effort: two 64 KiB
      // range requests, and a failure only costs hash-accurate subtitles — the
      // addon still answers on IMDb id alone.
      let fileHash = await getCache(fileHashKey(candidate.infoHash));
      if (!fileHash) {
        try {
          fileHash = await computeOpenSubtitlesHash(inputUrl, file.size);
          if (fileHash) {
            await setCache(fileHashKey(candidate.infoHash), fileHash, PROBE_FACTS_TTL);
          }
        } catch (error) {
          console.warn(`opensubtitles hash bỏ qua infoHash=${candidate.infoHash}: ${error.message}`);
          fileHash = null;
        }
      }

      // How the stream should be delivered, before deciding how to build it:
      // a LAN viewer gets the source untouched, a remote one gets whatever the
      // uplink can still afford, narrowed rather than refused where possible.
      const lan = isLanClient(req);
      const delivery = planAdmission({
        activeKbps: activeEgressKbps(),
        lan,
        sourceHeight: probe.video?.height ?? null,
        sourceKbps: probe.bitrate ? probe.bitrate / 1000 : null,
      });
      if (!delivery.admitted) {
        lastError = new Error(delivery.reason);
        continue;
      }

      const decision = decidePlaybackMode(probe, caps, audioIdx, {
        videoTranscode,
        // The film's own language for the default track (explicit picks win).
        contentLanguage: detail?.originalLanguage ?? null,
      });
      if (decision.mode === 'reject') {
        lastError = new Error(decision.reason);
        continue;
      }

      const sessionId = buildSessionId();

      // Direct play hands the client the upstream URL and never touches ffmpeg,
      // which means it also never touches the ladder or the egress budget. A
      // remote viewer the planner sized for transcoding must go through the
      // pipeline instead, or the whole accounting is a suggestion.
      const mustTranscode = delivery.mode === 'transcode';
      if (mustTranscode && decision.mode === 'direct') {
        decision.mode = 'remux';
        decision.videoCopy = false;
        decision.audioCopy = false;
        decision.reason = `${delivery.reason} (bỏ direct play để áp hạn mức)`;
      }

      // The ffmpeg-side video plan: normally the delivery ladder, overridden
      // by a codec-transcode decision (codec change + HDR tonemap). When both
      // apply, take the narrower of the two. Declared here so the
      // shared-rendition lookup below and startRemuxSession agree on it.
      // startAt rides along: a seek-started session holds truncated bytes.
      // codec rides along too: the ladder never carries it, but buildVideoArgs
      // needs the SOURCE codec for the HEVC hvc1 tag — without the tag ffmpeg
      // dies on HEVC-in-fMP4 ("Stream HEVC is not hvc1").
      const sourceCodec = probe.video?.codec ?? delivery.codec ?? null;
      let videoPlan = delivery.mode === 'transcode' || startAt > 0
        ? { ...delivery, codec: sourceCodec, startAt }
        : { ...delivery, codec: sourceCodec };

      // Where those bytes actually begin. `-ss` cannot cut mid-GOP, so ffmpeg
      // rewinds to a keyframe — and when the request lands on one, a whole GOP
      // further. Labelling the session with the position we ASKED for puts the
      // player's film clock out by that difference: subtitles early, seek bar
      // off, resume drifting. The real number is measured with a one-frame
      // probe below (cached per file+bucket), falling back to the request.
      let seekOrigin = startAt;
      if (decision.videoTranscode) {
        const ct = decision.videoTranscode;
        videoPlan = delivery.mode === 'transcode'
          ? {
            mode: 'transcode',
            // Source codec must survive the rebuild: buildVideoArgs needs it
            // for the HEVC hvc1 tag, and without the tag ffmpeg dies on
            // HEVC-in-fMP4 ("Stream HEVC is not hvc1"). The ladder never
            // carries it, so the probe is the fallback that always exists.
            codec: delivery.codec ?? sourceCodec,
            height: Math.min(ct.height, delivery.height),
            kbps: Math.min(ct.kbps, delivery.kbps),
            tonemap: ct.tonemap,
            tenBit: ct.tenBit,
            startAt,
          }
          : { ...ct, codec: ct.codec ?? delivery.codec ?? sourceCodec, startAt };
      }

      if (decision.mode === 'direct') {
        await saveSession(db, {
          sessionId,
          userId: toObjectIdOrRaw(req.user.userId),
          userIdStr: String(req.user.userId),
          provider: PROVIDER,
          contentRef: detail.contentRef,
          mediaType: type,
          tmdbId,
          season,
          episode,
          imdbId: detail.imdbId,
          infoHash: String(candidate.infoHash).toLowerCase(),
          torrentId: prepared.torrentId,
          fileId: file.fileId,
          fileName: publicFileName(file.name || ''),
          videoHash: fileHash?.videoHash ?? null,
          videoSize: fileHash?.videoSize ?? null,
          mode: 'direct',
          audioIndex: decision.audioIndex ?? 0,
          progress: 100,
          candidate: sanitizeCandidateForResponse(candidate),
        });
        return res.json({
          success: true,
          data: {
            mode: 'direct',
            sessionId,
            url: inputUrl,
            expiresIn: 900,
            fileName: publicFileName(file.name || ''),
            audioIndex: decision.audioIndex ?? 0,
            candidate: sanitizeCandidateForResponse(candidate),
            sourceToken: resolveSourceToken(candidate),
          },
        });
      }

      // A retry of the same title does not replace the previous remux, it adds
      // to it: the old ffmpeg keeps pulling the source at full speed until its
      // idle timeout expires ten minutes later. Two of those together were
      // measured saturating ~36 MB/s of link and disk, which stalls playback
      // and prompts another retry, so the failure compounded on itself.
      const priorFilter = {
        userIdStr: String(req.user.userId),
        mode: 'remux',
        contentRef: detail.contentRef,
        sessionId: { $ne: sessionId },
      };
      // Built conditionally: an undefined season would be matched as null and
      // quietly select nothing.
      if (season != null) priorFilter.season = season;
      if (episode != null) priorFilter.episode = episode;
      const prior = await db.collection('playback_sessions')
        .find(priorFilter)
        .project({ sessionId: 1, _id: 0 })
        .toArray();
      for (const staleId of selectSupersededRemuxes(
        prior.map((row) => row.sessionId), sessionId, isRemuxSessionLive,
      )) {
        // Grace, not instant kill: the viewer may flip back within seconds
        // (source comparison), and a live writer + partial playlist is worth
        // far more than the bandwidth saved by stopping it right now.
        scheduleSupersededStop(staleId);
        console.warn(`remux ${staleId} bị thay thế bởi ${sessionId}; giữ writer 90s phòng quay lại`);
      }

      // Duration honesty lives here (not below): the published short circuit
      // needs the full length too, and ffprobe of a slow upstream URL often
      // yields nothing — without the TMDB fallback the player would show the
      // live remux edge ("5:00" for a 100-minute film) instead of the length.
      const fullDurationSeconds =
        (Number.isFinite(probe.duration) && probe.duration > 0
          ? Math.round(probe.duration)
          : null)
        ?? (runtimeMinutes ? Math.round(runtimeMinutes * 60) : null);

      // Shared-rendition short circuit: an identical finished remux may
      // already be published (this viewer earlier, or another). Serve it
      // instantly — no ffmpeg, no buffer waits — instead of remuxing the
      // same bytes again. Per-user session record stays (ownership, history,
      // subtitles), only the bytes are shared.
      const renditionKey = buildRenditionId({
        infoHash: candidate.infoHash,
        fileId: file.fileId,
        audioStreamIndex: decision.audioStreamIndex ?? null,
        audioCopy: Boolean(decision.audioCopy),
        audioChannels: decision.audioChannels ?? null,
        audioDelayMs,
        video: videoPlan,
        segmentSeconds: REMUX_SEGMENT_SECONDS,
      });
      stage('published', attemptTag);
      const published = await findPublishedRendition(db, renditionKey);
      if (published) {
        const pubSessionId = buildSessionId();
        // Stable cross-viewer URL (not per-session): every viewer of these
        // exact bytes shares one CDN edge object. The per-user session record
        // still governs history, subtitles and polling.
        const stablePlaylistUrl = `/api/playback/hls/r/${renditionKey}/index.m3u8`;
        await saveSession(db, {
          sessionId: pubSessionId,
          userId: toObjectIdOrRaw(req.user.userId),
          userIdStr: String(req.user.userId),
          provider: PROVIDER,
          contentRef: detail.contentRef,
          mediaType: type,
          tmdbId,
          season,
          episode,
          imdbId: detail.imdbId,
          infoHash: String(candidate.infoHash).toLowerCase(),
          torrentId: prepared.torrentId,
          fileId: file.fileId,
          fileName: publicFileName(file.name || ''),
          videoHash: fileHash?.videoHash ?? null,
          videoSize: fileHash?.videoSize ?? null,
          runtimeMinutes,
          durationSeconds: fullDurationSeconds,
          videoCodec: probe.video?.codec || null,
          mode: 'remux',
          publishedRenditionId: renditionKey,
          renditionKey,
          remuxBuild: REMUX_BUILD,
          presentationShiftMs: shiftMs,
          audioIndex: decision.audioIndex ?? 0,
          progress: 100,
          playlistUrl: stablePlaylistUrl,
          candidate: sanitizeCandidateForResponse(candidate),
        });
        await touchPublishedRendition(db, renditionKey);
        return res.json({
          success: true,
          data: {
            mode: 'remux',
            sessionId: pubSessionId,
            playlistUrl: stablePlaylistUrl,
            durationSeconds: fullDurationSeconds,
            reason: publicText('Dùng lại bản remux hoàn chỉnh đã có', 'Đang phát'),
            fileName: publicFileName(file.name || ''),
            audioIndex: decision.audioIndex ?? 0,
            presentationShiftMs: shiftMs,
            seekStartSupported: seekStartEnabled(),
            published: true,
            candidate: sanitizeCandidateForResponse(candidate),
            sourceToken: resolveSourceToken(candidate),
          },
        });
      }

      // Remux: ffmpeg reads the URL in-process; the URL itself stays in memory.
      let warmingUp = false;
      try {
        stage('remux', attemptTag);
        const session = await startRemuxSession({
          sessionId,
          inputUrl,
          audioCopy: Boolean(decision.audioCopy),
          audioStreamIndex: decision.audioStreamIndex ?? null,
          audioChannels: decision.audioChannels ?? null,
          audioDelayMs,
          video: videoPlan,
        });
        // Where `-ss` really lands: a copied stream cannot be cut mid-GOP, so
        // the bytes begin at a keyframe at or before the request, and labelling
        // the session with the requested position puts every subtitle early by
        // the difference. Started BEFORE the playlist wait so the probe's
        // range-reads overlap the writer's own startup; answered from cache
        // afterwards on repeats (bytes are immutable). A miss, timeout, or
        // implausible answer keeps the requested position — status quo ante.
        let seekOriginPromise = null;
        if (startAt > 0 && seekOriginProbeEnabled()) {
          const originKey = seekOriginKey(candidate.infoHash, startAt);
          seekOriginPromise = (async () => {
            try {
              const hit = cachedSeekOrigin(await getCache(originKey));
              if (hit !== null) return hit;
            } catch {
              // Cache miss or Redis down: fall through to the probe.
            }
            const measured = await probeSeekOrigin(inputUrl, startAt);
            if (measured !== null) {
              try {
                await setCache(originKey, measured, SEEK_ORIGIN_TTL);
              } catch {
                // Caching is best effort; the measured value is still used.
              }
              return measured;
            }
            return null;
          })();
        }
        await waitForPlaylist(session);
        if (seekOriginPromise) {
          const measured = await seekOriginPromise;
          if (measured !== null) seekOrigin = measured;
          lastSeekOrigin = seekOrigin;
        }
        // Do not hand the browser a live playlist that has only a few segments.
        // A short, verified head start absorbs normal upstream jitter.
        stage('buffer', attemptTag);
        const playlistMinSeconds = playlistMinForStartAt(startAt);
        
        // Use a faster check first for production speed
        const servable = await waitForInitialBuffer(sessionId, 2, 8000); 
        if (!servable) {
            // Fallback to longer wait if 2s not ready
            const finalServable = await waitForInitialBuffer(sessionId, playlistMinSeconds, 12000);
            if (!finalServable) {
                throw new Error(`Nguồn remux quá chậm, không tạo nổi buffer trong 20 giây`);
            }
        }

        // Past the floor, the head start is worth having but not worth blocking
        // for: the client polls for the rest and shows real progress instead of
        // a frozen caption. Seek-started sessions only need one segment before
        // handoff: the viewer asked for a jump, so latency matters more than a
        // long head start.
        stage('warm', attemptTag);
        const startupBufferSeconds = startupBufferForStartAt(startAt);
        warmingUp = !(await waitForInitialBuffer(
          sessionId,
          startupBufferSeconds,
          startAt > 0 ? 1000 : RESOLVE_BUFFER_WAIT_MS,
        ));
        if (warmingUp) {
          // Slow-writer failover: handing over a producer below realtime
          // guarantees edge stalls forever (watch N minutes, stall at the
          // edge, wait, repeat). Reject the candidate while the loop can
          // still try the next source; the stage feed shows the switch.
          const writer = getRemuxSession(sessionId);
          const startedAtMs = writer?.startedAt
            ? new Date(writer.startedAt).getTime()
            : NaN;
          const edge = await readPlaylistState(sessionId);
          const speed = computeWriteSpeed({
            startedAtMs,
            bufferedSeconds: edge.duration,
          });
          if (
            speed
            && speed.elapsedMs >= SLOW_WRITER_MIN_OBSERVE_MS
            && speed.speed < SLOW_WRITER_MIN_SPEED
          ) {
            throw new Error(
              `Nguồn nhả chậm (${speed.speed.toFixed(2)}x sau ${Math.round(speed.elapsedMs / 1000)}s, cần ~1x để xem mượt)`,
            );
          }
        }
      } catch (error) {
        // A full box is not this candidate's fault: every other source would
        // hit the same ceiling, so walking the rest of the list just burns
        // TorBox calls to arrive at the same answer. Say so and stop.
        if (error instanceof RemuxBusyError || error?.code === 'REMUX_BUSY') {
          console.warn(`resolvePlayback busy tmdb=${tmdbId} limit=${error.limit ?? '?'}`);
          return fail(res, 503, error.message, { code: 'REMUX_BUSY', retryable: true });
        }
        // Read the corpse before stopping it: stopRemuxSession drops the map
        // entry, and with it the only record of HOW ffmpeg died.
        let linkDeath = false;
        try {
          const writer = getRemuxSession(sessionId);
          linkDeath = isLinkExpiryDeath({
            exitCode: writer?.exitCode,
            stderrTail: writer?.stderr,
          });
        } catch {
          linkDeath = false;
        }
        // A failed candidate must not keep consuming bandwidth/CPU while the
        // resolver tries the next candidate.
        await stopRemuxSession(sessionId).catch(() => false);
        await fs.rm(sessionPath(sessionId), { recursive: true, force: true }).catch(() => {});
        if (linkDeath) {
          // Same poison as the reuse fast path: bust the cached URL so the
          // next attempt (sibling candidate, or recovery's re-resolve seconds
          // from now) mints a fresh link instead of dying on the same one.
          // The raw ffmpeg error may echo the dead URL — a credential — so it
          // must not reach the client as lastError either.
          try {
            await torbox.dropDownloadUrl({
              torrentId: prepared.torrentId,
              fileId: file.fileId,
              userId: String(req.user.userId),
            });
          } catch {
            // Best effort.
          }
          console.error(`resolvePlayback link chết session=${sessionId} tmdb=${tmdbId}; đã bust cache link`);
          lastError = new Error('Link TorBox hết hạn giữa chừng, đã xin link mới cho lần thử sau');
        } else {
          console.error(`resolvePlayback remux failed session=${sessionId} tmdb=${tmdbId}`);
          lastError = error;
        }
        continue;
      }

      // Duration honesty: computed once above (shared with the published
      // short circuit) — ffprobe of a slow upstream URL often yields nothing.
      await saveSession(db, {
        sessionId,
        userId: toObjectIdOrRaw(req.user.userId),
        userIdStr: String(req.user.userId),
        provider: PROVIDER,
        contentRef: detail.contentRef,
        mediaType: type,
        tmdbId,
        season,
        episode,
        imdbId: detail.imdbId,
        infoHash: String(candidate.infoHash).toLowerCase(),
        torrentId: prepared.torrentId,
        fileId: file.fileId,
          fileName: publicFileName(file.name || ''),
          videoHash: fileHash?.videoHash ?? null,
          videoSize: fileHash?.videoSize ?? null,
          runtimeMinutes,
          durationSeconds: fullDurationSeconds,
          videoCodec: probe.video?.codec || null,
          videoProfile: probe.video?.profile || '',
          videoHeight: probe.video?.height || null,
          videoFrameRate: probe.video?.frameRate || null,
          mode: 'remux',
          renditionKey,
          remuxBuild: REMUX_BUILD,
          // Seek-start of this session's bytes (0 = from the beginning).
          // The MEASURED origin, not the requested one: reuse coverage maths
          // and the client's film clock both depend on it being the truth.
          startAt: seekOrigin,
          presentationShiftMs: shiftMs,
          audioIndex: decision.audioIndex ?? 0,
          progress: 100,
        playlistUrl: `/api/playback/hls/${sessionId}/index.m3u8`,
        candidate: sanitizeCandidateForResponse(candidate),
      });

      return res.json({
        success: true,
        data: {
          mode: 'remux',
          sessionId,
          playlistUrl: `/api/playback/hls/${sessionId}/index.m3u8`,
          durationSeconds: fullDurationSeconds,
          reason: publicText(decision.reason, 'Đang phát'),
          fileName: publicFileName(file.name || ''),
          audioIndex: decision.audioIndex ?? 0,
          // Truncated-timeline origin: the playlist covers [startOffset, end],
          // presented 0-based. 0 for ordinary from-the-start sessions.
          startOffset: seekOrigin,
          seekStartSupported: seekStartEnabled(),
          // See the reuse path above: the remux clock leads source time by the
          // B-frame reorder delay, and subtitle cues are in source time.
          presentationShiftMs: shiftMs,
          sourceToken: resolveSourceToken(candidate),
          // Still filling: the client polls the session and shows real progress
          // rather than guessing how long a frozen caption has left to run.
          warmingUp,
          startupTargetSeconds: STARTUP_BUFFER_SECONDS,
          candidate: sanitizeCandidateForResponse(candidate),
        },
      });
    }

    // 8b. Torrent flow exhausted: fall back to Vimo direct HLS (Vietsub)
    // rather than an error screen, when it carries this title.
      stage('vimo-fallback');
      const vimoFallback = await serveVimoDirect({ db, req, detail, type, tmdbId, season, episode });
      if (vimoFallback?.data) {
        // Silent wrong-source swap is worse than an error screen: Vimo carries
        // its own encode (different cut/timing, often hardcoded subs), so every
        // online sidecar timed for the TorBox release mistimes on it. Flag it
        // so the player says so instead of looking like mistimed subtitles.
        vimoFallback.data.fallbackSource = {
          kind: 'vimo',
          reason: publicText(String(lastError?.message || ''), 'Nguồn phát đang bận, vui lòng thử lại').slice(0, 160),
        };
        return res.json({ success: true, data: vimoFallback.data });
      }

    console.error(`resolvePlayback exhausted tmdb=${tmdbId} attempts=${attempts.length}`);
    // "Your browser cannot decode this" is not a gateway failure: 502 tells the
    // user to retry, but retrying cannot change a codec. 422 says the content is
    // unusable as-is, and the probed facts we just cached make the next attempt
    // skip these sources entirely.
    const unplayableClient = /không giải mã được|không có bản SDR|fps vượt ngưỡng/i.test(lastError?.message || '');
    return fail(
      res,
      unplayableClient ? 422 : 502,
      lastError?.message || 'Không chuẩn bị được nguồn phát, vui lòng thử lại',
      { exhausted: true },
    );
    } catch (error) {
      // Scrub: error text may echo upstream bodies but never our secrets (we never
      // interpolate keys or URLs into thrown messages).
      console.error(`resolvePlayback error tmdb=${tmdbId}:`, error.message);
      return fail(res, error.status || 500, error.message || 'Lỗi server');
    }
  });
  // One line per resolve with the full phase timeline: when a viewer reports
  // "it loads forever", this (plus their stage pill) names the slow leg
  // instead of another round of guessing.
  try {
    const entry = resolveId ? readResolveStage(resolveId) : null;
    const spans = (entry?.history || [])
      .map((h, i, all) => {
        const next = all[i + 1];
        const dt = ((next ? next.at : Date.now()) - h.at) / 1000;
        return `${h.stage}${h.detail ? `(${h.detail})` : ''}:${dt.toFixed(1)}s`;
      })
      .join(' ');
    console.info(
      `resolvePlayback ${type}:${tmdbId} total=${((Date.now() - tResolveStart) / 1000).toFixed(1)}s ` +
      `status=${res.statusCode} reqStart=${requestedStartAt}s bucket=${startAt}s ` +
      `token=${sourceToken ? 'pinned' : 'auto'} ` +
      `avosrc=${lastAvSrcOffsetMs === null ? '?' : `${lastAvSrcOffsetMs}ms`} ` +
      `adly=${lastAudioDelayMs}ms pshift=${lastShiftMs === null ? '?' : `${lastShiftMs}ms`} ` +
      `origin=${lastSeekOrigin === null ? '-' : `${lastSeekOrigin}s`} ` +
      `vfps=${lastVfps ?? '?'} ${spans}`,
    );
  } catch {
    // Logging must never break the response path.
  }
  return outcome;
};

/**
 * POST /api/playback/prewarm — cheap head start for the watch page.
 *
 * Runs resolve's expensive-but-idempotent prefix (candidates, cached check,
 * rank, prepare, download link, ffprobe, probe facts) WITHOUT spawning
 * ffmpeg or creating a session. Every result lands in the same caches
 * resolve reads, so the real resolve skips ~10 s of refetching. Fire-and-
 * forget from the detail page: even if the viewer never presses play, the
 * only cost is a few API calls and one probe read.
 */
export const prewarmPlayback = async (req, res) => {
  const parsed = parseResolveBody(req.body);
  if (parsed.error) return fail(res, 400, parsed.error);

  const { type, tmdbId, season, episode, capabilities } = parsed;
  const caps = normalizeCapabilities(capabilities);

  try {
    const db = getDB();
    const detail = await cached(`catalog:detail:${type}:${tmdbId}:v3`, CACHE_TTL.DETAIL, () =>
      tmdb.getDetail(type, tmdbId),
    );
    if (!detail?.imdbId) return fail(res, 404, 'Không tìm thấy nội dung');

    let debridKey;
    try {
      ({ key: debridKey } = await getDecryptedKey(db, req.user.userId, PROVIDER));
    } catch (error) {
      return fail(res, error.status || 500, error.message, error.code ? { code: error.code } : {});
    }

    const { candidates } = await getStreamCandidates({
      imdbId: detail.imdbId,
      mediaType: type,
      season,
      episode,
    });
    if (!candidates.length) return fail(res, 404, 'Không tìm thấy nguồn phát');

    let cachedMap = {};
    try {
      cachedMap = await torbox.checkCached(
        debridKey,
        candidates.map((c) => c.infoHash),
      );
    } catch {
      cachedMap = {};
    }
    const enriched = await applyProbeFacts(
      candidates.map((c) => ({
        ...c,
        cached: Boolean(cachedMap[String(c.infoHash).toLowerCase()]),
      })),
    );
    const runtimeMinutes = Number(detail.runtime) > 0 ? Number(detail.runtime) : null;
    const videoTranscode = await resolveVideoTranscodeCapability();
    const { best, playable } = rankCandidates(enriched, caps, {
      runtimeMinutes,
      ...titleExpectation(detail),
      videoTranscode,
    });
    const target = best ?? playable[0] ?? null;
    if (!target) return fail(res, 422, 'Không có nguồn nào phát được trên thiết bị này');

    let prepared;
    try {
      prepared = await torbox.prepareSource(debridKey, {
        magnet: target.magnet,
        infoHash: target.infoHash,
      });
    } catch (error) {
      return fail(res, 502, error.message || 'Không chuẩn bị được nguồn');
    }
    if (prepared.state !== 'ready') {
      // Still useful: the torrent is now added and TorBox is pulling it.
      return res.json({ success: true, data: { warmed: false, state: 'downloading' } });
    }

    const file = pickBestFile(prepared.files, { season, episode });
    if (!file) return fail(res, 422, 'Torrent không có file video nào');

    let inputUrl;
    try {
      inputUrl = await torbox.getDownloadUrl(debridKey, {
        torrentId: prepared.torrentId,
        fileId: file.fileId,
        userId: String(req.user.userId),
      });
    } catch (error) {
      return fail(res, 502, error.message || 'Không lấy được link tải');
    }

    const probeCacheKey = probeResultKey(target.infoHash, file.fileId);
    let probeHit = false;
    let probe = await getCache(probeCacheKey);
    if (probe) {
      probeHit = true;
    } else {
      try {
        probe = await ffprobe(inputUrl);
      } catch (error) {
        return fail(res, 502, 'Không đọc được thông tin file');
      }
      await setCache(probeCacheKey, probe, PROBE_RESULT_TTL);
    }
    await rememberProbeFacts(target.infoHash, probe);

    return res.json({
      success: true,
      data: { warmed: true, cached: Boolean(target.cached), probeHit },
    });
  } catch (error) {
    console.error(`prewarmPlayback error tmdb=${tmdbId}:`, error.message);
    return fail(res, error.status || 500, error.message || 'Lỗi server');
  }
};

/**
 * POST /api/playback/preload — speculative preloading for scrub points/timestamps.
 */
export const preloadPlayback = async (req, res) => {
  const { sessionId, timestamps, type, tmdbId, season, episode } = req.body || {};
  const db = getDB();

  try {
    let baseSession = null;
    if (sessionId) {
      baseSession = await db.collection('playback_sessions').findOne({
        sessionId: String(sessionId),
      });
      if (baseSession && !isSessionOwner(baseSession, req.user.userId)) {
        return fail(res, 403, 'Không có quyền truy cập phiên phát này');
      }
    }

    // Touch base session if provided
    if (baseSession?.infoHash) {
      await db.collection('playback_sessions').updateMany(
        {
          userIdStr: String(req.user.userId),
          infoHash: baseSession.infoHash,
          expiresAt: { $gt: new Date() },
        },
        { $set: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } },
      ).catch(() => {});
    }

    const points = Array.isArray(timestamps)
      ? timestamps.map((t) => Number(t)).filter((t) => Number.isFinite(t) && t >= 0)
      : [];
    const bucketedPoints = [...new Set(points.map((p) => bucketStartAt(p)))];

    return res.json({
      success: true,
      data: {
        preloaded: true,
        buckets: bucketedPoints,
        sessionId: baseSession?.sessionId || null,
      },
    });
  } catch (error) {
    console.error('preloadPlayback error:', error.message);
    return fail(res, error.status || 500, error.message || 'Lỗi server');
  }
};

/* ------------------------------------------------------------ source list */

/**
 * POST /api/playback/sources
 *
 * Return every ranked candidate (playable first, rejected flagged with the
 * reason) so the UI can show a quality picker instead of only the auto choice.
 * No TorBox link is created here: this is metadata plus the cached flag.
 */
export const listPlaybackSources = async (req, res) => {
  const parsed = parseResolveBody(req.body);
  if (parsed.error) return fail(res, 400, parsed.error);

  const { type, tmdbId, season, episode, capabilities } = parsed;
  const caps = normalizeCapabilities(capabilities);
  const db = getDB();

  try {
    const detail = await cached(`catalog:detail:${type}:${tmdbId}:v3`, CACHE_TTL.DETAIL, () =>
      tmdb.getDetail(type, tmdbId),
    );
    if (!detail) return fail(res, 404, 'Không tìm thấy nội dung');
    if (type === 'tv' && (season === null || episode === null)) {
      return fail(res, 400, 'Thiếu season/episode cho nội dung TV');
    }
    const runtimeMinutes = Number(detail.runtime) > 0 ? Number(detail.runtime) : null;

    let debridKey = null;
    let debridError = null;
    if (req.user?.userId) {
      try {
        ({ key: debridKey } = await getDecryptedKey(db, req.user.userId, PROVIDER));
      } catch (error) {
        debridError = error;
      }
    }

    let candidates = [];
    let addonErrors = [];
    if (detail.imdbId) {
      try {
        const streamRes = await getStreamCandidates({
          imdbId: detail.imdbId,
          mediaType: type,
          season,
          episode,
        });
        candidates = streamRes?.candidates || [];
        addonErrors = streamRes?.errors || [];
      } catch (err) {
        console.warn(`[listPlaybackSources] getStreamCandidates failed: ${err.message}`);
      }
    }

    let playable = [];
    let rejected = [];
    if (candidates.length > 0) {
      let cachedMap = {};
      if (debridKey) {
        try {
          cachedMap = await torbox.checkCached(
            debridKey,
            candidates.map((c) => c.infoHash),
          );
        } catch (error) {
          if (error instanceof DebridError && error.code === 'invalid_token') {
            return fail(res, 401, 'TorBox từ chối API key, vui lòng kết nối lại', { code: error.code });
          }
          cachedMap = {};
        }
      }

      // Same overlay as resolve, so the picker's badges and its playable/rejected
      // split match what resolve will actually do.
      const enriched = await applyProbeFacts(
        candidates.map((c) => ({
          ...c,
          cached: Boolean(cachedMap[String(c.infoHash).toLowerCase()]),
        })),
      );

      const ranked = rankCandidates(enriched, caps, {
        runtimeMinutes,
        ...titleExpectation(detail),
        videoTranscode: await resolveVideoTranscodeCapability(),
      });
      playable = ranked.playable;
      rejected = ranked.rejected;
    }

    // Vietsub sources (YaStream & Vimo)
    let yaEntries = [];
    let vimoEntry = null;
    try {
      let vietsubData = null;
      try {
        vietsubData = await cached(
          `playback:vietsub:${type}:${tmdbId}:${season}:${episode}`,
          12 * 60 * 60,
          async () => {
            const [yaSource, vimoSource] = await Promise.all([
              resolveYaStreamSource({ type, tmdbId, season, episode, detail }).catch(() => null),
              resolveVimoSource({ type, season, episode, detail }).catch(() => null),
            ]);
            return { yastream: yaSource, vimo: vimoSource };
          },
        );
      } catch {
        const [yaSource, vimoSource] = await Promise.all([
          resolveYaStreamSource({ type, tmdbId, season, episode, detail }).catch(() => null),
          resolveVimoSource({ type, season, episode, detail }).catch(() => null),
        ]);
        vietsubData = { yastream: yaSource, vimo: vimoSource };
      }

      if (vietsubData?.yastream?.streams?.length) {
        yaEntries = vietsubData.yastream.streams.map((s, idx) => ({
          ...sanitizeCandidateForPicker({
            resolution: s.resolution || null,
            codec: null,
            hdr: null,
            releaseSource: s.name || 'KKPhim / OPhim',
            sizeBytes: null,
            seeds: null,
            cached: false,
            playable: true,
            score: null,
            reasons: [],
            filename: s.title || s.name || `Server Vietsub #${idx + 1}`,
            infoHash: '',
          }),
          sourceToken: s.sourceToken,
          origin: 'yastream',
          releaseSource: s.name || 'KKPhim / OPhim',
          filename: s.title || s.name || `Server Vietsub #${idx + 1}`,
        }));
      }

      if (vietsubData?.vimo?.streams?.length) {
        const found = vietsubData.vimo;
        const first = found.streams[0];
        const streamId = type === 'tv' ? `${found.vimoId}:${season}:${episode}` : found.vimoId;
        vimoEntry = {
          ...sanitizeCandidateForPicker({
            resolution: first.resolution,
            codec: null,
            hdr: null,
            releaseSource: 'Vimo Vietsub',
            sizeBytes: null,
            seeds: null,
            cached: false,
            playable: true,
            score: null,
            reasons: [],
            filename: first.title || 'Vimo Direct',
            infoHash: '',
          }),
          sourceToken: `vimo|${type === 'tv' ? 'series' : 'movie'}|${streamId}`,
          origin: 'vimo',
          releaseSource: 'Vimo Vietsub',
          filename: first.title || 'Vimo Direct',
        };
      }
    } catch (e) {
      console.warn(`[listPlaybackSources] Vietsub lookup failed: ${e.message}`);
    }

    const allSources = [
      ...yaEntries,
      ...playable.map(sanitizeCandidateForPicker),
      ...(vimoEntry ? [vimoEntry] : []),
      ...rejected.map(sanitizeCandidateForPicker),
    ];

    if (allSources.length === 0) {
      if (debridError && candidates.length > 0) {
        return fail(res, debridError.status || 500, debridError.message, debridError.code ? { code: debridError.code } : {});
      }
      return fail(res, 404, 'Không tìm thấy nguồn phát cho nội dung này', {
        addonErrors: (addonErrors || []).slice(0, 5),
      });
    }

    return res.json({
      success: true,
      data: {
        caps,
        sources: allSources.slice(0, 40),
      },
    });
  } catch (error) {
    console.error(`listPlaybackSources error tmdb=${tmdbId}:`, error.message);
    return fail(res, error.status || 500, error.message || 'Lỗi server');
  }
};

/* -------------------------------------------------------------- subtitles */

const SUB_TOKEN_TTL = 24 * 60 * 60;
const SUB_INVENTORY_TTL = 12 * 60 * 60;
const SUB_JOB_TTL = 60 * 60;
const MAX_SUB_TRACKS = 6;
const subJobKey = (jobId) => `playback:subjob:${jobId}`;

const SUB_LANG_LABELS = {
  vie: 'Tiếng Việt', vit: 'Tiếng Việt', vi: 'Tiếng Việt',
  eng: 'English', en: 'English',
  jpn: '日本語', ja: '日本語',
  kor: '한국어', ko: '한국어',
  zho: '中文', chi: '中文', zh: '中文',
  tha: 'ไทย', th: 'ไทย',
  ind: 'Indonesia', id: 'Indonesia',
  msa: 'Melayu', ms: 'Melayu',
  fra: 'Français', fre: 'Français', fr: 'Français',
  deu: 'Deutsch', ger: 'Deutsch', de: 'Deutsch',
  spa: 'Español', es: 'Español',
  por: 'Português', pt: 'Português',
  ita: 'Italiano', it: 'Italiano',
  rus: 'Русский', ru: 'Русский',
  ara: 'العربية', ar: 'العربية',
  hin: 'हिन्दी', hi: 'हिन्दी',
  nld: 'Nederlands', nl: 'Nederlands',
  pol: 'Polski', pl: 'Polski',
  tur: 'Türkçe', tr: 'Türkçe',
};
const subLabel = (code) => {
  const key = String(code || '').toLowerCase();
  if (SUB_LANG_LABELS[key]) return SUB_LANG_LABELS[key];
  return code ? String(code).toUpperCase() : 'Phụ đề';
};
const subTokenKey = (token) => `playback:sub:${token}`;

const audioLabel = (a, idx = 0, total = 1) => {
  const code = String(a?.language || '').toLowerCase().trim();
  if (SUB_LANG_LABELS[code]) return SUB_LANG_LABELS[code];
  if (a?.title && a.title.trim()) {
    const t = a.title.trim();
    if (/\beng\b|english/i.test(t)) return 'Tiếng Anh';
    if (/viet|vietnamese/i.test(t)) return 'Tiếng Việt';
    if (/orig|gốc|vo\b/i.test(t)) return 'Âm thanh gốc';
    return t;
  }
  if (code) return code.toUpperCase();
  // No language metadata tag in the file: never claim a language. The first
  // track is the file's default, nothing more — a previous version labelled
  // it "Tiếng Anh" and poisoned every English check downstream.
  if (idx === 0) {
    return 'Âm thanh gốc';
  }
  return `Track ${idx + 1} (${String(a?.codec || 'Audio').toUpperCase()})`;
};

const audioInfo = (list) =>
  (list || []).map((a, idx) => ({
    language: a.language || '',
    label: audioLabel(a, idx, list?.length || 1),
    codec: a.codec || '',
    channels: a.channels || null,
  }));

/**
 * POST /api/playback/subtitles — audio/subtitle inventory of the picked
 * source, plus WebVTT sidecars extracted from embedded TEXT subtitle tracks.
 *
 * The player calls this lazily (subtitle menu opened), never on every
 * resolve. Extraction demuxes the remote file ONCE for all tracks in a single
 * ffmpeg pass and runs in the BACKGROUND: the response returns immediately
 * with the track list (ready:false while extracting) plus a jobId the player
 * polls. Completed inventories are cached per infohash, so repeat opens are
 * instant. Image subs (PGS/DVD) cannot become text without OCR and are
 * reported, not extracted.
 */
export const getPlaybackSubtitles = async (req, res) => {
  const parsed = parseResolveBody(req.body);
  if (parsed.error) return fail(res, 400, parsed.error);
  const {
    type,
    tmdbId,
    season,
    episode,
    capabilities,
    sourceToken,
    playbackSessionId,
    externalOnly,
  } = parsed;
  const db = getDB();

  try {
    const detail = await cached(`catalog:detail:${type}:${tmdbId}:v3`, CACHE_TTL.DETAIL, () =>
      tmdb.getDetail(type, tmdbId),
    );
    if (!detail) return fail(res, 404, 'Không tìm thấy nội dung');
    if (!detail.imdbId) {
      return fail(res, 404, 'Nội dung này thiếu IMDb ID nên không tra được nguồn');
    }

    // Load the session first: it carries the OpenSubtitles hash of the exact
    // file being played. Looking up by IMDb id alone returns subtitles for the
    // title timed to whatever release the uploader had, which is why sync used
    // to be a coin flip. The probe facts recorded during resolve also preserve
    // the audio and embedded-track inventory without another remote ffprobe.
    let probeFacts = null;
    let playbackSession = null;
    let ownedSession = null;
    if (playbackSessionId) {
      playbackSession = await db.collection('playback_sessions').findOne({
        sessionId: playbackSessionId,
      });
      if (
        playbackSession
        && playbackSession.infoHash
        && isSessionOwner(playbackSession, req.user.userId)
      ) {
        ownedSession = playbackSession;
        probeFacts = await getCache(probeFactsKey(playbackSession.infoHash));
      }
    }

    // Ask OpenSubtitles whether anything is timed for THIS file. The Stremio
    // addon cannot answer that (it ignores videoHash), so without this a
    // subtitle made for a CAM rip is offered exactly like a matching one and
    // the viewer only finds out by watching it drift.
    //
    // Started here rather than awaited later: it is an independent network
    // call, and running it after the addon fetch put two round trips in series
    // on the path that opens the subtitle menu.
    const matchReportPromise = buildSubtitleMatchReport({
      imdbId: detail.imdbId,
      season,
      episode,
      moviehash: ownedSession?.videoHash ?? null,
    });

    // External sidecars are tiny; fetch them before touching TorBox or starting
    // a second full-file ffmpeg scan.
    const externalResult = await getSubtitleCandidates({
      imdbId: detail.imdbId,
      mediaType: type,
      season,
      episode,
      videoHash: ownedSession?.videoHash ?? null,
      videoSize: ownedSession?.videoSize ?? null,
    }).catch((error) => ({ subtitles: [], errors: [error.message] }));
    const externalSubs = externalResult.subtitles || [];

    const embeddedTracks = [];
    // Derive from the ownership-checked session. It was previously read off the
    // raw lookup; harmless in practice because probeFacts is only populated for
    // an owned session, but that made the guard depend on a second variable
    // staying in sync rather than on the check itself.
    const infoHash = ownedSession?.infoHash ? String(ownedSession.infoHash).toLowerCase() : null;
    if (infoHash && Array.isArray(probeFacts?.subtitles)) {
      for (let i = 0; i < probeFacts.subtitles.length; i += 1) {
        const s = probeFacts.subtitles[i];
        if (!isConvertibleSubtitle(s.codec)) continue;
        const file = subsPath(`${infoHash}-${i}.vtt`);
        let ready = false;
        try {
          await fs.access(file);
          ready = true;
        } catch {
          ready = false;
        }
        if (ready) {
          const token = crypto.randomBytes(32).toString('hex');
          await setCache(subTokenKey(token), { file }, SUB_TOKEN_TTL);
          embeddedTracks.push({
            id: `${infoHash}:${i}`,
            language: s.language || '',
            label: `${subLabel(s.language)} (Gốc nhúng)`,
            url: `/api/playback/subtitles/vtt/${token}`,
            ready: true,
            source: 'embedded',
          });
        }
      }
    }

    const languageCounts = new Map();
    const externalTracks = externalSubs.map((subtitle) => {
      const count = (languageCounts.get(subtitle.language) || 0) + 1;
      languageCounts.set(subtitle.language, count);
      return {
        id: subtitle.id,
        language: subtitle.language,
        // Name the release it was timed for where the addon said so: three
        // Vietnamese sidecars for three different releases used to arrive as
        // "Tiếng Việt 1/2/3", so the one that matches the file was impossible
        // to find among the ones that are a second out.
        label: subtitleVariantLabel({
          base: subLabel(subtitle.language),
          name: subtitle.name,
          source: subtitle.source,
          index: count,
        }),
        url: subtitle.url,
        ready: true,
        source: subtitle.source,
      };
    });

    const matchReport = await matchReportPromise;

    // Per-track tick data: the menu can only mark a sidecar when its release
    // name matches the release the file-exact subtitle was made for, or the
    // playing file itself. Unnamed variants stay unticked — without a name
    // there is nothing to prove them by, and guessing would be worse.
    const normLang2 = (l) => String(l || '').toLowerCase().slice(0, 2);
    const verdictFor = (lang) => {
      const langs = matchReport?.languages || {};
      if (langs[lang]) return langs[lang];
      const hit = Object.entries(langs).find(([k]) => normLang2(k) === normLang2(lang));
      return hit ? hit[1] : null;
    };
    const playingFileName = ownedSession?.fileName || '';
    const trackMatched = (subtitle) => {
      const name = String(subtitle?.name || '').trim();
      if (!name) return false;
      if (playingFileName && releaseNamesMatch(name, playingFileName)) return true;
      const verdict = verdictFor(subtitle.language);
      if (verdict?.matched && verdict.release && releaseNamesMatch(name, verdict.release)) return true;
      return false;
    };
    // externalTracks was labelled before the verdict landed; join back to the
    // addon entries (which carry the release names) by id for the tick flag.
    const subsById = new Map((externalSubs || []).map((s) => [s.id, s]));
    for (const track of externalTracks) {
      if (trackMatched(subsById.get(track.id))) track.matched = true;
    }

    const combinedTracks = [...embeddedTracks, ...externalTracks];

    if (combinedTracks.length > 0) {
      const probeSummary = {
        audio: audioInfo(probeFacts?.audio),
        subtitles: (probeFacts?.subtitles || []).map((s) => ({
          language: s.language || '',
          label: subLabel(s.language),
          codec: s.codec || '',
          convertible: isConvertibleSubtitle(s.codec),
        })),
      };
      return res.json({
        success: true,
        data: {
          audio: probeSummary.audio,
          tracks: combinedTracks,
          note: embeddedTracks.length > 0
            ? 'Đã tích hợp phụ đề gốc nhúng trong file và phụ đề online'
            : 'Phụ đề online đã sẵn sàng; không cần quét toàn bộ file phim',
          jobId: null,
          probe: probeSummary,
          source: embeddedTracks.length > 0 ? 'mixed' : 'external',
          match: matchReport,
        },
      });
    }

    // Background prefetch asks only for the cheap external lookup. Embedded
    // extraction remains an explicit fallback when the user opens the menu.
    // The match verdict still rides along (the OpenSubtitles search is
    // quota-free) so the player can warn about expected drift before the menu
    // is ever opened.
    if (externalOnly) {
      const matchReport = await matchReportPromise;
      return res.json({
        success: true,
        data: {
          audio: [],
          tracks: [],
          note: 'Không tìm thấy phụ đề online; mở menu để thử track nhúng',
          jobId: null,
          probe: { audio: [], subtitles: [] },
          source: 'external',
          embeddedFallback: true,
          match: matchReport,
        },
      });
    }

    let debridKey;
    try {
      ({ key: debridKey } = await getDecryptedKey(db, req.user.userId, PROVIDER));
    } catch (error) {
      return fail(res, error.status || 500, error.message, error.code ? { code: error.code } : {});
    }

    const { candidates } = await getStreamCandidates({
      imdbId: detail.imdbId,
      mediaType: type,
      season,
      episode,
    });
    if (!candidates.length) return fail(res, 404, 'Không tìm thấy nguồn phát cho nội dung này');

    const runtimeMinutes = Number(detail.runtime) > 0 ? Number(detail.runtime) : null;
    const { best, playable, rejected } = rankCandidates(candidates, normalizeCapabilities(capabilities), {
      runtimeMinutes,
      ...titleExpectation(detail),
    });
    const pool = sourceToken
      ? [...playable, ...rejected].filter(
          (c) => String(c.infoHash).toLowerCase() === String(sourceToken).toLowerCase(),
        )
      : playable.slice(0, 3);
    if (!pool.length) {
      return fail(res, 404, 'Nguồn đã chọn không còn khả dụng, vui lòng tải lại danh sách');
    }

    let probe = null;
    let inputUrl = '';
    let pickedHash = '';
    for (const candidate of pool.slice(0, 3)) {
      try {
        const prepared = await torbox.prepareSource(debridKey, {
          magnet: candidate.magnet,
          infoHash: candidate.infoHash,
        });
        if (prepared.state !== 'ready') continue;
        const file = pickBestFile(prepared.files, { season, episode });
        if (!file) continue;
        inputUrl = await torbox.getDownloadUrl(debridKey, {
          torrentId: prepared.torrentId,
          fileId: file.fileId,
          userId: String(req.user.userId),
        });
        probe = await ffprobe(inputUrl);
        pickedHash = String(candidate.infoHash).toLowerCase();
        break;
      } catch {
        continue;
      }
    }
    if (!probe) return fail(res, 404, 'Không trích được thông tin file từ nguồn này');
    await rememberProbeFacts(pickedHash, probe);

    const audio = audioInfo(probe.audio);
    const hasSubs = (probe.subtitles || []).length > 0;
    const note = !hasSubs ? 'File này không nhúng phụ đề nào' : '';
    // Full probe picture so the menu can explain itself (e.g. "4 image
    // subs + 1 text sub" instead of a bare lonely track list).
    const probeSummary = {
      audio: audioInfo(probe.audio),
      subtitles: (probe.subtitles || []).map((s) => ({
        language: s.language || '',
        label: subLabel(s.language),
        codec: s.codec || '',
        convertible: isConvertibleSubtitle(s.codec),
      })),
    };
    const textSubs = (probe.subtitles || [])
      .filter((s) => isConvertibleSubtitle(s.codec))
      .slice(0, MAX_SUB_TRACKS);

    // Fast path: a finished inventory is cached per infohash — repeat opens
    // return instantly without touching TorBox or ffmpeg again. v2: response
    // shape carries the probe summary + per-track readiness.
    const inventoryKey = `playback:subs:v2:${pickedHash}`;
    const cachedInventory = await getCache(inventoryKey);
    if (cachedInventory?.done) {
      return res.json({
        success: true,
        data: {
          audio,
          tracks: cachedInventory.tracks,
          note,
          jobId: null,
          probe: cachedInventory.probe || probeSummary,
        },
      });
    }

    const minted = [];
    const pending = [];
    for (let i = 0; i < textSubs.length; i += 1) {
      const s = textSubs[i];
      const file = subsPath(`${pickedHash}-${i}.vtt`);
      let ready = false;
      let url = '';
      try {
        await fs.access(file);
        ready = true;
      } catch {
        ready = false;
      }
      if (ready) {
        const token = crypto.randomBytes(32).toString('hex');
        await setCache(subTokenKey(token), { file }, SUB_TOKEN_TTL);
        url = `/api/playback/subtitles/vtt/${token}`;
        minted.push({ id: `${pickedHash}:${i}`, language: s.language || '', label: subLabel(s.language), url, ready: true });
      } else {
        pending.push({ s, i, file });
      }
    }

    const tracks = [
      ...minted,
      ...pending.map(({ s, i }) => ({
        id: `${pickedHash}:${i}`,
        language: s.language || '',
        label: subLabel(s.language),
        url: '',
        ready: false,
      })),
    ];

    if (pending.length === 0) {
      await setCache(
        inventoryKey,
        { done: true, tracks: tracks.filter((t) => t.ready), probe: probeSummary },
        SUB_INVENTORY_TTL
      );
      return res.json({ success: true, data: { audio, tracks, note, jobId: null, probe: probeSummary } });
    }

    // Slow path (first open only): one background ffmpeg pass extracts every
    // pending track at once; the player polls the job until URLs land.
    const jobId = crypto.randomBytes(16).toString('hex');
    await setCache(subJobKey(jobId), { done: false, ready: {} }, SUB_JOB_TTL);
    await setCache(
      inventoryKey,
      { done: false, tracks, jobId, probe: probeSummary },
      SUB_INVENTORY_TTL
    );
    void runSubtitleExtractionJob({
      jobId,
      inventoryKey,
      pickedHash,
      inputUrl,
      probeSummary,
      pending: pending.map(({ s, i, file }) => ({ streamIndex: s.streamIndex, outPath: file, trackId: `${pickedHash}:${i}` })),
    });
    return res.json({
      success: true,
      data: {
        audio,
        tracks,
        jobId,
        probe: probeSummary,
        note: note || 'Trích lần đầu hơi lâu (đọc 1 lượt toàn file), các lần sau mở tức thì',
      },
    });
  } catch (error) {
    console.error(`getPlaybackSubtitles error tmdb=${tmdbId}:`, error.message);
    return fail(res, error.status || 500, error.message || 'Lỗi server');
  }
};

/** Background worker: single-pass extract, then publish URLs to job+inventory. */
async function runSubtitleExtractionJob({ jobId, inventoryKey, pickedHash, inputUrl, probeSummary, pending }) {
  const ready = {};
  const minted = [];
  const publish = async (trackId, outPath) => {
    const token = crypto.randomBytes(32).toString('hex');
    await setCache(subTokenKey(token), { file: outPath }, SUB_TOKEN_TTL);
    ready[trackId] = `/api/playback/subtitles/vtt/${token}`;
    const idx = Number(String(trackId).split(':').pop());
    minted.push({ idx, url: ready[trackId] });
  };
  try {
    const results = await extractSubtitleTracks(inputUrl, pending);
    for (const r of results) {
      if (r.ok) await publish(r.trackId, r.outPath);
    }
    // The batch is one ffmpeg process: a single bad input can abort it
    // before later tracks are written. Retry leftovers one by one so one
    // rotten track never starves the rest.
    const missing = pending.filter(
      (p) => !minted.some((m) => `${pickedHash}:${m.idx}` === p.trackId)
    );
    if (missing.length > 0 && missing.length < pending.length) {
      for (const p of missing) {
        try {
          await extractSubtitleTrack(inputUrl, p.streamIndex, p.outPath);
          await publish(p.trackId, p.outPath);
        } catch {
          // Track-level failure stays unready; the menu explains why.
        }
      }
    }
  } catch (error) {
    console.error(`subtitle extraction batch ${jobId} failed, retrying per-track:`, error.message);
    for (const p of pending) {
      try {
        await extractSubtitleTrack(inputUrl, p.streamIndex, p.outPath);
        await publish(p.trackId, p.outPath);
      } catch {
        // Track-level failure stays unready; the menu explains why.
      }
    }
  }
  try {
    const current = (await getCache(inventoryKey)) || { tracks: [] };
    const tracks = (current.tracks || []).map((t) => {
      const hit = minted.find((m) => `${pickedHash}:${m.idx}` === t.id);
      return hit ? { ...t, url: hit.url, ready: true } : t;
    });
    await setCache(inventoryKey, { done: true, tracks, probe: probeSummary || null }, SUB_INVENTORY_TTL);
    await setCache(subJobKey(jobId), { done: true, ready }, SUB_JOB_TTL);
  } catch (error) {
    console.error(`subtitle extraction job ${jobId} failed:`, error.message);
    await setCache(subJobKey(jobId), { done: true, ready: {}, error: 'Trích phụ đề thất bại' }, SUB_JOB_TTL);
  }
}

/** GET /api/playback/subtitles/job/:jobId — poll background extraction. */
export const getSubtitleJob = async (req, res) => {
  const jobId = String(req.params.jobId || '');
  if (!/^[a-f0-9]{32}$/.test(jobId)) return fail(res, 404, 'Không tìm thấy tác vụ');
  const job = await getCache(subJobKey(jobId));
  if (!job) return fail(res, 404, 'Tác vụ đã hết hạn');
  return res.json({ success: true, data: job });
};

/**
 * GET /api/playback/subtitles/vtt/:token — serves an extracted WebVTT file.
 * The 64-hex token is minted per extraction and kept server-side (same
 * capability pattern as the HLS query-token assets): no session needed, and
 * nothing guessable in the URL.
 */
export const serveSubtitleVtt = async (req, res) => {
  const token = String(req.params.token || '');
  if (!/^[a-f0-9]{64}$/.test(token)) return fail(res, 404, 'Không tìm thấy phụ đề');
  const entry = await getCache(subTokenKey(token));
  if (!entry?.file) return fail(res, 404, 'Liên kết phụ đề đã hết hạn');
  res.type('text/vtt; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=86400');
  return res.sendFile(entry.file);
};

/* ------------------------------------------------------------ session poll */

/**
 * GET /api/playback/resolve/:resolveId/stage — live phase of an in-flight
 * resolve, so the client shows measurement instead of guessing by elapsed
 * seconds. Unknown or rotted ids 404; the client keeps its last label.
 */
export const getResolveStage = async (req, res) => {
  // Progress polls hit one identical URL every 1.5s: without no-store the
  // browser revalidates (HTTP 304) and the pill can freeze on a stale phase.
  res.set('Cache-Control', 'no-store');
  const entry = readResolveStage(req.params?.resolveId);
  if (!entry) return fail(res, 404, 'Không có tiến trình nào');
  return res.json({ success: true, data: entry });
};

export const getPlaybackSession = async (req, res) => {
  // Same reason as the resolve-stage endpoint: one identical URL polled every
  // 2s must never be served from heuristic cache (HTTP 304 with a stale body).
  res.set('Cache-Control', 'no-store');
  try {
    const db = getDB();
    const session = await db.collection('playback_sessions').findOne({
      sessionId: String(req.params.sessionId || ''),
    });
    if (!session) return fail(res, 404, 'Không tìm thấy phiên phát');
    if (!isSessionOwner(session, req.user.userId)) {
      return fail(res, 403, 'Không có quyền truy cập phiên phát này');
    }

    // Touch nearby sessions for the same media/user so preloaded or adjacent seek buckets don't expire prematurely
    if (session.infoHash) {
      db.collection('playback_sessions')
        .updateMany(
          {
            userIdStr: String(req.user.userId),
            infoHash: session.infoHash,
            expiresAt: { $gt: new Date() },
          },
          { $set: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) } },
        )
        .catch(() => {});
    }

    // A remux still filling its head start reports how far along it is, so the
    // client can show progress that means something instead of a spinner.
    if (session.mode === 'remux') {
      // Published sessions point at immutable finished bytes: always ready,
      // no writer to health-check. If the bytes were evicted since resolve,
      // say so plainly and the client's stall recovery starts a fresh remux.
      if (session.publishedRenditionId) {
        const pub = await readRenditionState(session.publishedRenditionId);
        if (!pub.exists || !pub.ended) {
          return fail(res, 410, 'Bản hoàn chỉnh không còn, trình phát sẽ tự tạo lại');
        }
        const total = typeof session.durationSeconds === 'number'
          ? session.durationSeconds
          : Math.round(pub.duration || 0);
        await touchPublishedRendition(db, session.publishedRenditionId);
        return res.json({
          success: true,
          data: {
            sessionId: session.sessionId,
            mode: 'remux',
            bufferedSeconds: total,
            startupTargetSeconds: startupBufferForStartAt(session.startAt),
            ready: true,
            writerAlive: true,
            progress: 100,
          },
        });
      }
      const state = await readPlaylistState(session.sessionId);
      const buffered = Math.round(state.duration || 0);
      const live = getRemuxSession(session.sessionId);
      let ageMs = Number.POSITIVE_INFINITY;
      if (state.exists) {
        try {
          ageMs = Date.now() - (await fs.stat(sessionPath(session.sessionId, 'index.m3u8'))).mtimeMs;
        } catch {
          ageMs = Number.POSITIVE_INFINITY;
        }
      }
      // Newborn amnesty folded into the verdict itself (see helper): a live
      // writer younger than the amnesty reads as ALIVE, so neither the kill
      // below nor the client's recovery loop can trigger around a writer that
      // is still opening its input.
      const writerHealthy = state.ended || isYoungWriter(live) || (live
        ? shouldReuseRemuxSession({
            playlistComplete: false,
            hasLiveSession: true,
            liveExitCode: live.exitCode,
            playlistFresh: ageMs <= SESSION_STALE_MS,
            playlistGrowing: false,
          })
        : state.exists && ageMs <= SESSION_STALE_MS);
      if (!state.ended && !writerHealthy) {
        // An ffmpeg child may stay alive after its upstream socket wedges.
        // Killing it here ensures the client's automatic re-resolve can create
        // a genuinely new writer instead of reconnecting to frozen bytes.
        await stopRemuxSession(session.sessionId);
      }
      return res.json({
        success: true,
        data: {
          sessionId: session.sessionId,
          mode: 'remux',
          bufferedSeconds: buffered,
          startupTargetSeconds: startupBufferForStartAt(session.startAt),
          ready: state.ended || buffered >= startupBufferForStartAt(session.startAt),
          // Process existence is insufficient: a wedged ffmpeg process remains
          // alive while its playlist never changes.
          writerAlive: writerHealthy,
          progress: Math.min(100, Math.round((buffered / startupBufferForStartAt(session.startAt)) * 100)),
        },
      });
    }

    // Downloading sessions refresh progress from TorBox on poll.
    if (session.mode === 'downloading' && session.infoHash) {
      try {
        const { key } = await getDecryptedKey(db, req.user.userId, PROVIDER);
        const prepared = await torbox.prepareSource(key, {
          infoHash: session.infoHash,
          torrentId: session.torrentId ?? null,
        });
        const progress = Number(prepared.progress || 0);
        await db.collection('playback_sessions').updateOne(
          { sessionId: session.sessionId },
          { $set: { progress, updatedAt: new Date() } },
        );
        return res.json({
          success: true,
          data: {
            sessionId: session.sessionId,
            mode: prepared.state === 'ready' ? 'ready-to-resolve' : 'downloading',
            progress,
            message:
              prepared.state === 'ready'
                ? 'Đã tải xong, gọi lại resolve để phát'
                : 'Nguồn đang được tải về TorBox',
          },
        });
      } catch {
        // Fall through to the stored snapshot on transient errors.
      }
    }

    if (session.mode === 'preparing') {
      const state = await readPlaylistState(session.sessionId);
      const remux = getRemuxSession(session.sessionId);
      const running = remux?.exitCode === undefined;
      const progress = session.runtimeMinutes > 0 && state.duration > 0
        ? Math.min(99, Math.round((state.duration / (session.runtimeMinutes * 60)) * 100))
        : 0;

      if (state.ended) {
        await db.collection('playback_sessions').updateOne(
          { sessionId: session.sessionId },
          { $set: { mode: 'remux', progress: 100, updatedAt: new Date() } },
        );
        const { _id, userId, userIdStr, ...publicSession } = session;
        return res.json({
          success: true,
          data: {
            ...publicSession,
            mode: 'remux',
            progress: 100,
            ready: true,
          },
        });
      }

      if (!running && state.exists) {
        return fail(res, 502, 'ffmpeg dừng trước khi chuẩn bị xong video');
      }

      await db.collection('playback_sessions').updateOne(
        { sessionId: session.sessionId },
        { $set: { progress, updatedAt: new Date() } },
      );
      return res.json({
        success: true,
        data: {
          sessionId: session.sessionId,
          mode: 'preparing',
          progress,
          message: 'Đang chuẩn bị video',
        },
      });
    }

    if (session.mode === 'remux') {
      const state = await readPlaylistState(session.sessionId);
      if (!state.exists || state.duration < PLAYLIST_MIN_SECONDS) {
        return fail(res, 409, 'Video vẫn đang được chuẩn bị');
      }
    }

    const { _id, userId, userIdStr, ...publicSession } = session;
    return res.json({ success: true, data: publicSession });
  } catch (error) {
    console.error('getPlaybackSession error:', error.message);
    return fail(res, 500, 'Lỗi server');
  }
};

/* ------------------------------------------------------------ HLS serving */

const ASSET_CONTENT_TYPES = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
};

const isAllowedAsset = (asset) => {
  const name = String(asset || '');
  if (name === 'index.m3u8' || name === 'init.mp4') return true;
  return /^seg_\d+\.m4s$/.test(name);
};

export const serveHlsAsset = async (req, res) => {
  try {
    const sessionId = String(req.params.sessionId || '');
    const asset = String(req.params.asset || '');

    if (!isAllowedAsset(asset)) return fail(res, 404, 'Không tìm thấy tài nguyên');

    const db = getDB();
    const session = await db.collection('playback_sessions').findOne({ sessionId });
    if (!session) return fail(res, 404, 'Không tìm thấy phiên phát');
    if (!isSessionOwner(session, req.user.userId)) {
      return fail(res, 403, 'Không có quyền truy cập phiên phát này');
    }
    await touchTranscodeSession(sessionId);
    if (session.mode !== 'remux') {
      return fail(res, 404, 'Phiên phát này không có luồng HLS');
    }
    // Published sessions serve immutable finished bytes from the shared
    // store: no writer health checks, no readiness floor (a complete
    // playlist is servable by definition). Access bumps LRU on index reads.
    // (Deliberately before touchTranscodeSession: that would mkdir a junk
    // session dir for a session that owns no segments.)
    if (session.publishedRenditionId) {
      if (asset === 'index.m3u8') {
        await touchPublishedRendition(db, session.publishedRenditionId);
      }
      const filePath = path.resolve(renditionPath(session.publishedRenditionId, asset));
      try {
        await fs.stat(filePath);
      } catch {
        return fail(res, 404, 'Tài nguyên chưa sẵn sàng');
      }
      const ext = asset.endsWith('.m3u8') ? '.m3u8' : asset.endsWith('.m4s') ? '.m4s' : '.mp4';
      res.setHeader('Content-Type', ASSET_CONTENT_TYPES[ext]);
      res.setHeader(
        'Cache-Control',
        ext === '.m3u8' ? 'no-store' : 'public, max-age=86400, immutable',
      );
      return res.sendFile(filePath);
    }
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      return fail(res, 410, 'Phiên phát đã hết hạn');
    }
    if (asset === 'index.m3u8') {
      const state = await readPlaylistState(sessionId);
      if (!state.exists || state.duration < playlistMinForStartAt(session.startAt)) {
        return fail(res, 409, 'Video vẫn đang được chuẩn bị');
      }
      if (!state.ended) {
        const live = getRemuxSession(sessionId);
        const playlistPath = sessionPath(sessionId, 'index.m3u8');
        const ageMs = Date.now() - (await fs.stat(playlistPath)).mtimeMs;
        const writerHealthy = live
          ? shouldReuseRemuxSession({
              playlistComplete: false,
              hasLiveSession: true,
              liveExitCode: live.exitCode,
              playlistFresh: ageMs <= SESSION_STALE_MS,
              playlistGrowing: false,
            })
          : ageMs <= SESSION_STALE_MS;
        const writerDead = !writerHealthy;
        // Same newborn amnesty as the session poll: the first manifest fetch
        // can land seconds after spawn (early adopt), when no snapshot could
        // distinguish opening-input from wedged-socket. Killing here would
        // additionally mark the session failed and 410 the player.
        if (writerDead && !isYoungWriter(live)) {
          await stopRemuxSession(sessionId);
          // Record why. Without this a failed session carries only a filename,
          // so a source that dies every time is indistinguishable from a
          // one-off and there is nothing to act on.
          await db.collection('playback_sessions').updateOne(
            { sessionId },
            {
              $set: {
                mode: 'failed',
                failureStage: 'remux',
                failureReason: live?.exitCode !== undefined
                  ? `ffmpeg thoát với mã ${live.exitCode}`
                  : `playlist đứng yên ${Math.round(ageMs / 1000)}s; tiến trình remux không còn tạo dữ liệu`,
                failureExitCode: live?.exitCode ?? null,
                // ffmpeg echoes its input URL, which is a short-lived TorBox
                // download link. Redact before this reaches Mongo.
                failureDetail: redactSecrets(live?.stderr).slice(-800),
                failedAt: new Date(),
                updatedAt: new Date(),
              },
            },
          );
          return fail(res, 410, 'Luồng remux đã dừng; trình phát sẽ tự tạo lại');
        }
      }
    }

    // sendFile() throws on relative paths, which used to surface as a 500.
    const filePath = path.resolve(sessionPath(sessionId, asset));
    try {
      await fs.stat(filePath);
    } catch {
      return fail(res, 404, 'Tài nguyên chưa sẵn sàng');
    }

    const ext = asset.endsWith('.m3u8') ? '.m3u8' : asset.endsWith('.m4s') ? '.m4s' : '.mp4';
    res.setHeader('Content-Type', ASSET_CONTENT_TYPES[ext]);
    // Playlist must not be cached (live window); segments are immutable.
    res.setHeader(
      'Cache-Control',
      ext === '.m3u8' ? 'no-store' : 'public, max-age=86400, immutable',
    );
    return res.sendFile(filePath);
  } catch (error) {
    console.error('serveHlsAsset error:', error.message);
    return fail(res, 500, 'Lỗi server');
  }
};

/**
 * GET /api/playback/hls/r/:renditionId/:asset — stable cross-viewer URLs for
 * published (finished, immutable) renditions.
 *
 * Why a second URL shape when per-session URLs already serve the same bytes?
 * Session URLs embed a random sessionId, so every viewer is a cache MISS even
 * for identical bytes. These URLs depend only on content, so a CDN (or the
 * browser cache) shares one edge object across all viewers. Auth still runs
 * (media guard: Bearer header on MSE, ?access_token= on native), but the
 * bytes are identical for everyone holding a valid login, so sharing the
 * cached object is correct. Evicted renditions 404 and the player falls back
 * to a fresh remux through the normal recovery path.
 */
export const serveRenditionAsset = async (req, res) => {
  try {
    const renditionId = String(req.params.renditionId || '');
    const asset = String(req.params.asset || '');

    if (!isAllowedAsset(asset)) return fail(res, 404, 'Không tìm thấy tài nguyên');
    const state = await readRenditionState(renditionId);
    if (!state.exists || !state.ended) return fail(res, 404, 'Bản hoàn chỉnh không còn');
    if (asset === 'index.m3u8') {
      await touchPublishedRendition(getDB(), renditionId);
    }

    const filePath = path.resolve(renditionPath(renditionId, asset));
    try {
      await fs.stat(filePath);
    } catch {
      return fail(res, 404, 'Tài nguyên chưa sẵn sàng');
    }

    const ext = asset.endsWith('.m3u8') ? '.m3u8' : asset.endsWith('.m4s') ? '.m4s' : '.mp4';
    res.setHeader('Content-Type', ASSET_CONTENT_TYPES[ext]);
    res.setHeader(
      'Cache-Control',
      ext === '.m3u8' ? 'no-store' : 'public, max-age=31536000, immutable',
    );
    return res.sendFile(filePath);
  } catch (error) {
    console.error('serveRenditionAsset error:', error.message);
    return fail(res, 500, 'Lỗi server');
  }
};

export default {
  resolvePlayback,
  prewarmPlayback,
  listPlaybackSources,
  getResolveStage,
  getPlaybackSession,
  serveHlsAsset,
  serveRenditionAsset,
  pickBestFile,
};
