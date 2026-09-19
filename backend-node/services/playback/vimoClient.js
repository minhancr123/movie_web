/**
 * Vimo Stream addon bridge (Vietnamese direct-HLS catalog).
 *
 * Why a bridge instead of STREMIO_ADDONS: Vimo speaks its own id namespace
 * (`vimo_...`, not IMDb `tt...`) and serves direct HLS URLs rather than
 * torrents, so the generic torrent pipeline (infohash -> TorBox -> remux)
 * cannot consume it. This client maps our TMDB title to a vimo id through
 * the addon's search/listing catalogs, then reads its stream endpoints.
 *
 * Proven against the live addon (v2.2.2):
 *   - movie:  /catalog/movie/vimo_search/search={q}.json -> vimo_ ids
 *   - movie:  /stream/movie/{vimoId}.json               -> [{url: *.m3u8}]
 *   - series: /catalog/series/{vimo_series|vimo_tvshows|vimo_anime}.json (paged)
 *   - series: /stream/series/{vimoId}:{season}:{episode}.json
 *   - media hosts allow CORS (*) and need no referer, so browsers play direct.
 */

import { cached } from '../../config/redis.js';
import { safeFetchJson } from '../security/safeFetch.js';
import { normalizeTitle, scoreMeta, MIN_MATCH_SCORE, parseVimoQuality } from './vimoMatch.js';

export { normalizeTitle, scoreMeta, parseVimoQuality };

const REQUEST_TIMEOUT_MS = 8000;
const SEARCH_CACHE_TTL = 6 * 60 * 60;
const LISTING_CACHE_TTL = 6 * 60 * 60;
const STREAM_CACHE_TTL = 15 * 60;
const SERIES_CATALOGS = ['vimo_series', 'vimo_tvshows', 'vimo_anime'];
const LISTING_PAGE_CAP = 12;
const LISTING_PAGE_SIZE = 24;

const baseUrl = () =>
  (process.env.VIMO_ADDON_URL || 'https://vimo.trankhanh.io.vn').trim().replace(/\/+$/, '');

export const isVimoEnabled = () => process.env.VIMO_ENABLED !== '0';

/* ------------------------------------------------------------ matching */

const pickBestMeta = (metas, context) => {
  let best = null;
  let bestScore = 0;
  for (const meta of metas || []) {
    const score = scoreMeta(meta, context);
    if (score > bestScore) {
      bestScore = score;
      best = meta;
    }
  }
  return bestScore >= MIN_MATCH_SCORE ? best : null;
};

/* -------------------------------------------------------------- fetch */

const getJson = (url) => safeFetchJson(url, { timeoutMs: REQUEST_TIMEOUT_MS });

const searchCatalog = async (query) => {
  const url = `${baseUrl()}/catalog/movie/vimo_search/search=${encodeURIComponent(query)}.json`;
  const payload = await getJson(url).catch(() => null);
  return Array.isArray(payload?.metas) ? payload.metas : [];
};

const listingPage = async (type, catalogId, skip) => {
  const url = `${baseUrl()}/catalog/${type}/${catalogId}/skip=${skip}.json`;
  const payload = await getJson(url).catch(() => null);
  return Array.isArray(payload?.metas) ? payload.metas : [];
};

/**
 * Movie id lookup through the search catalog. One query per known title,
 * first good match wins; the whole lookup is cached per title set.
 */
export const findVimoMovieId = async ({ titles = [], year = null }) => {
  const context = { titles, year };
  const key = `vimo:movie:${normalizeTitle(titles.join('|'))}:${year ?? ''}`;
  return cached(key, SEARCH_CACHE_TTL, async () => {
    for (const title of titles) {
      if (!String(title || '').trim()) continue;
      const best = pickBestMeta(await searchCatalog(title.trim()), context);
      if (best?.id) return { vimoId: String(best.id), name: best.name || '', year: best.year ?? null };
    }
    return null;
  });
};

/**
 * Series have no search catalog: scan the three listing catalogs (paged,
 * capped, cached for hours — listings change rarely).
 */
export const findVimoSeriesId = async ({ titles = [], year = null }) => {
  const context = { titles, year };
  const key = `vimo:series:${normalizeTitle(titles.join('|'))}:${year ?? ''}`;
  return cached(key, LISTING_CACHE_TTL, async () => {
    for (const catalogId of SERIES_CATALOGS) {
      for (let page = 0; page < LISTING_PAGE_CAP; page += 1) {
        // eslint-disable-next-line no-await-in-loop
        const metas = await listingPage('series', catalogId, page * LISTING_PAGE_SIZE);
        if (metas.length === 0) break;
        const best = pickBestMeta(metas, context);
        if (best?.id) return { vimoId: String(best.id), name: best.name || '', year: best.year ?? null };
        if (metas.length < LISTING_PAGE_SIZE) break;
      }
    }
    return null;
  });
};

const normalizeVimoStreams = (payload) =>
  (Array.isArray(payload?.streams) ? payload.streams : [])
    .filter((s) => typeof s?.url === 'string' && /^https:\/\//i.test(s.url))
    .slice(0, 8)
    .map((s, index) => {
      const quality = parseVimoQuality(s.title);
      return {
        id: `vimo:${index}:${Buffer.from(s.url).toString('base64url').slice(0, 16)}`,
        name: typeof s.name === 'string' ? s.name : '',
        title: quality.label,
        url: s.url,
        resolution: quality.resolution,
      };
    });

/**
 * Raw streams for a resolved vimo id. Short TTL: media hosts sign URLs and
 * episodes/hosts rotate, so never serve a stale link.
 */
export const getVimoStreams = async ({ vimoId, type, season = null, episode = null }) => {
  if (!vimoId) return [];
  const streamId =
    type === 'tv' && Number.isInteger(season) && Number.isInteger(episode)
      ? `${vimoId}:${season}:${episode}`
      : vimoId;
  const key = `vimo:streams:${type}:${streamId}`;
  return cached(key, STREAM_CACHE_TTL, async () => {
    const url = `${baseUrl()}/stream/${type === 'tv' ? 'series' : 'movie'}/${encodeURIComponent(streamId)}.json`;
    const payload = await getJson(url).catch(() => null);
    return normalizeVimoStreams(payload);
  });
};

/**
 * Full bridge: TMDB detail -> vimo id -> playable streams.
 * Returns null when Vimo has nothing for this title (normal case for
 * non-Vietnamese-catalog content — the torrent flow stays primary).
 */
export const resolveVimoSource = async ({ type, season = null, episode = null, detail = {} }) => {
  if (!isVimoEnabled()) return null;
  const titles = [detail?.name, detail?.englishTitle, detail?.originalTitle, detail?.title].filter(Boolean);
  const year = Number.isInteger(detail?.year) ? detail.year : null;
  if (titles.length === 0) return null;
  try {
    const found =
      type === 'tv'
        ? await findVimoSeriesId({ titles, year })
        : await findVimoMovieId({ titles, year });

    if (!found?.vimoId) return null;
    const streams = await getVimoStreams({ vimoId: found.vimoId, type, season, episode });
    if (streams.length === 0) return null;
    return { ...found, streams };
  } catch (error) {
    console.warn(`vimo bridge bỏ qua: ${error?.message || error}`);
    return null;
  }
};

export default {
  isVimoEnabled,
  normalizeTitle,
  scoreMeta,
  parseVimoQuality,
  findVimoMovieId,
  findVimoSeriesId,
  getVimoStreams,
  resolveVimoSource,
};
