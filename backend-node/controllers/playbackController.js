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
import { ObjectId } from 'mongodb';
import { cached, getCache, setCache, CACHE_TTL } from '../config/redis.js';
import { isMediaType } from '../services/contentRef.js';
import * as tmdb from '../services/tmdb.js';
import { getStreamCandidates, getSubtitleCandidates } from '../services/addonClient.js';
import * as torbox from '../services/debrid/torbox.js';
import { DebridError } from '../services/debrid/torbox.js';
import { rankCandidates, normalizeCapabilities } from '../services/playback/sourceRanker.js';
import {
  ffprobe,
  decidePlaybackMode,
  startRemuxSession,
  waitForPlaylist,
  getRemuxSession,
  stopRemuxSession,
  selectSupersededRemuxes,
  isRemuxSessionLive,
  touchTranscodeSession,
  shouldReuseRemuxSession,
  sessionPath,
  extractSubtitleTrack,
  extractSubtitleTracks,
  subsPath,
  isConvertibleSubtitle,
  // Single definition on purpose: a redaction that exists in two places is one
  // that will be tightened in one of them and left leaking in the other.
  redactSecrets,
} from '../services/playback/remuxService.js';
import { getDecryptedKey } from '../services/providers/connectionStore.js';
import { computeOpenSubtitlesHash } from '../services/playback/opensubtitlesHash.js';
import * as opensubtitles from '../services/playback/opensubtitles.js';

const PROVIDER = 'torbox';
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
// A torrent's real codec never changes, so remember what ffprobe found. Without
// this, a release whose label omits the codec gets probed again on every single
// resolve, and sources already proven undecodable keep burning retry slots.
const PROBE_FACTS_TTL = 7 * 24 * 60 * 60;
const probeFactsKey = (infoHash) => `playback:probe:${String(infoHash).toLowerCase()}`;
// OpenSubtitles hash of the picked file. Cached so repeat resolves of the same
// source never re-issue the two range requests.
const fileHashKey = (infoHash) => `playback:oshash:${String(infoHash).toLowerCase()}`;

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

const waitForInitialBuffer = async (sessionId, seconds = 120, timeoutMs = 30000) => {
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
export const sanitizeCandidateForResponse = (candidate) => ({
  resolution: candidate.resolution || null,
  codec: candidate.codec || null,
  hdr: candidate.hdr || null,
  releaseSource: candidate.releaseSource || null,
  sizeBytes: candidate.sizeBytes || null,
  seeds: typeof candidate.seeds === 'number' ? candidate.seeds : null,
  cached: Boolean(candidate.cached),
  score: candidate.score ?? null,
  reasons: Array.isArray(candidate.reasons) ? candidate.reasons.slice(0, 6) : [],
  audioTracks: Array.isArray(candidate.audioTracks) ? candidate.audioTracks : [],
  subtitleTracks: Array.isArray(candidate.subtitleTracks) ? candidate.subtitleTracks : [],
});

/**
 * Same shape as above plus the infohash, which the client sends back as
 * `sourceToken` to force a specific release. The magnet still never leaves
 * the server.
 */
const sanitizeCandidateForPicker = (candidate) => ({
  ...sanitizeCandidateForResponse(candidate),
  sourceToken: String(candidate.infoHash || '').toLowerCase(),
  filename: candidate.filename || '',
  playable: candidate.playable !== false,
});

/* ------------------------------------------------------------------ resolve */

const parseResolveBody = (body = {}) => {
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

const findReusableRemuxSession = async (db, { userId, type, tmdbId, season, episode, infoHash, audioIndex, caps }) => {
  const session = await db.collection('playback_sessions').findOne(
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
      mode: 'remux',
      expiresAt: { $gt: new Date() },
    },
    { sort: { createdAt: -1 } },
  );
  if (!session?.playlistUrl) return null;

  try {
    const playlistPath = sessionPath(session.sessionId, 'index.m3u8');
    await fs.access(playlistPath);
    await fs.access(sessionPath(session.sessionId, 'init.mp4'));
    const playlist = await fs.readFile(playlistPath, 'utf8');
    const complete = playlist.includes('#EXT-X-ENDLIST');

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
      reusableProbe = await ffprobe(playlistPath);
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
      return null;
    }
    if (complete) return session;

    // Liveness: reject a known exited child immediately. After a Node restart
    // the child map is empty, so sample the playlist instead of trusting its
    // age: only an observably growing orphan still has a writer behind it.
    const live = getRemuxSession(session.sessionId);
    let playlistGrowing = false;
    if (!live) {
      const before = await fs.stat(playlistPath);
      await new Promise((resolve) => setTimeout(resolve, 750));
      const after = await fs.stat(playlistPath);
      playlistGrowing = after.size > before.size || after.mtimeMs > before.mtimeMs;
    }
    const reusable = shouldReuseRemuxSession({
      playlistComplete: complete,
      hasLiveSession: Boolean(live),
      liveExitCode: live?.exitCode,
      playlistGrowing,
    });
    if (!reusable) {
      // Dead writer: drop the record + partial segments (best effort) so the
      // next resolve starts a fresh remux instead of replaying the corpse.
      try {
        await db.collection('playback_sessions').deleteOne({ sessionId: session.sessionId });
        await fs.rm(sessionPath(session.sessionId), { recursive: true, force: true });
      } catch {
        // Cleanup failure must not block fresh playback.
      }
      return null;
    }
    return session;
  } catch {
    return null;
  }
};

const SESSION_STALE_MS = 15 * 1000;

export const resolvePlayback = async (req, res) => {
  const parsed = parseResolveBody(req.body);
  if (parsed.error) return fail(res, 400, parsed.error);

  const { type, tmdbId, season, episode, capabilities, sourceToken } = parsed;
  const caps = normalizeCapabilities(capabilities);
  // Preferred embedded audio track (ffprobe order); null = default first track.
  const audioIdx =
    Number.isInteger(parsed.audioIndex) && parsed.audioIndex >= 0 ? parsed.audioIndex : null;

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

  return withPlaybackResolveLock(resolveLockKey, async () => {
    const db = getDB();

    try {
    // 1. Catalog detail -> IMDb id + runtime (cached like the catalog routes).
    const detail = await cached(`catalog:detail:${type}:${tmdbId}`, CACHE_TTL.DETAIL, () =>
      tmdb.getDetail(type, tmdbId),
    );
    if (!detail) return fail(res, 404, 'Không tìm thấy nội dung');
    if (type === 'tv' && (season === null || episode === null)) {
      return fail(res, 400, 'Thiếu season/episode cho nội dung TV');
    }
    if (!detail.imdbId) {
      return fail(res, 404, 'Nội dung này thiếu IMDb ID nên không tra được nguồn');
    }
    const runtimeMinutes = Number(detail.runtime) > 0 ? Number(detail.runtime) : null;

    // 2. Caller-owned debrid key (never logged, never stored in the session).
    let debridKey;
    try {
      ({ key: debridKey } = await getDecryptedKey(db, req.user.userId, PROVIDER));
    } catch (error) {
      return fail(res, error.status || 500, error.message, error.code ? { code: error.code } : {});
    }

    // 3. Addon candidates keyed on the Stremio id.
    const { candidates, errors: addonErrors } = await getStreamCandidates({
      imdbId: detail.imdbId,
      mediaType: type,
      season,
      episode,
    });
    if (!candidates.length) {
      return fail(res, 404, 'Không tìm thấy nguồn phát cho nội dung này', {
        addonErrors: (addonErrors || []).slice(0, 5),
      });
    }

    // 4. Cached check (per-user entitlements; failure degrades to "not cached").
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

    // 5. Rank for this client.
    const { best, playable, rejected } = rankCandidates(enriched, caps, {
      runtimeMinutes,
      ...titleExpectation(detail),
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
      const defaultAudioIndex = (() => {
        if (!Array.isArray(candidate.audioTracks) || candidate.audioTracks.length === 0) return 0;
        const enIdx = candidate.audioTracks.findIndex((a) =>
          /^(en|eng|english)$/i.test(String(a.language || '').trim())
        );
        return enIdx >= 0 ? enIdx : 0;
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
      });
      if (reusable) {
        return res.json({
          success: true,
          data: {
            mode: 'remux',
            sessionId: reusable.sessionId,
            playlistUrl: reusable.playlistUrl,
            reason: 'Dùng lại phiên remux đang có',
            fileName: reusable.fileName || '',
            audioIndex: reusable.audioIndex ?? resolvedAudioForReuse,
            candidate: sanitizeCandidateForResponse(candidate),
          },
        });
      }
    }

    // 6. Try the top candidates until one yields a playable file.
    let lastError = null;
    for (const candidate of attempts) {
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
      let probe;
      try {
        probe = await ffprobe(inputUrl);
      } catch (error) {
        console.error(`resolvePlayback probe failed tmdb=${tmdbId} mode=retry`);
        lastError = error;
        continue;
      }
      // Record before acting on it: a rejection here is exactly the fact the
      // ranker needs next time so this source stops consuming a retry slot.
      await rememberProbeFacts(candidate.infoHash, probe);

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

      const decision = decidePlaybackMode(probe, caps, audioIdx);
      if (decision.mode === 'reject') {
        lastError = new Error(decision.reason);
        continue;
      }

      const sessionId = buildSessionId();

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
          fileName: file.name || '',
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
            fileName: file.name || '',
            audioIndex: decision.audioIndex ?? 0,
            candidate: sanitizeCandidateForResponse(candidate),
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
        await stopRemuxSession(staleId);
        console.warn(`remux ${staleId} bị thay thế bởi ${sessionId}; đã dừng để nhường băng thông`);
      }

      // Remux: ffmpeg reads the URL in-process; the URL itself stays in memory.
      try {
        const session = await startRemuxSession({
          sessionId,
          inputUrl,
          audioCopy: Boolean(decision.audioCopy),
          audioStreamIndex: decision.audioStreamIndex ?? null,
          audioChannels: decision.audioChannels ?? null,
        });
        await waitForPlaylist(session);
        // Do not hand the browser a live playlist that has only a few segments.
        // A short, verified head start absorbs normal upstream jitter. More
        // importantly, a source which stops producing segments is rejected here
        // instead of leaving the player spinning forever.
        const hasStartupBuffer = await waitForInitialBuffer(sessionId, 45, 45000);
        if (!hasStartupBuffer) {
          throw new Error('Nguồn remux không tạo đủ buffer khởi động trong 45 giây');
        }
      } catch (error) {
        // A failed candidate must not keep consuming bandwidth/CPU while the
        // resolver tries the next candidate.
        await stopRemuxSession(sessionId).catch(() => false);
        await fs.rm(sessionPath(sessionId), { recursive: true, force: true }).catch(() => {});
        console.error(`resolvePlayback remux failed session=${sessionId} tmdb=${tmdbId}`);
        lastError = error;
        continue;
      }

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
          fileName: file.name || '',
          videoHash: fileHash?.videoHash ?? null,
          videoSize: fileHash?.videoSize ?? null,
          runtimeMinutes,
          durationSeconds: probe.duration || null,
          videoCodec: probe.video?.codec || null,
          videoProfile: probe.video?.profile || '',
          videoHeight: probe.video?.height || null,
          videoFrameRate: probe.video?.frameRate || null,
          mode: 'remux',
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
          durationSeconds: probe.duration || null,
          reason: decision.reason,
          fileName: file.name || '',
          audioIndex: decision.audioIndex ?? 0,
          candidate: sanitizeCandidateForResponse(candidate),
        },
      });
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
    const detail = await cached(`catalog:detail:${type}:${tmdbId}`, CACHE_TTL.DETAIL, () =>
      tmdb.getDetail(type, tmdbId),
    );
    if (!detail) return fail(res, 404, 'Không tìm thấy nội dung');
    if (!detail.imdbId) return fail(res, 404, 'Nội dung này thiếu IMDb ID nên không tra được nguồn');
    const runtimeMinutes = Number(detail.runtime) > 0 ? Number(detail.runtime) : null;

    let debridKey;
    try {
      ({ key: debridKey } = await getDecryptedKey(db, req.user.userId, PROVIDER));
    } catch (error) {
      return fail(res, error.status || 500, error.message, error.code ? { code: error.code } : {});
    }

    const { candidates, errors: addonErrors } = await getStreamCandidates({
      imdbId: detail.imdbId,
      mediaType: type,
      season,
      episode,
    });
    if (!candidates.length) {
      return fail(res, 404, 'Không tìm thấy nguồn phát cho nội dung này', {
        addonErrors: (addonErrors || []).slice(0, 5),
      });
    }

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

    // Same overlay as resolve, so the picker's badges and its playable/rejected
    // split match what resolve will actually do.
    const enriched = await applyProbeFacts(
      candidates.map((c) => ({
        ...c,
        cached: Boolean(cachedMap[String(c.infoHash).toLowerCase()]),
      })),
    );

    const { playable, rejected } = rankCandidates(enriched, caps, {
      runtimeMinutes,
      ...titleExpectation(detail),
    });

    return res.json({
      success: true,
      data: {
        caps,
        sources: [
          ...playable.map(sanitizeCandidateForPicker),
          ...rejected.map(sanitizeCandidateForPicker),
        ].slice(0, 40),
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
    if (/eng|english/i.test(t)) return 'Tiếng Anh';
    if (/viet|vietnamese/i.test(t)) return 'Tiếng Việt';
    if (/orig|gốc|vo\b/i.test(t)) return 'Âm thanh gốc';
    return t;
  }
  if (code) return code.toUpperCase();
  // If no language metadata tag is present in media file:
  if (idx === 0) {
    return 'Âm thanh gốc (Tiếng Anh)';
  }
  return `Track ${idx + 1} (${String(a?.codec || 'Audio').toUpperCase()})`;
};

const audioInfo = (list) =>
  (list || []).map((a, idx) => ({
    language: a.language || (idx === 0 ? 'en' : ''),
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
    const detail = await cached(`catalog:detail:${type}:${tmdbId}`, CACHE_TTL.DETAIL, () =>
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
        label: `${subLabel(subtitle.language)} ${count}`,
        url: subtitle.url,
        ready: true,
        source: subtitle.source,
      };
    });

    const matchReport = await matchReportPromise;

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
    if (externalOnly) {
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

export const getPlaybackSession = async (req, res) => {
  try {
    const db = getDB();
    const session = await db.collection('playback_sessions').findOne({
      sessionId: String(req.params.sessionId || ''),
    });
    if (!session) return fail(res, 404, 'Không tìm thấy phiên phát');
    if (!isSessionOwner(session, req.user.userId)) {
      return fail(res, 403, 'Không có quyền truy cập phiên phát này');
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
      if (!state.exists || state.duration < 30) return fail(res, 409, 'Video vẫn đang được chuẩn bị');
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
    if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
      return fail(res, 410, 'Phiên phát đã hết hạn');
    }
    if (asset === 'index.m3u8') {
      const state = await readPlaylistState(sessionId);
      if (!state.exists || state.duration < 30) return fail(res, 409, 'Video vẫn đang được chuẩn bị');
      if (!state.ended) {
        const live = getRemuxSession(sessionId);
        const playlistPath = sessionPath(sessionId, 'index.m3u8');
        const ageMs = Date.now() - (await fs.stat(playlistPath)).mtimeMs;
        const writerDead = live ? live.exitCode !== undefined : ageMs > SESSION_STALE_MS;
        if (writerDead) {
          // Record why. Without this a failed session carries only a filename,
          // so a source that dies every time is indistinguishable from a
          // one-off and there is nothing to act on.
          await db.collection('playback_sessions').updateOne(
            { sessionId },
            {
              $set: {
                mode: 'failed',
                failureStage: 'remux',
                failureReason: live
                  ? `ffmpeg thoát với mã ${live.exitCode}`
                  : `không có tiến trình ffmpeg và playlist đứng yên ${Math.round(ageMs / 1000)}s`,
                failureExitCode: live ? live.exitCode : null,
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

export default {
  resolvePlayback,
  listPlaybackSources,
  getPlaybackSession,
  serveHlsAsset,
  pickBestFile,
};
