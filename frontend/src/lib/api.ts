import axios from 'axios';
import { getSession } from 'next-auth/react';

// Auth / favourites / history / comments / premiere client.
// Catalog lives in lib/catalog.ts and talks to the TMDB-backed endpoints.
// Legacy catalog helpers kept only for the premiere feature (/cong-chieu),
// which still runs on the old shape and is migrated in Phase 2.
// The .NET service is gone, so these now hit the Node API and will 404
// until premiere is rebuilt.
const API_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:5001/api';

const envImagePrefix = process.env.NEXT_PUBLIC_IMAGE_PREFIX || 'https://phimimg.com/';
export const IMAGE_PREFIX = envImagePrefix.endsWith('/') ? envImagePrefix : `${envImagePrefix}/`;

const axiosClient = axios.create();

export interface Movie {

  _id: string;
  name: string;
  origin_name: string;
  slug: string;
  poster_url: string;
  thumb_url: string;
  year: number;
}

export interface MovieDetail extends Movie {
  content: string;
  type: string;
  status: string;
  trailer_url?: string;
  time: string;
  episode_current: string;
  episode_total: string;
  quality: string;
  lang: string;
  actor: string[];
  director: string[];
  category: { id: string; name: string; slug: string }[];
  country: { id: string; name: string; slug: string }[];
  episodes: {
    server_name: string;
    server_data: {
      name: string;
      slug: string;
      filename: string;
      link_embed: string;
      link_m3u8: string;
    }[];
  }[];
}

const withAbsoluteImage = (url: string | undefined) => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  const normalizedPath = url.startsWith('/') ? url.slice(1) : url;
  return `${IMAGE_PREFIX}${normalizedPath}`;
};

const normalizeMovie = (movie: any): Movie => ({
  ...movie,
  poster_url: withAbsoluteImage(movie?.poster_url),
  thumb_url: withAbsoluteImage(movie?.thumb_url),
});

const normalizeListPayload = (payload: any) => {
  const items = (payload?.data?.items || payload?.items || []).map(normalizeMovie);
  const pagination = payload?.data?.params?.pagination || payload?.pagination || {};

  return {
    ...payload,
    data: {
      ...(payload?.data || {}),
      items,
      params: {
        ...(payload?.data?.params || {}),
        pagination,
      },
    },
    items,
    pagination,
  };
};

const isCategorySlug = (slug: string) => {
  const known = new Set([
    'phim-le',
    'phim-bo',
    'hoat-hinh',
    'tv-shows',
    'phim-chieu-rap',
    'subteam',
  ]);
  return known.has(slug);
};

export const getLatestMovies = async (page = 1) => {
  try {
    const res = await fetch(`${API_URL}/latest?page=${page}`, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error('Network response was not ok');
    const data = await res.json();
    return normalizeListPayload(data);
  } catch (error) {
    console.error('Error fetching latest movies:', error);
    return { items: [], pagination: {} };
  }
};

export const getMovieDetail = async (slug: string) => {
  try {
    const res = await fetch(`${API_URL}/details/${slug}`, { next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const data = await res.json();

    if (data?.movie) {
      data.movie = {
        ...data.movie,
        poster_url: withAbsoluteImage(data.movie.poster_url),
        thumb_url: withAbsoluteImage(data.movie.thumb_url),
      };
    }

    return data;
  } catch (error) {
    console.error(`Error fetching movie detail for ${slug}:`, error);
    return null;
  }
};





export const moviesAPI = {
  getLatestMovies,
  getMovieDetail,
};

// ==================== PROVIDER & PLAYBACK APIs (new) ====================
export interface MovieRequestItem {
  _id: string;
  title: string;
  tmdbId?: string | number | null;
  userId: string;
  username: string;
  status: 'pending' | 'completed' | 'rejected';
  note?: string;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

export const movieRequestAPI = {
  create: (data: { title: string; tmdbId?: string | number; note?: string }) =>
    authClient.post<{ success: boolean; message: string; request: MovieRequestItem }>('/movie-requests', data),

  getAll: (params?: { page?: number; limit?: number; status?: string }) =>
    authClient.get<{
      success: boolean;
      data: MovieRequestItem[];
      pagination: { total: number; page: number; limit: number; pages: number };
    }>('/movie-requests', { params }),

  updateStatus: (id: string, data: { status: 'pending' | 'completed' | 'rejected'; adminNote?: string }) =>
    authClient.put<{ success: boolean; message: string; request: MovieRequestItem }>(`/movie-requests/${id}`, data),

  getMyRequests: () =>
    authClient.get<{ success: boolean; data: MovieRequestItem[] }>('/movie-requests/me'),
};

export const providerAPI = {
  getStatus: () => authClient.get('/providers/status'),
  connectTorbox: (apiKey: string) => authClient.post('/providers/torbox/connect', { apiKey }),
  disconnectTorbox: () => authClient.post('/providers/torbox/disconnect'),
};

export const playbackAPI = {
  resolve: (data: {
    type: string;
    tmdbId: number;
    season?: number;
    episode?: number;
    capabilities: any;
    sourceToken?: string;
    audioIndex?: number;
    resolveId?: string;
  }, signal?: AbortSignal) => authClient.post('/playback/resolve', data, signal ? { signal } : {}),
  prewarm: (data: {
    type: string;
    tmdbId: number;
    season?: number;
    episode?: number;
    capabilities: any;
  }) => authClient.post('/playback/prewarm', data),
  listSources: (data: {
    type: string;
    tmdbId: number;
    season?: number;
    episode?: number;
    capabilities: any;
  }) => authClient.post('/playback/sources', data),
  getSession: (sessionId: string) => authClient.get(`/playback/session/${sessionId}`),
  getResolveStage: (resolveId: string) =>
    authClient.get(`/playback/resolve/${encodeURIComponent(resolveId)}/stage`),
  preload: (data: {
    sessionId: string;
    timestamps: number[];
    type?: string;
    tmdbId?: number | string;
    season?: number;
    episode?: number;
  }) => authClient.post('/playback/preload', data),
  subtitleJob: (jobId: string) => authClient.get(`/playback/subtitles/job/${jobId}`),
  subtitles: (data: {
    type: string;
    tmdbId: number;
    season?: number;
    episode?: number;
    capabilities: any;
    sourceToken?: string;
    playbackSessionId?: string;
    externalOnly?: boolean;
  }) => authClient.post('/playback/subtitles', data),
};

/** Absolute backend URL for relative asset paths (extracted VTT sidecars). */
export const apiUrl = (path: string) => {
  if (/^https?:\/\//i.test(path)) return path;
  const base = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api').replace(
    /\/api\/?$/,
    ''
  );
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
};

// ==================== NEW: Auth & User APIs ====================
const AUTH_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';

const authClient = axios.create({
  baseURL: AUTH_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests from NextAuth session
authClient.interceptors.request.use(async (config) => {
  if (typeof window !== 'undefined') {
    const session = await getSession();
    if (session?.user?.accessToken) {
      config.headers.Authorization = `Bearer ${session.user.accessToken}`;
    }
  }
  return config;
});

// Auth APIs
export const authAPI = {
  register: (data: any) => authClient.post('/auth/register', data),
  login: (data: any) => authClient.post('/auth/login', data),
  googleLogin: (data: any) => authClient.post('/auth/google-login', data),
  getMe: () => authClient.get('/auth/me'),
  updateProfile: (data: any) => authClient.put('/auth/profile', data),
};

// Favorites APIs
export const favoritesAPI = {
  getAll: () => authClient.get('/favorites'),
  add: (data: any) => authClient.post('/favorites', data),
  remove: (movieSlug: string) => authClient.delete(`/favorites/${movieSlug}`),
  check: (movieSlug: string) => authClient.get(`/favorites/check/${movieSlug}`),
};

// Watch History APIs
export const watchHistoryAPI = {
  getAll: (limit = 20) => authClient.get(`/watch-history?limit=${limit}`),
  add: (data: any) => authClient.post('/watch-history', data),
  remove: (movieSlug: string) => authClient.delete(`/watch-history/${movieSlug}`),
  clear: () => authClient.delete('/watch-history'),
};

// Comments APIs
export const commentsAPI = {
  getAll: (movieSlug: string, page = 1, limit = 10) =>
    authClient.get(`/comments/${movieSlug}?page=${page}&limit=${limit}`),
  add: (data: any) => authClient.post('/comments', data),
  update: (commentId: string, data: any) => authClient.put(`/comments/${commentId}`, data),
  delete: (commentId: string) => authClient.delete(`/comments/${commentId}`),
};

// Premiere APIs
export const premiereAPI = {
  getAll: (status?: string, limit = 20) => {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', limit.toString());
    return authClient.get(`/premieres?${params.toString()}`);
  },
  getUpcoming: () => authClient.get('/premieres/upcoming'),
  getBySlug: (movieSlug: string) => authClient.get(`/premieres/movie/${movieSlug}`),
  create: (data: any) => authClient.post('/premieres', data),
  updateStatus: (eventId: string, status: string) =>
    authClient.put(`/premieres/${eventId}/status`, { status }),
  delete: (eventId: string) => authClient.delete(`/premieres/${eventId}`),
  registerNotification: (eventId: string) => authClient.post(`/premieres/${eventId}/notify`),
};
