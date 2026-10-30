import { completeResolveRequest } from './resolve-job';
import axios from 'axios';
import { getDevicePlaybackCapabilities } from './capabilities';
import { getSession } from 'next-auth/react';

// Auth / favourites / history / comments / premiere client.
// Catalog lives in lib/catalog.ts and talks to the TMDB-backed endpoints.
// Legacy catalog helpers kept only for the premiere feature (/cong-chieu),
// which still runs on the old shape and is migrated in Phase 2.
// The .NET service is gone, so these now hit the Node API and will 404
// until premiere is rebuilt.
import { resolveApiBase } from './apiBase';

export const API_URL = resolveApiBase({
  isServer: typeof window === 'undefined',
  internal: process.env.INTERNAL_API_URL,
  publicUrl: process.env.NEXT_PUBLIC_BACKEND_API_URL || process.env.NEXT_PUBLIC_API_URL,
});

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
  requesters?: { id: string; name: string; at: string }[];
  requestCount?: number;
  status: 'pending' | 'completed' | 'rejected';
  mediaType?: 'movie' | 'tv';
  automation?: { enabled?: boolean; state?: string; progress?: number; message?: string; attempts?: number; lastCheckedAt?: string; nextAttemptAt?: string; verifiedAt?: string };
  note?: string;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TmdbMatch {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string | null;
  poster: string | null;
}

export const movieRequestAPI = {
  controlAutomation: (id: string, enabled: boolean, episode?: {season:number;episode:number}) => authClient.patch(`/movie-requests/${id}/automation`, { enabled, ...episode }),
  create: (data: { title: string; tmdbId?: string | number; mediaType?: 'movie' | 'tv'; note?: string }) =>
    authClient.post<{ success: boolean; message: string; request: MovieRequestItem }>('/movie-requests', data),

  getAll: (params?: { page?: number; limit?: number; status?: string }) =>
    authClient.get<{
      success: boolean;
      data: MovieRequestItem[];
      pagination: { total: number; page: number; limit: number; pages: number };
    }>('/movie-requests', { params }),

  updateStatus: (id: string, data: { status?: 'pending' | 'completed' | 'rejected'; adminNote?: string; tmdbId?: number; mediaType?: 'movie' | 'tv' }) =>
    authClient.put<{ success: boolean; message: string; request: MovieRequestItem }>(`/movie-requests/${id}`, data),

  checkTmdb: (id: string) =>
    authClient.get<{ success: boolean; data: { title: string; attachedTmdbId: number | null; results: TmdbMatch[] } }>(`/movie-requests/${id}/tmdb`),

  getMyRequests: () =>
    authClient.get<{ success: boolean; data: MovieRequestItem[] }>('/movie-requests/me'),
};

export const providerAPI = {
  getStatus: () => authClient.get('/providers/status'),
  connectTorbox: (apiKey: string) => authClient.post('/providers/torbox/connect', { apiKey }),
  disconnectTorbox: () => authClient.post('/providers/torbox/disconnect'),
};

const enhancePlaybackPayload = async <T extends { capabilities: any }>(data: T): Promise<T> => ({
  ...data, capabilities: { ...data.capabilities, ...await getDevicePlaybackCapabilities() },
});

export const playbackAPI = {
  timeline: (sessionId: string, signal?: AbortSignal) => authClient.get(`/playback/session/${encodeURIComponent(sessionId)}/timeline`, { signal, timeout: 6000 }),
  thumbnail: (sessionId: string, at: number, signal?: AbortSignal) => authClient.get(`/playback/session/${encodeURIComponent(sessionId)}/thumbnail`, { params: { at }, responseType: 'blob', signal, timeout: 10_000 }),
  resolve: (data: {
    type: string;
    tmdbId: number;
    season?: number;
    episode?: number;
    capabilities: any;
    sourceToken?: string;
    audioIndex?: number;
    excludeSourceTokens?: string[];
    background?: boolean;
    viewerId?: string;
    resolveId?: string;
    startAt?: number;
  }, signal?: AbortSignal) => enhancePlaybackPayload(data).then(payload => completeResolveRequest(
    () => authClient.post('/playback/resolve', { ...payload, asyncQueue: true }, { timeout: 120_000, ...(signal ? { signal } : {}) }), {
      signal,
      poll: (id, pollSignal) => authClient.get(`/playback/resolve-jobs/${encodeURIComponent(id)}`, { signal: pollSignal, timeout: 10_000 }),
      cancel: id => authClient.delete(`/playback/resolve-jobs/${encodeURIComponent(id)}`, { timeout: 3000 }),
    })),
  prewarm: (data: {
    type: string;
    tmdbId: number;
    season?: number;
    episode?: number;
    capabilities: any;
    sourceToken?: string;
  }) => enhancePlaybackPayload(data).then(payload => authClient.post('/playback/prewarm', payload)),
  listSources: (data: {
    type: string;
    tmdbId: number;
    season?: number;
    episode?: number;
    capabilities: any;
    sourceToken?: string;
  }) => enhancePlaybackPayload(data).then(payload => authClient.post('/playback/sources', payload)),
  getSession: (sessionId: string) => authClient.get(`/playback/session/${sessionId}`),
  heartbeat: (sessionId: string, viewerId: string) =>
    authClient.post(`/playback/session/${encodeURIComponent(sessionId)}/heartbeat`, { viewerId }),
  leave: (sessionId: string, viewerId: string) =>
    authClient.post(`/playback/session/${encodeURIComponent(sessionId)}/leave`, { viewerId }),
  // Re-mint an expiring direct-playback URL without a full re-resolve. The
  // response carries a fresh url + expiresIn; the caller swaps the source and
  // keeps the position. Rejects (410) for sessions with nothing to re-mint.
  refreshSessionUrl: (sessionId: string) =>
    authClient.post(`/playback/session/${encodeURIComponent(sessionId)}/refresh`),
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
  cancelSubtitleInventory: (jobId: string) => authClient.delete(`/playback/subtitles/job/${encodeURIComponent(jobId)}`),
  subtitleInventory: (data: {
    type: string; tmdbId: number; season?: number; episode?: number;
    capabilities: any; sourceToken?: string; playbackSessionId?: string;
    externalOnly?: boolean; positionSeconds?: number; inventoryJobId?: string;
  }, signal?: AbortSignal) => authClient.post('/playback/subtitles/inventory', data, { signal }),
  subtitles: (data: {
    type: string;
    tmdbId: number;
    season?: number;
    episode?: number;
    capabilities: any;
    sourceToken?: string;
    playbackSessionId?: string;
    externalOnly?: boolean;
    positionSeconds?: number;
  }) => authClient.post('/playback/subtitles', data),
  // Viewer-uploaded .srt: file read as text client-side, JSON body (no
  // multipart dependency). The response is a ready track, selected now.
  uploadSubtitle: (data: {
    content: string;
    filename: string;
    language: string;
    tmdbId: number;
    season?: number | null;
    episode?: number | null;
  }) => authClient.post('/playback/subtitles/upload', data),
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
const AUTH_API_URL = API_URL;

export const authClient = axios.create({
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
  login: (data: any, headers?: Record<string, string>) => authClient.post('/auth/login', data, { headers }),
  googleLogin: (data: any, headers?: Record<string, string>) => authClient.post('/auth/google-login', data, { headers }),
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
