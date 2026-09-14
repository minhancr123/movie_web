/**
 * OpenSubtitles REST API client.
 *
 * Why this exists alongside the Stremio subtitle addon: the addon answers on
 * IMDb id alone and ignores videoHash, so it cannot tell a subtitle timed for
 * this exact file from one timed for a CAM rip. This API can — every result
 * carries `moviehash_match` and the release name it was made for.
 *
 * Quota shapes the design:
 *   - /subtitles (search)   — unlimited, so this is our matching intelligence
 *   - /download  (get file) — 5/day on an API key alone, 100+/day once logged
 *                             in, so downloads are cached on disk forever and
 *                             the addon stays the bulk content source.
 *
 * Set OPENSUBTITLES_API_KEY to enable. Without it every call degrades to a
 * no-op and the caller falls back to addon-only behaviour.
 */

import { cached } from '../../config/redis.js';

const BASE_URL = 'https://api.opensubtitles.com/api/v1';
const REQUEST_TIMEOUT_MS = 10000;
const SEARCH_CACHE_TTL = 6 * 60 * 60;

const apiKey = () => process.env.OPENSUBTITLES_API_KEY || '';
const userAgent = () => process.env.OPENSUBTITLES_USER_AGENT || 'MovieWeb/1.0';

export const isConfigured = () => Boolean(apiKey());

const request = async (path, { method = 'GET', body = null } = {}) => {
  if (!isConfigured()) throw new Error('OpenSubtitles chưa được cấu hình');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      // The API 301-redirects some query shapes; following keeps the key header.
      redirect: 'follow',
      headers: {
        'Api-Key': apiKey(),
        'User-Agent': userAgent(),
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`phản hồi không phải JSON (HTTP ${response.status})`);
    }
    if (!response.ok) {
      const detail = payload?.errors ? JSON.stringify(payload.errors) : payload?.message || '';
      throw new Error(`OpenSubtitles ${path} lỗi ${response.status}: ${detail}`.trim());
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
};

const normalizeResult = (entry) => {
  const attributes = entry?.attributes || {};
  const file = (attributes.files || [])[0] || {};
  return {
    subtitleId: String(attributes.subtitle_id || entry?.id || ''),
    fileId: file.file_id ?? null,
    fileName: file.file_name || '',
    language: String(attributes.language || '').toLowerCase(),
    /** True only when this subtitle was uploaded against this exact file. */
    moviehashMatch: attributes.moviehash_match === true,
    release: attributes.release || '',
    downloadCount: Number(attributes.download_count || 0),
    fps: Number(attributes.fps || 0) || null,
    hearingImpaired: attributes.hearing_impaired === true,
  };
};

/**
 * Search. `languages` is a plain array; each is queried separately because the
 * API 301-redirects a comma-joined `languages` value, which drops the request.
 */
export const searchSubtitles = async ({
  imdbId,
  season = null,
  episode = null,
  languages = ['vi', 'en'],
  moviehash = null,
}) => {
  if (!isConfigured()) return [];
  const numericImdb = String(imdbId || '').replace(/^tt/, '');
  if (!/^\d+$/.test(numericImdb)) return [];

  const key = `os:search:${numericImdb}:${season ?? ''}:${episode ?? ''}:${moviehash ?? ''}:${languages.join('+')}`;

  return cached(key, SEARCH_CACHE_TTL, async () => {
    const perLanguage = await Promise.allSettled(
      languages.map((language) => {
        const params = new URLSearchParams({ imdb_id: numericImdb, languages: language });
        if (moviehash) params.set('moviehash', moviehash);
        if (Number.isInteger(season)) params.set('season_number', String(season));
        if (Number.isInteger(episode)) params.set('episode_number', String(episode));
        return request(`/subtitles?${params.toString()}`);
      })
    );

    const results = [];
    for (const settled of perLanguage) {
      if (settled.status !== 'fulfilled') continue;
      for (const entry of settled.value?.data || []) {
        const normalized = normalizeResult(entry);
        if (normalized.fileId) results.push(normalized);
      }
    }

    // A hash match is worth more than any popularity signal: it is the only
    // property that guarantees the timing lines up with the file being played.
    results.sort((a, b) => {
      if (a.moviehashMatch !== b.moviehashMatch) return a.moviehashMatch ? -1 : 1;
      return b.downloadCount - a.downloadCount;
    });
    return results;
  });
};

/**
 * Resolve a temporary download link. Consumes one unit of the daily quota, so
 * callers must cache the fetched file rather than calling this per playback.
 * @returns {Promise<{ link: string, fileName: string, remaining: number|null }>}
 */
export const getDownloadLink = async (fileId) => {
  const payload = await request('/download', { method: 'POST', body: { file_id: Number(fileId) } });
  if (!payload?.link) throw new Error('OpenSubtitles không trả link tải');
  return {
    link: payload.link,
    fileName: payload.file_name || '',
    remaining: Number.isFinite(Number(payload.remaining)) ? Number(payload.remaining) : null,
  };
};

export default { isConfigured, searchSubtitles, getDownloadLink };
