/**
 * Stremio-protocol addon client.
 *
 * An addon answers `/stream/{type}/{id}.json` with candidate sources for a
 * title. We only read; we never host an addon, and we never proxy an addon
 * response straight to the browser.
 *
 * Addon URLs are configuration, but configuration a user can set, so every
 * request goes through safeFetch (see services/security/safeFetch.js). A magnet
 * or infohash from an addon is untrusted input and is validated here before it
 * can reach the debrid layer.
 */

import { cached, CACHE_TTL } from '../config/redis.js';
import { safeFetchJson, assertUrlShape } from './security/safeFetch.js';
import { parseContentRef } from './contentRef.js';

const REQUEST_TIMEOUT_MS = 10000;
const STREAM_CACHE_TTL = 600; // addon answers churn as torrents die
const MAX_STREAMS_PER_ADDON = 60;
const SUBTITLE_REQUEST_TIMEOUT_MS = 5000;
const SUBTITLE_CACHE_TTL = 6 * 60 * 60;
const MAX_SUBTITLES = 24;
const DEFAULT_SUBTITLE_ADDON = 'https://opensubtitles-v3.strem.io';

/** Configured addon base URLs, comma-separated. */
const configuredAddons = () =>
  (process.env.STREMIO_ADDONS || '')
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);

/** Subtitle addons are independent from torrent-source addons. */
const configuredSubtitleAddons = () =>
  (process.env.STREMIO_SUBTITLE_ADDONS || DEFAULT_SUBTITLE_ADDON)
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);

export const isAddonConfigured = () => configuredAddons().length > 0;

/** Reject a bad addon URL at boot rather than on a user's first play. */
export const validateAddonConfig = () => {
  const problems = [];
  for (const addon of [...configuredAddons(), ...configuredSubtitleAddons()]) {
    try {
      assertUrlShape(addon);
    } catch (error) {
      problems.push(`${addon}: ${error.message}`);
    }
  }
  return problems;
};

/* --------------------------------------------------------------- subtitles */

const subtitlePriority = (language) => {
  const lang = String(language || '').toLowerCase();
  if (lang === 'vi' || lang === 'vie' || lang === 'vit') return 0;
  if (lang === 'en' || lang === 'eng') return 1;
  return 2;
};

/**
 * Reduce an addon subtitle response to HTTPS sidecars safe for the browser.
 * Vietnamese tracks sort first so the player can auto-select immediately.
 */
export const normalizeSubtitlePayload = (payload, addonHost = 'subtitle-addon') => {
  const seen = new Set();
  return (Array.isArray(payload?.subtitles) ? payload.subtitles : [])
    .slice(0, 100)
    .map((subtitle, index) => {
      let parsed;
      try {
        parsed = new URL(String(subtitle?.url || ''));
      } catch {
        return null;
      }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
      const language = String(subtitle?.lang || subtitle?.language || '').trim().toLowerCase();
      if (!language || seen.has(parsed.href)) return null;
      seen.add(parsed.href);
      return {
        id: `external:${addonHost}:${String(subtitle?.id || index).slice(0, 100)}`,
        language,
        url: parsed.href,
        source: addonHost,
      };
    })
    .filter(Boolean)
    .sort((a, b) => subtitlePriority(a.language) - subtitlePriority(b.language))
    .slice(0, MAX_SUBTITLES);
};

/**
 * Stremio carries optional lookup hints in an extra path segment:
 *   /subtitles/{type}/{id}/videoHash=..&videoSize=...json
 * OpenSubtitles-backed addons use them to return the subtitle matched to that
 * exact file instead of a generic one for the title, which is the difference
 * between reliably-synced and coin-flip timing.
 */
export const buildSubtitleUrl = (addon, type, id, { videoHash, videoSize } = {}) => {
  const base = `${addon}/subtitles/${type}/${encodeURIComponent(id)}`;
  const extra = [];
  if (videoHash) extra.push(`videoHash=${encodeURIComponent(videoHash)}`);
  if (Number.isFinite(Number(videoSize)) && Number(videoSize) > 0) {
    extra.push(`videoSize=${Number(videoSize)}`);
  }
  return extra.length ? `${base}/${extra.join('&')}.json` : `${base}.json`;
};

const fetchSubtitlesFromAddon = async (addon, type, id, hints = {}) => {
  const host = new URL(addon).host;
  const url = buildSubtitleUrl(addon, type, id, hints);
  const payload = await safeFetchJson(url, { timeoutMs: SUBTITLE_REQUEST_TIMEOUT_MS });
  return normalizeSubtitlePayload(payload, host);
};

/** Fast external subtitle lookup; no debrid URL or ffmpeg scan is involved. */
export const getSubtitleCandidates = async ({
  imdbId,
  mediaType,
  season,
  episode,
  videoHash = null,
  videoSize = null,
}) => {
  const stremio = toStremioId({ imdbId, mediaType, season, episode });
  if (!stremio) return { subtitles: [], errors: ['IMDb ID không hợp lệ'] };

  // The file identity must be part of the key. Without it the 1080p and the
  // 2160p release of the same title shared one cached list, so switching source
  // handed back subtitles timed for the other file.
  const fileKey = videoHash ? `:${videoHash}` : '';
  const cacheKey = `addon:subtitles:${stremio.type}:${stremio.id}${fileKey}`;
  return cached(cacheKey, SUBTITLE_CACHE_TTL, async () => {
    const addons = configuredSubtitleAddons();
    const hints = { videoHash, videoSize };
    const settled = await Promise.allSettled(
      addons.map((addon) => fetchSubtitlesFromAddon(addon, stremio.type, stremio.id, hints)),
    );
    const subtitles = [];
    const errors = [];
    const seen = new Set();
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        errors.push(`${new URL(addons[index]).host}: ${result.reason?.message || 'lỗi không rõ'}`);
        return;
      }
      for (const subtitle of result.value) {
        if (seen.has(subtitle.url)) continue;
        seen.add(subtitle.url);
        subtitles.push(subtitle);
      }
    });
    subtitles.sort((a, b) => subtitlePriority(a.language) - subtitlePriority(b.language));
    return { subtitles: subtitles.slice(0, MAX_SUBTITLES), errors };
  });
};

/* ------------------------------------------------------------ id formatting */

/**
 * Stremio addons key on IMDb id:
 *   movie -> `tt1234567`
 *   series -> `tt1234567:1:5`  (imdb:season:episode)
 */
export const toStremioId = ({ imdbId, mediaType, season, episode }) => {
  if (!imdbId || !/^tt\d{7,10}$/.test(imdbId)) return null;
  if (mediaType === 'tv') {
    if (!season || !episode) return null;
    return { type: 'series', id: `${imdbId}:${season}:${episode}` };
  }
  return { type: 'movie', id: imdbId };
};

/** Derive the Stremio lookup key from one of our contentRefs plus an IMDb id. */
export const stremioIdFromContentRef = (contentRef, imdbId) => {
  const parsed = parseContentRef(contentRef);
  if (!parsed) return null;
  return toStremioId({
    imdbId,
    mediaType: parsed.mediaType,
    season: parsed.seasonNumber,
    episode: parsed.episodeNumber,
  });
};

/* ------------------------------------------------------------ magnet parsing */

const INFOHASH_40 = /^[a-f0-9]{40}$/i;
const INFOHASH_32 = /^[a-z2-7]{32}$/i; // base32 btih

/**
 * Pull a v1 infohash out of a magnet URI.
 * Returns lowercase hex, or null if the magnet is malformed or v2-only (which
 * TorBox cannot take).
 */
export const extractInfoHash = (magnet) => {
  if (typeof magnet !== 'string' || !magnet.startsWith('magnet:')) return null;

  let params;
  try {
    params = new URL(magnet).searchParams;
  } catch {
    return null;
  }

  for (const xt of params.getAll('xt')) {
    const match = /^urn:btih:(.+)$/i.exec(xt);
    if (!match) continue;

    const value = match[1].trim();
    if (INFOHASH_40.test(value)) return value.toLowerCase();

    if (INFOHASH_32.test(value)) {
      // Base32 -> hex. TorBox only accepts hex infohashes.
      const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
      let bits = '';
      for (const char of value.toUpperCase()) {
        const index = ALPHABET.indexOf(char);
        if (index < 0) return null;
        bits += index.toString(2).padStart(5, '0');
      }
      const hex = (bits.slice(0, 160).match(/.{8}/g) || [])
        .map((byte) => parseInt(byte, 2).toString(16).padStart(2, '0'))
        .join('');
      return hex.length === 40 ? hex : null;
    }
  }

  return null;
};

const TRACKER_SCHEME = /^(https?|udp|wss):\/\//i;

/** Keep only tracker schemes a BitTorrent client should ever see. */
const filterTrackers = (trackers) =>
  (Array.isArray(trackers) ? trackers : [])
    .filter((tracker) => typeof tracker === 'string' && TRACKER_SCHEME.test(tracker))
    .slice(0, 30);

const sanitizeTrackers = (magnet) => {
  try {
    return filterTrackers(new URL(magnet).searchParams.getAll('tr'));
  } catch {
    return [];
  }
};

/**
 * Rebuild a minimal magnet from vetted parts.
 * Never forward the addon's raw magnet: it can carry extra parameters we have
 * not validated.
 */
export const buildMagnet = (infoHash, { name, trackers = [] } = {}) => {
  if (!INFOHASH_40.test(infoHash)) return null;
  const params = new URLSearchParams();
  params.set('xt', `urn:btih:${infoHash.toLowerCase()}`);
  if (name) params.set('dn', String(name).slice(0, 200));
  // Filter here too, not just at parse time: this is the only place a magnet is
  // constructed, so a caller passing an unvetted list cannot smuggle a scheme in.
  filterTrackers(trackers).forEach((tracker) => params.append('tr', tracker));
  return `magnet:?${params.toString()}`;
};

/* ------------------------------------------------------------- normalization */

/**
 * Flatten one addon stream entry into a candidate.
 *
 * Addons vary wildly: some set `infoHash`, some only a magnet in `url`, some
 * put the quality in `title`, others in `name` or `description`. Anything we
 * cannot reduce to an infohash is dropped — a direct HTTP stream from an
 * unknown host is not something we will fetch.
 */
const normalizeStream = (stream, addonHost) => {
  let infoHash = null;
  let trackers = [];

  if (typeof stream.infoHash === 'string' && INFOHASH_40.test(stream.infoHash.trim())) {
    infoHash = stream.infoHash.trim().toLowerCase();
  } else if (typeof stream.url === 'string' && stream.url.startsWith('magnet:')) {
    infoHash = extractInfoHash(stream.url);
    trackers = sanitizeTrackers(stream.url);
  }

  if (!infoHash) return null;

  // Quality text can live in any of these fields, so search all of them.
  const label = [stream.title, stream.name, stream.description]
    .filter((value) => typeof value === 'string')
    .join(' \n ')
    .slice(0, 600);

  return {
    infoHash,
    magnet: buildMagnet(infoHash, { name: stream.behaviorHints?.filename || stream.name, trackers }),
    label,
    filename: stream.behaviorHints?.filename || '',
    fileIdx: Number.isInteger(stream.fileIdx) ? stream.fileIdx : null,
    sizeBytes: Number(stream.behaviorHints?.videoSize || stream.size || 0) || null,
    source: addonHost,
  };
};

/* ----------------------------------------------------------------- fetching */

const fetchFromAddon = async (addon, type, id) => {
  const host = (() => {
    try {
      return new URL(addon).host;
    } catch {
      return 'addon';
    }
  })();

  const url = `${addon}/stream/${type}/${encodeURIComponent(id)}.json`;
  const payload = await safeFetchJson(url, { timeoutMs: REQUEST_TIMEOUT_MS });

  return (payload?.streams || [])
    .slice(0, MAX_STREAMS_PER_ADDON)
    .map((stream) => normalizeStream(stream, host))
    .filter(Boolean);
};

/**
 * Query every configured addon in parallel and merge the results.
 *
 * One slow or broken addon must not block the rest, so failures are collected
 * rather than thrown. Duplicate infohashes across addons collapse into one
 * candidate, keeping the entry that carried more metadata.
 */
export const getStreamCandidates = async ({ imdbId, mediaType, season, episode }) => {
  const addons = configuredAddons();
  if (!addons.length) return { candidates: [], errors: ['Chưa cấu hình STREMIO_ADDONS'] };

  const stremio = toStremioId({ imdbId, mediaType, season, episode });
  if (!stremio) {
    return { candidates: [], errors: ['Nội dung này thiếu IMDb ID nên không tra được nguồn'] };
  }

  const cacheKey = `addon:streams:${stremio.type}:${stremio.id}`;

  return cached(cacheKey, STREAM_CACHE_TTL, async () => {
    const settled = await Promise.allSettled(
      addons.map((addon) => fetchFromAddon(addon, stremio.type, stremio.id))
    );

    const byHash = new Map();
    const errors = [];

    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        const host = (() => {
          try {
            return new URL(addons[index]).host;
          } catch {
            return `addon#${index}`;
          }
        })();
        errors.push(`${host}: ${result.reason?.message || 'lỗi không rõ'}`);
        return;
      }

      for (const candidate of result.value) {
        const existing = byHash.get(candidate.infoHash);
        if (!existing) {
          byHash.set(candidate.infoHash, candidate);
          continue;
        }
        // Same torrent from two addons: keep whichever knows the size/filename.
        if (!existing.sizeBytes && candidate.sizeBytes) existing.sizeBytes = candidate.sizeBytes;
        if (!existing.filename && candidate.filename) existing.filename = candidate.filename;
        if (candidate.label.length > existing.label.length) existing.label = candidate.label;
      }
    });

    return { candidates: [...byHash.values()], errors };
  });
};

export default {
  isAddonConfigured,
  validateAddonConfig,
  getStreamCandidates,
  getSubtitleCandidates,
  buildSubtitleUrl,
  normalizeSubtitlePayload,
  toStremioId,
  stremioIdFromContentRef,
  extractInfoHash,
  buildMagnet,
};
