import { cached, CACHE_TTL } from '../config/redis.js';
import { buildContentRef, toSlug } from './contentRef.js';

// Several Vietnamese ISPs block api.themoviedb.org at the TLS/SNI layer: DNS and
// TCP both succeed, then the handshake is reset. Point TMDB_BASE_URL at a proxy
// you control (see scripts/tmdb-proxy-worker.js) when the host network blocks it.
// image.tmdb.org is not blocked, so posters are always fetched directly.
const BASE_URL = (process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3').replace(/\/+$/, '');
const IMAGE_BASE = 'https://image.tmdb.org/t/p';

const LANGUAGE = process.env.TMDB_LANGUAGE || 'vi-VN';
const FALLBACK_LANGUAGE = 'en-US';
const REGION = process.env.TMDB_REGION || 'VN';
const REQUEST_TIMEOUT_MS = 8000;

const readToken = process.env.TMDB_READ_TOKEN || '';
const apiKey = process.env.TMDB_API_KEY || '';
// Shared secret for the optional TMDB proxy (scripts/tmdb-proxy-worker.js).
const proxyToken = process.env.TMDB_PROXY_TOKEN || '';

export const isTmdbConfigured = () => Boolean(readToken || apiKey);

const buildUrl = (path, params = {}) => {
  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    url.searchParams.set(key, String(value));
  });
  // v4 bearer token is preferred; v3 api_key is the fallback.
  if (!readToken && apiKey) url.searchParams.set('api_key', apiKey);
  return url.toString();
};

const request = async (path, params = {}) => {
  if (!isTmdbConfigured()) {
    throw new Error('TMDB chưa được cấu hình: thiếu TMDB_READ_TOKEN hoặc TMDB_API_KEY');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(path, params), {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(readToken ? { authorization: `Bearer ${readToken}` } : {}),
        ...(proxyToken ? { 'x-proxy-token': proxyToken } : {}),
      },
    });

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`TMDB ${path} trả về ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
};

const imageUrl = (path, size) => (path ? `${IMAGE_BASE}/${size}${path}` : '');

const yearOf = (value) => {
  const year = Number(String(value || '').slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : null;
};

/* --------------------------------------------------- Vietnamese labels */

// TMDB không dịch tên vai diễn / tên người (danh từ riêng) — chỉ dịch các
// nhãn trạng thái / phòng ban / địa danh quen thuộc sang tiếng Việt.
const STATUS_VI = {
  Rumored: 'Tin đồn',
  Planned: 'Sắp sản xuất',
  'In Production': 'Đang sản xuất',
  'Post Production': 'Hậu kỳ',
  Released: 'Đã phát hành',
  Ended: 'Đã kết thúc',
  Canceled: 'Đã hủy',
  Cancelled: 'Đã hủy',
  'Returning Series': 'Đang phát sóng',
  Pilot: 'Tập thử nghiệm',
};

const DEPARTMENT_VI = {
  Acting: 'Diễn xuất',
  Directing: 'Đạo diễn',
  Production: 'Sản xuất',
  Writing: 'Biên kịch',
  Crew: 'Đoàn phim',
  'Costume & Make-Up': 'Phục trang & Hóa trang',
  'Art Department': 'Mỹ thuật',
  'Camera Department': 'Quay phim',
  'Sound Department': 'Âm thanh',
  Editing: 'Dựng phim',
  'Visual Effects': 'Kỹ xảo',
};

const COUNTRY_VI = {
  'United States of America': 'Mỹ',
  'United States': 'Mỹ',
  'United Kingdom': 'Anh',
  'South Korea': 'Hàn Quốc',
  Vietnam: 'Việt Nam',
  France: 'Pháp',
  Japan: 'Nhật Bản',
  China: 'Trung Quốc',
  'Hong Kong': 'Hồng Kông',
  Taiwan: 'Đài Loan',
  Thailand: 'Thái Lan',
  India: 'Ấn Độ',
  Canada: 'Canada',
  Australia: 'Úc',
  Germany: 'Đức',
  Italy: 'Ý',
  Spain: 'Tây Ban Nha',
};

const translateStatus = (status) => STATUS_VI[status] || status || '';
const translateDepartment = (dept) => DEPARTMENT_VI[dept] || dept || '';
const translatePlace = (place) => {
  if (!place) return '';
  let out = String(place);
  Object.entries(COUNTRY_VI).forEach(([en, vi]) => {
    out = out.replace(en, vi);
  });
  return out;
};

/* ------------------------------------------------------------------ genres */

export const getGenreMap = async (mediaType) =>
  cached(`tmdb:genres:${mediaType}:${LANGUAGE}`, CACHE_TTL.GENRES, async () => {
    const data = await request(`/genre/${mediaType}/list`, { language: LANGUAGE });
    const map = {};
    (data?.genres || []).forEach((genre) => {
      map[genre.id] = genre.name;
    });
    return map;
  });

/* ------------------------------------------------------------- normalizers */

// search/multi tags every result (movie | tv | person); list endpoints tag none.
// An explicit tag we cannot render (person) must drop the item, not fall back —
// otherwise actors render as broken movie cards.
const resolveType = (item, fallbackType) => {
  if (!item.media_type) return fallbackType;
  return item.media_type === 'tv' || item.media_type === 'movie' ? item.media_type : null;
};

// List payloads only carry genre_ids, so the caller passes a resolved genre map.
const normalizeListItem = (item, mediaType, genreMap = {}) => {
  if (mediaType !== 'movie' && mediaType !== 'tv') return null;

  const title = mediaType === 'movie' ? item.title : item.name;
  const originalTitle = mediaType === 'movie' ? item.original_title : item.original_name;
  const year = yearOf(mediaType === 'movie' ? item.release_date : item.first_air_date);

  return {
    contentRef: buildContentRef({ mediaType, tmdbId: item.id }),
    tmdbId: item.id,
    mediaType,
    title: title || originalTitle || '',
    originalTitle: originalTitle || '',
    slug: toSlug(title || originalTitle),
    overview: item.overview || '',
    year,
    poster: imageUrl(item.poster_path, 'w500'),
    backdrop: imageUrl(item.backdrop_path, 'w1280'),
    genres: (item.genre_ids || []).map((id) => genreMap[id]).filter(Boolean),
    voteAverage: Number(item.vote_average || 0),
  };
};

const normalizeList = async (payload, fallbackType) => {
  const items = payload?.results || [];

  // search/multi mixes types, so both genre maps may be needed.
  const needsMovie = items.some((i) => resolveType(i, fallbackType) === 'movie');
  const needsTv = items.some((i) => resolveType(i, fallbackType) === 'tv');
  const [movieGenres, tvGenres] = await Promise.all([
    needsMovie ? getGenreMap('movie') : {},
    needsTv ? getGenreMap('tv') : {},
  ]);

  return {
    items: items
      .map((item) => {
        const mediaType = resolveType(item, fallbackType);
        const genreMap = mediaType === 'tv' ? tvGenres : movieGenres;
        return normalizeListItem(item, mediaType, genreMap);
      })
      .filter(Boolean),
    pagination: {
      currentPage: payload?.page || 1,
      totalPages: Math.min(payload?.total_pages || 1, 500), // TMDB caps paging at 500
      totalItems: payload?.total_results || 0,
    },
  };
};

const normalizeDetail = (data, mediaType, fallbackOverview = '', englishTitle = '') => {
  const title = mediaType === 'movie' ? data.title : data.name;
  const originalTitle = mediaType === 'movie' ? data.original_title : data.original_name;
  const year = yearOf(mediaType === 'movie' ? data.release_date : data.first_air_date);
  // Prefer a Vietnamese trailer, then English, then any teaser.
  const videos = (data.videos?.results || []).filter((video) => video.site === 'YouTube');
  const pickVideo = (type, lang) =>
    videos.find((video) => video.type === type && (!lang || video.iso_639_1 === lang));
  const trailer =
    pickVideo('Trailer', 'vi') ||
    pickVideo('Trailer', 'en') ||
    pickVideo('Trailer') ||
    pickVideo('Teaser');

  return {
    contentRef: buildContentRef({ mediaType, tmdbId: data.id }),
    tmdbId: data.id,
    mediaType,
    title: title || originalTitle || '',
    originalTitle: originalTitle || '',
    // English alias: release names on trackers are overwhelmingly English,
    // while `title` follows TMDB_LANGUAGE (vi-VN) and `originalTitle` may be
    // CJK (zero latin tokens). Without this, title-match rejects every
    // candidate for anime/CJK titles (e.g. Demon Slayer: Infinity Castle).
    englishTitle: englishTitle || '',
    slug: toSlug(title || originalTitle),
    overview: data.overview || fallbackOverview || '',
    year,
    poster: imageUrl(data.poster_path, 'w500'),
    backdrop: imageUrl(data.backdrop_path, 'original'),
    genres: (data.genres || []).map((genre) => genre.name),
    runtime: mediaType === 'movie' ? data.runtime || null : data.episode_run_time?.[0] || null,
    status: translateStatus(data.status),
    voteAverage: Number(data.vote_average || 0),
    // IMDb ID is what Stremio-protocol addons key on.
    imdbId: data.external_ids?.imdb_id || null,
    cast: (data.credits?.cast || []).slice(0, 20).map((person) => ({
      id: person.id,
      name: person.name,
      character: person.character,
      profile: imageUrl(person.profile_path, 'w185'),
    })),
    directors: (data.credits?.crew || [])
      .filter((person) => person.job === 'Director')
      .map((person) => person.name),
    trailerKey: trailer?.key || null,
    seasons:
      mediaType === 'tv'
        ? (data.seasons || [])
            .filter((season) => season.season_number > 0)
            .map((season) => ({
              seasonNumber: season.season_number,
              name: season.name,
              episodeCount: season.episode_count,
              airYear: yearOf(season.air_date),
              poster: imageUrl(season.poster_path, 'w342'),
            }))
        : undefined,
  };
};

/* --------------------------------------------------------------- endpoints */

export const getHome = async () => {
  const [trending, popularMovies, popularTv, topRatedMovies] = await Promise.all([
    request('/trending/all/week', { language: LANGUAGE }),
    request('/movie/popular', { language: LANGUAGE, region: REGION }),
    request('/tv/popular', { language: LANGUAGE }),
    request('/movie/top_rated', { language: LANGUAGE, region: REGION }),
  ]);

  const [trendingList, movieList, tvList, topRatedList] = await Promise.all([
    normalizeList(trending, 'movie'),
    normalizeList(popularMovies, 'movie'),
    normalizeList(popularTv, 'tv'),
    normalizeList(topRatedMovies, 'movie'),
  ]);

  return {
    trending: trendingList.items,
    popularMovies: movieList.items,
    popularTv: tvList.items,
    topRatedMovies: topRatedList.items,
  };
};

export const search = async (query, page = 1) => {
  const payload = await request('/search/multi', {
    query,
    page,
    language: LANGUAGE,
    include_adult: false,
  });
  return normalizeList(payload, 'movie');
};

export const discover = async ({ type = 'movie', genre, year, region, page = 1 }) => {
  const mediaType = type === 'tv' ? 'tv' : 'movie';
  const params = {
    page,
    language: LANGUAGE,
    include_adult: false,
    sort_by: 'popularity.desc',
    with_genres: genre,
    with_origin_country: region,
  };

  if (year) {
    if (mediaType === 'movie') params.primary_release_year = year;
    else params.first_air_date_year = year;
  }

  const payload = await request(`/discover/${mediaType}`, params);
  return normalizeList(payload, mediaType);
};

export const getDetail = async (mediaType, tmdbId) => {
  const [data, english] = await Promise.all([
    request(`/${mediaType}/${tmdbId}`, {
      language: LANGUAGE,
      append_to_response: 'external_ids,credits,videos',
      // Without this the videos block inherits language=vi-VN and comes back empty
      // for almost every title, so no trailer would ever be found.
      include_video_language: 'vi,en,null',
    }),
    // English copy: feeds englishTitle (title-match alias) and the overview
    // fallback. Runs in parallel; the normalized result is Redis-cached, so
    // this costs one extra TMDB call per cache miss only.
    request(`/${mediaType}/${tmdbId}`, { language: FALLBACK_LANGUAGE }).catch(() => null),
  ]);
  if (!data) return null;

  // TMDB's Vietnamese overviews are sparse for non-Western titles.
  const fallbackOverview = !data.overview ? english?.overview || '' : '';
  const englishTitle = english?.title || english?.name || '';

  return normalizeDetail(data, mediaType, fallbackOverview, englishTitle);
};

export const getRecommendations = async (mediaType, tmdbId, page = 1) => {
  const type = mediaType === 'tv' ? 'tv' : 'movie';
  return request(`/${type}/${tmdbId}/recommendations`, {
    language: LANGUAGE,
    page,
  });
};

/**
 * Person detail + acting filmography, most popular first.
 *
 * Same bilingual pattern as getDetail: Vietnamese bio wins, en-US fills the
 * gaps TMDB never translated. combined_credits rides along so one round trip
 * serves the whole page; entries without artwork or title are dropped, and so
 * is anything that is not a movie or series (crew-only rows, talk shows).
 */
export const getPerson = async (personId) => {
  const id = Number(personId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [data, english] = await Promise.all([
    request(`/person/${id}`, {
      language: LANGUAGE,
      append_to_response: 'combined_credits',
    }),
    request(`/person/${id}`, { language: FALLBACK_LANGUAGE }).catch(() => null),
  ]);
  if (!data) return null;

  // Talk shows and news guest spots (Tonight Show et al.) dominate popularity
  // rankings but are not acting work: drop them by genre id when present.
  const NON_ACTING_GENRES = new Set([10767, 10763]);
  const filmography = (data.combined_credits?.cast || [])
    .filter(
      (entry) =>
        entry
        && (entry.media_type === 'movie' || entry.media_type === 'tv')
        && Number.isInteger(entry.id)
        && (entry.title || entry.name)
        && !(entry.genre_ids || []).some((id) => NON_ACTING_GENRES.has(id)),
    )
    .sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0))
    .slice(0, 30)
    .map((entry) => {
      const isTv = entry.media_type === 'tv';
      return {
        tmdbId: entry.id,
        mediaType: entry.media_type,
        title: entry.title || entry.name || '',
        character: entry.character || '',
        poster: imageUrl(entry.poster_path, 'w342'),
        year: yearOf(isTv ? entry.first_air_date : entry.release_date),
        voteAverage: Number(entry.vote_average || 0),
      };
    });

  const biographyVi = String(data.biography || '').trim();
  const biographyEn = String(english?.biography || '').trim();
  return {
    id: data.id,
    name: data.name || '',
    biography: biographyVi || biographyEn || '',
    biographyLang: biographyVi ? 'vi' : biographyEn ? 'en' : '',
    birthday: data.birthday || null,
    deathday: data.deathday || null,
    placeOfBirth: translatePlace(data.place_of_birth),
    profile: imageUrl(data.profile_path, 'h632'),
    knownFor: translateDepartment(data.known_for_department),
    filmography,
  };
};

export const getSeason = async (tmdbId, seasonNumber) => {
  const data = await request(`/tv/${tmdbId}/season/${seasonNumber}`, { language: LANGUAGE });
  if (!data) return null;

  return {
    seasonNumber: data.season_number,
    name: data.name,
    overview: data.overview || '',
    poster: imageUrl(data.poster_path, 'w342'),
    episodes: (data.episodes || []).map((episode) => ({
      contentRef: buildContentRef({
        mediaType: 'tv',
        tmdbId,
        seasonNumber: data.season_number,
        episodeNumber: episode.episode_number,
      }),
      episodeNumber: episode.episode_number,
      name: episode.name,
      overview: episode.overview || '',
      airDate: episode.air_date || null,
      runtime: episode.runtime || null,
      still: imageUrl(episode.still_path, 'w300'),
    })),
  };
};
