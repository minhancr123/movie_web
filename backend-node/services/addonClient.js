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

const REQUEST_TIMEOUT_MS = 4000;
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
    .map(normalizeAddonBase)
    .filter(Boolean);

/**
 * The base URL an addon's endpoints hang off.
 *
 * Every addon catalogue hands out the *manifest* URL, so that is what gets
 * pasted into configuration — but buildSubtitleUrl appends `/subtitles/...` and
 * would produce `.../manifest.json/subtitles/movie/tt1.json`, a silent 404 that
 * looks exactly like an addon with nothing to offer. Only a whole trailing
 * `manifest.json` segment is removed: addons like SubDL carry their API key and
 * language settings in the path, and that path must survive untouched.
 */
export const normalizeAddonBase = (entry) =>
  String(entry ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/manifest\.json$/i, '')
    .replace(/\/+$/, '');

/** Subtitle addons are independent from torrent-source addons. */
const configuredSubtitleAddons = () =>
  (process.env.STREMIO_SUBTITLE_ADDONS || DEFAULT_SUBTITLE_ADDON)
    .split(',')
    .map(normalizeAddonBase)
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

/** Longest release name worth showing; past this it crowds out the language. */
const SUB_NAME_MAX = 120;

/**
 * The release name an addon attached to a sidecar, under any of its spellings.
 * Whitespace is collapsed because these strings land in a menu, and a newline
 * there breaks the row rather than describing anything.
 */
export const subtitleVariantName = (subtitle, url = '') => {
  const raw = subtitle?.name ?? subtitle?.title ?? subtitle?.SubFileName ?? '';
  const stated = String(raw).replace(/\s+/g, ' ').trim();
  if (stated) return stated.slice(0, SUB_NAME_MAX);
  return releaseNameFromUrl(url).slice(0, SUB_NAME_MAX);
};

/**
 * The release a sidecar is named after, recovered from its URL.
 *
 * Neither addon configured here sets a name, but SubDL serves the file under
 * its real filename — which is the only thing distinguishing four Vietnamese
 * entries whose timings differ by seconds. OpenSubtitles serves opaque numeric
 * ids instead, and "1962602489" is not a name, so those stay blank rather than
 * dressing up an id as information.
 */
export const releaseNameFromUrl = (url) => {
  let file;
  try {
    file = decodeURIComponent(new URL(String(url)).pathname.split('/').pop() || '');
  } catch {
    return '';
  }
  const stem = file
    .replace(/\.(srt|vtt|ass|ssa|sub)$/i, '')
    // Trailing language tag the file server appended, e.g. "...x265.vi".
    .replace(/\.[a-z]{2,3}$/i, '')
    .replace(/[_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A bare id tells the viewer nothing, and neither does a one-letter stem;
  // only say something that could plausibly name a release.
  if (stem.length < 3 || !/[a-z]/i.test(stem)) return '';
  return stem;
};

/**
 * Do two release names describe the same file? Both directions: a sidecar
 * named "Film.2026.1080p.WEB-DL.H264-GROUP.srt" matches a playing
 * "Film.2026.1080p.WEB-DL.H264-GROUP.mkv" and vice versa.
 *
 * Deliberately strict: containment with a 18-char floor, so codec tags
 * ("x264", "1080p", "WEB-DL") can never match alone, and a WEBRip-named
 * sidecar never ticks against a WEB-DL file. Returns false for anything
 * short, blank, or merely sharing a title — a tick must mean same release,
 * not same film.
 */
export const releaseNamesMatch = (a, b) => {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const na = norm(a);
  const nb = norm(b);
  const short = Math.min(na.length, nb.length);
  if (short < 18) return false;
  return na.includes(nb) || nb.includes(na);
};

/**
 * How likely a subtitle timed for `subRelease` is in sync with `fileName.
 *
 * releaseNamesMatch above answers a yes/no question for the tick mark, and a
 * no there just means "unproven" — but the picker still has to choose among
 * the unproven. This scores the same evidence on a scale so the closest file
 * surfaces first instead of the most downloaded one.
 *
 * Facets, in decreasing order of what actually moves cue timing:
 * - content identity (year, SxxEyy): a mismatch is a different video, so it
 *   vetoes outright rather than scoring low. Matching adds little — same film
 *   is the baseline expectation, not an achievement.
 * - source (WEB-DL vs WEBRip vs BluRay vs HDTV): different masters drift.
 *   Match weighs most; a both-present mismatch penalises hard.
 * - group (`-FQM`, `-EVO`): same group usually means same encode chain.
 * - resolution, codec: weak signals, mostly tie-breakers.
 * - remaining title tokens: Jaccard overlap so "Extended" vs "Theatrical"
 *   still counts for something without deciding anything alone.
 *
 * Returns { score, veto }. Veto is a different answer from a low score: the
 * caller must exclude vetoed entries, not rank them last.
 */
const RELEASE_FACETS = {
  source: ['web-dl', 'webdl', 'webrip', 'web-rip', 'bluray', 'blu-ray', 'hdtv', 'dvdrip', 'dvd', 'hdrip', 'hdcam', 'cam', 'telesync'],
  resolution: ['2160p', '1080p', '720p', '480p', '4k'],
  codec: ['x264', 'x265', 'h264', 'h265', 'xvid', 'divx', 'av1', 'hevc'],
};

const releaseTokens = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/**
 * Source facet from the joined tokens: "WEB-DL", "WEBDL" and "WEB.DL" all
 * join to a string containing "webdl", while the token list holds ["web",
 * "dl"] — so single-token lookup can never see multi-word facets. Longest
 * first, so "hdcam" wins over the "cam" inside it.
 */
const SOURCE_FACETS = [
  ['bluray', ['bluray', 'blu-ray']],
  ['webdl', ['webdl', 'web-dl']],
  ['webrip', ['webrip', 'web-rip']],
  ['hdtv', ['hdtv']],
  ['dvdrip', ['dvdrip']],
  ['hdrip', ['hdrip']],
  ['hdcam', ['hdcam']],
  ['telesync', ['telesync']],
  ['cam', ['cam']],
  ['ts', ['ts']],
  ['dvd', ['dvd']],
];
const RESOLUTION_FACETS = ['2160p', '1080p', '720p', '480p', '4k'];
const CODEC_FACETS = [
  ['x264', ['x264', 'h264']],
  ['x265', ['x265', 'h265', 'hevc']],
  ['xvid', ['xvid']],
  ['divx', ['divx']],
  ['av1', ['av1']],
];

const detectFacet = (joined, table) => {
  for (const [canonical, forms] of table) {
    if (forms.some((f) => joined.includes(f.replace(/-/g, '')))) return canonical;
  }
  return null;
};

const detectResolution = (tokens) => {
  const set = new Set(tokens);
  for (const r of RESOLUTION_FACETS) {
    if (set.has(r)) return r;
  }
  return null;
};

const detectCodec = (tokens) => {
  const set = new Set(tokens);
  for (const [canonical, forms] of CODEC_FACETS) {
    if (forms.some((f) => set.has(f))) return canonical;
  }
  return null;
};

const trailingGroup = (s) => {
  const m = String(s || '').match(/[-_. ]([a-z0-9]{2,12})(\.[a-z]{2,4})?$/i);
  return m ? m[1].toLowerCase() : null;
};

const contentIds = (tokens) => {
  const years = tokens.filter((t) => /^(19|20)\d{2}$/.test(t));
  const eps = tokens.filter((t) => /^s\d{1,2}e\d{1,3}$/.test(t));
  return { years, eps };
};

export const releaseSimilarity = (subRelease, fileName) => {
  const sub = releaseTokens(subRelease);
  const file = releaseTokens(fileName);
  if (sub.length === 0 || file.length === 0) return { score: 0, veto: false };

  // Different video entirely: never rank, exclude.
  const subIds = contentIds(sub);
  const fileIds = contentIds(file);
  if (subIds.years.length > 0 && fileIds.years.length > 0
    && !subIds.years.some((y) => fileIds.years.includes(y))) {
    return { score: Number.NEGATIVE_INFINITY, veto: true };
  }
  if (subIds.eps.length > 0 && fileIds.eps.length > 0
    && !subIds.eps.some((e) => fileIds.eps.includes(e))) {
    return { score: Number.NEGATIVE_INFINITY, veto: true };
  }

  const subJoined = sub.join('');
  const fileJoined = file.join('');
  let score = 0;
  const subSource = detectFacet(subJoined, SOURCE_FACETS);
  const fileSource = detectFacet(fileJoined, SOURCE_FACETS);
  if (subSource && fileSource) {
    score += subSource === fileSource ? 25 : -20;
  }
  const subGroup = trailingGroup(subRelease);
  const fileGroup = trailingGroup(fileName);
  // Only comparable when both sides name one: a missing group is no signal,
  // not a mismatch.
  if (subGroup && fileGroup) {
    score += subGroup === fileGroup ? 30 : -15;
  }
  const subRes = detectResolution(sub);
  const fileRes = detectResolution(file);
  if (subRes && fileRes) {
    score += subRes === fileRes ? 15 : -10;
  }
  const subCodec = detectCodec(sub);
  const fileCodec = detectCodec(file);
  if (subCodec && fileCodec) {
    score += subCodec === fileCodec ? 10 : -5;
  }

  // Title overlap on whatever is left after facets, year and episode are out.
  // Same film is the baseline, so it adds a little rather than deciding.
  const facetTokens = new Set();
  for (const [, forms] of SOURCE_FACETS) {
    for (const f of forms) facetTokens.add(f.replace(/-/g, ''));
  }
  const skip = new Set([
    ...facetTokens, ...RESOLUTION_FACETS,
    ...CODEC_FACETS.flatMap(([, forms]) => forms),
    ...subIds.years, ...subIds.eps, ...fileIds.years, ...fileIds.eps,
  ]);
  const subTitle = sub.filter((t) => !skip.has(t));
  const fileTitle = new Set(file.filter((t) => !skip.has(t)));
  if (subTitle.length > 0 && fileTitle.size > 0) {
    const overlap = subTitle.filter((t) => fileTitle.has(t)).length;
    score += Math.round((overlap / Math.max(subTitle.length, fileTitle.size)) * 10);
  }
  return { score, veto: false };
};

/**
 * How one variant is described in the picker.
 *
 * Best: the release it was timed for. Failing that, the addon it came from —
 * still enough to tell two entries apart and to learn which source suits this
 * library. Failing both, the bare counter this always used to be.
 */
export const subtitleVariantLabel = ({ base, name = '', source = '', index = 1 } = {}) => {
  const clean = String(name).trim();
  // A "name" that only repeats the language describes nothing.
  if (clean && clean.toLowerCase() !== String(base).toLowerCase()) return `${base} · ${clean}`;
  const host = String(source).trim();
  if (host) return `${base} · ${host} ${index}`;
  return `${base} ${index}`;
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
        // Which release this sidecar was timed for. Addons spell it several
        // ways and some say nothing at all. Without it a list of same-language
        // variants is just a numbered guess, and the one that actually matches
        // the file is indistinguishable from the ones that are a second out.
        name: subtitleVariantName(subtitle, parsed.href),
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
