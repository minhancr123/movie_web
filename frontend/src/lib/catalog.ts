/**
 * Catalog client for the TMDB-backed API.
 *
 * Every call goes to our own Node API — never to TMDB directly. That matters:
 * some Vietnamese ISPs DNS-block themoviedb.org, so a browser-side TMDB call
 * would fail for real users. Only image.tmdb.org is hit from the browser, and
 * that host is not blocked.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';

export type MediaType = 'movie' | 'tv';

export interface CatalogItem {
  contentRef: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  originalTitle: string;
  slug: string;
  overview: string;
  year: number | null;
  poster: string;
  backdrop: string;
  genres: string[];
  voteAverage: number;
}

export interface CatalogSeasonSummary {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  airYear: number | null;
  poster: string;
}

export interface CatalogDetail extends CatalogItem {
  runtime: number | null;
  status: string;
  /** IMDb id — the key Stremio-protocol addons resolve sources by. */
  imdbId: string | null;
  cast: { name: string; character: string; profile: string }[];
  directors: string[];
  trailerKey: string | null;
  seasons?: CatalogSeasonSummary[];
}

export interface CatalogEpisode {
  contentRef: string;
  episodeNumber: number;
  name: string;
  overview: string;
  airDate: string | null;
  runtime: number | null;
  still: string;
}

export interface CatalogSeason {
  seasonNumber: number;
  name: string;
  overview: string;
  poster: string;
  episodes: CatalogEpisode[];
}

/** Episode entry for the pro player episodes panel (href prebuilt server-side). */
export interface PlayerEpisode {
  episodeNumber: number;
  name: string;
  overview: string;
  still: string;
  href: string;
}

export interface Pagination {
  currentPage: number;
  totalPages: number;
  totalItems: number;
}

export interface CatalogList {
  items: CatalogItem[];
  pagination: Pagination;
}

export interface CatalogHome {
  trending: CatalogItem[];
  popularMovies: CatalogItem[];
  popularTv: CatalogItem[];
  topRatedMovies: CatalogItem[];
}

const EMPTY_LIST: CatalogList = {
  items: [],
  pagination: { currentPage: 1, totalPages: 0, totalItems: 0 },
};

/** Revalidate windows mirror the Redis TTLs on the backend. */
const REVALIDATE = {
  home: 1800,
  search: 900,
  discover: 900,
  detail: 86400,
  season: 21600,
  genres: 604800,
};

/** Never let a slow or dead API hang a page render or a production build. */
const REQUEST_TIMEOUT_MS = 15000;

async function get<T>(path: string, revalidate: number, fallback: T): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/catalog${path}`, {
      next: { revalidate },
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error(`catalog${path} trả về ${res.status}`);
      return fallback;
    }

    const payload = await res.json();
    if (!payload?.success) {
      console.error(`catalog${path} thất bại:`, payload?.message);
      return fallback;
    }

    return payload.data as T;
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? `quá ${REQUEST_TIMEOUT_MS / 1000}s không phản hồi`
        : error;
    console.error(`catalog${path} lỗi:`, reason);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

export const getHome = () =>
  get<CatalogHome>('/home', REVALIDATE.home, {
    trending: [],
    popularMovies: [],
    popularTv: [],
    topRatedMovies: [],
  });

export const searchCatalog = (query: string, page = 1) => {
  if (!query.trim()) return Promise.resolve(EMPTY_LIST);
  const qs = new URLSearchParams({ q: query, page: String(page) });
  return get<CatalogList>(`/search?${qs}`, REVALIDATE.search, EMPTY_LIST);
};

export const discoverCatalog = (params: {
  type?: MediaType;
  genre?: string | number;
  region?: string;
  year?: string | number;
  page?: number;
}) => {
  const qs = new URLSearchParams();
  if (params.type) qs.set('type', params.type);
  if (params.genre) qs.set('genre', String(params.genre));
  if (params.region) qs.set('region', params.region);
  if (params.year) qs.set('year', String(params.year));
  qs.set('page', String(params.page || 1));
  return get<CatalogList>(`/discover?${qs}`, REVALIDATE.discover, EMPTY_LIST);
};

export const getCatalogDetail = (type: MediaType, tmdbId: number | string) =>
  get<CatalogDetail | null>(`/${type}/${tmdbId}`, REVALIDATE.detail, null);

export const getSeason = (tmdbId: number | string, season: number | string) =>
  get<CatalogSeason | null>(`/tv/${tmdbId}/season/${season}`, REVALIDATE.season, null);

export const getGenres = (type: MediaType) =>
  get<{ genres: { id: number; name: string }[] }>(`/genres/${type}`, REVALIDATE.genres, {
    genres: [],
  });

/* ---------------------------------------------------------- stored records */

/** Shape of a favorite / watch-history document as the API returns it. */
export interface StoredContentRecord {
  contentRef?: string;
  movieSlug?: string;
  tmdbId?: number;
  mediaType?: string;
  movieData?: {
    name?: string;
    originName?: string;
    posterUrl?: string;
    thumbUrl?: string;
    year?: number | null;
  };
}

const CONTENT_REF_PATTERN = /^tmdb:(movie|tv):(\d+)/;

/**
 * Rebuild a CatalogItem from a saved favorite / history row so it can render
 * in a CatalogCard and link to the canonical URL.
 *
 * Returns null for rows written before the TMDB cutover: those carry a phimapi
 * slug that identifies nothing any more, so there is no URL to link to.
 */
export function fromStoredRecord(record: StoredContentRecord): CatalogItem | null {
  const ref = record.contentRef || record.movieSlug || '';
  const match = CONTENT_REF_PATTERN.exec(ref);
  if (!match) return null;

  const mediaType = match[1] as MediaType;
  const tmdbId = record.tmdbId || Number(match[2]);
  const data = record.movieData || {};
  const title = data.name || data.originName || '';

  return {
    contentRef: `tmdb:${mediaType}:${tmdbId}`,
    tmdbId,
    mediaType,
    title,
    originalTitle: data.originName || '',
    slug: slugify(title),
    overview: '',
    year: data.year ?? null,
    poster: data.posterUrl || data.thumbUrl || '',
    backdrop: data.thumbUrl || '',
    genres: [],
    voteAverage: 0,
  };
}

/** Mirror of the backend slug rule so stored rows produce the same URL. */
function slugify(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'phim'
  );
}

/* ------------------------------------------------------------------- URLs */

/** Canonical detail URL. The slug is decorative; type + tmdbId identify content. */
export const catalogHref = (item: Pick<CatalogItem, 'mediaType' | 'tmdbId' | 'slug'>) =>
  `/phim/${item.mediaType}/${item.tmdbId}/${item.slug || 'phim'}`;

export const watchHref = (
  item: Pick<CatalogItem, 'mediaType' | 'tmdbId' | 'slug'>,
  season?: number,
  episode?: number
) => {
  const base = `/xem-phim/${item.mediaType}/${item.tmdbId}/${item.slug || 'phim'}`;
  if (item.mediaType === 'tv' && season && episode) {
    return `${base}?s=${season}&e=${episode}`;
  }
  return base;
};
