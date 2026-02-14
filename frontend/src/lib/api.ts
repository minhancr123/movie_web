import axios from 'axios';
import https from 'https';

// Get API URL from Environment Variables
const API_URL = process.env.NEXT_PUBLIC_BACKEND_API_URL;
if (!API_URL) {
  throw new Error("NEXT_PUBLIC_BACKEND_API_URL is not defined in environment variables");
}

const envImagePrefix = process.env.NEXT_PUBLIC_IMAGE_PREFIX;
if (!envImagePrefix) {
  throw new Error("NEXT_PUBLIC_IMAGE_PREFIX is not defined in environment variables");
}
export const IMAGE_PREFIX = envImagePrefix;

// Create an axios instance that ignores self-signed certificates (for development only)
const axiosClient = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: false
  })
});

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

export const getLatestMovies = async (page = 1) => {
  try {
    // Backend Controller: [HttpGet("latest")]
    const res = await axiosClient.get(`${API_URL}/latest?page=${page}`);
    return res.data;
  } catch (error) {
    console.error('Error fetching latest movies:', error);
    return { items: [], pagination: {} };
  }
};

export const getMovieDetail = async (slug: string) => {
  try {
    // Backend Controller: [HttpGet("details/{slug}")]
    const res = await axiosClient.get(`${API_URL}/details/${slug}`);
    return res.data;
  } catch (error) {
    console.error(`Error fetching movie detail for ${slug}:`, error);
    return null;
  }
};

export const searchMovies = async (keyword: string, limit = 10) => {
  try {
    // Backend Controller: [HttpGet("search")]
    const res = await axiosClient.get(`${API_URL}/search?keyword=${keyword}&limit=${limit}`);
    return res.data;
  } catch (error) {
    console.error('Error searching movies:', error);
    return { data: { items: [] } };
  }
};

export const getMoviesByCategory = async (category: string, page = 1) => {
  try {
    const res = await axiosClient.get(`${API_URL}/category/${category}?page=${page}`);
    // The API structure for categories might be slightly different
    // Usually: { status: 'success', data: { items: [], params: { pagination: {} } } }
    // Or just { data: { items: [], ... } } depending on API version.
    // Let's assume consistent wrapper or return raw data to handle in component
    return res.data;
  } catch (error) {
    console.error(`Error fetching category ${category}:`, error);
    return { data: { items: [] } };
  }
};

export async function getMoviesByGenre(genre: string, page: number = 1) {
  try {
    const response = await axiosClient.get(`${API_URL}/genre/${genre}?page=${page}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching movies by genre ${genre}:`, error);
    return { status: false, msg: 'Error', data: { items: [] } };
  }
}

export async function getMoviesByCountry(country: string, page: number = 1) {
  try {
    const response = await axiosClient.get(`${API_URL}/country/${country}?page=${page}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching movies by country ${country}:`, error);
    return { status: false, msg: 'Error', data: { items: [] } };
  }
}

export const moviesAPI = {
  getLatestMovies,
  getMovieDetail,
  searchMovies,
  getMoviesByCategory,
  getMoviesByGenre,
  getMoviesByCountry
};

// ==================== NEW: Auth & User APIs ====================
const AUTH_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';

const authClient = axios.create({
  baseURL: AUTH_API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add token to requests
if (typeof window !== 'undefined') {
  authClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });
}

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