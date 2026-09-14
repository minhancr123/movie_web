/**
 * Playback + provider client for the Phase 2 TorBox flow.
 *
 * Every call goes to our own Node API (NEXT_PUBLIC_API_URL, same origin rule
 * as lib/catalog.ts). Provider API keys are only ever sent on the connect
 * POST body; status responses carry the masked fingerprint only.
 */
import axios from 'axios';
import { getSession } from 'next-auth/react';

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';

const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '');

const playbackClient = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

playbackClient.interceptors.request.use(async (config) => {
  if (typeof window !== 'undefined') {
    const session = await getSession();
    if (session?.user?.accessToken) {
      config.headers.Authorization = `Bearer ${session.user.accessToken}`;
    }
  }
  return config;
});

/* ------------------------------------------------------- capabilities */

export interface PlaybackCapabilities {
  hevc: boolean;
  av1: boolean;
  hdr: boolean;
  maxHeight: number;
  eac3: boolean;
}

const STANDARD_HEIGHTS = [480, 720, 1080, 1440, 2160];

function detectMaxHeight(): number {
  if (typeof window === 'undefined') return 1080;
  const raw =
    window.screen?.height ||
    Math.round((window.innerHeight || 1080) * (window.devicePixelRatio || 1));
  const capped = Math.min(Math.max(raw || 1080, 480), 2160);
  // Round up to the nearest standard ladder rung so a 900p laptop gets 1080p.
  return STANDARD_HEIGHTS.find((h) => h >= capped) ?? 2160;
}

function mediaSourceSupports(mime: string): boolean {
  try {
    const MS =
      typeof window !== 'undefined'
        ? (window as any).MediaSource
        : undefined;
    if (MS && typeof MS.isTypeSupported === 'function') {
      return MS.isTypeSupported(mime);
    }
  } catch {
    /* fall through to canPlayType */
  }
  return false;
}

function videoCanPlay(mime: string): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const video = document.createElement('video');
    if (typeof video.canPlayType !== 'function') return false;
    return video.canPlayType(mime) !== '';
  } catch {
    return false;
  }
}

/**
 * Best-effort client capability probe. Conservative on unknowns: no HEVC/AV1
 * claim unless the browser explicitly reports support, so the ranker never
 * offers a stream that renders as a black screen.
 */
export function collectCapabilities(): PlaybackCapabilities {
  if (typeof window === 'undefined') {
    return { hevc: false, av1: false, hdr: false, maxHeight: 1080, eac3: false };
  }

  const hevc =
    mediaSourceSupports('video/mp4; codecs="hvc1.1.6.L123.B0"') ||
    mediaSourceSupports('video/mp4; codecs="hev1.1.6.L123.B0"') ||
    videoCanPlay('video/mp4; codecs="hev1.1.6.L123.B0"');

  const av1 =
    mediaSourceSupports('video/mp4; codecs="av01.0.05M.08"') ||
    videoCanPlay('video/mp4; codecs="av01.0.05M.08"');

  let hdr = false;
  try {
    const mq = window.matchMedia?.bind(window);
    hdr = Boolean(
      mq?.('(dynamic-range: high)').matches || mq?.('(color-gamut: p3)').matches
    );
  } catch {
    hdr = false;
  }

  const eac3 =
    mediaSourceSupports('audio/mp4; codecs="ec-3"') ||
    videoCanPlay('audio/mp4; codecs="ec-3"');

  return { hevc, av1, hdr, maxHeight: detectMaxHeight(), eac3 };
}

/* ------------------------------------------------------------ playback */

export type PlaybackMode = 'direct' | 'remux' | 'downloading';

export interface PlaybackCandidate {
  resolution: number | null;
  codec: string | null;
  hdr: string | null;
  releaseSource: string | null;
  sizeBytes: number | null;
  seeds: number | null;
  cached: boolean;
  score: number | null;
  reasons: string[];
}

export interface ResolveResult {
  mode: PlaybackMode | string;
  sessionId: string;
  url?: string;
  playlistUrl?: string;
  progress?: number;
  reason?: string;
  fileName?: string;
  expiresIn?: number;
  candidate?: PlaybackCandidate | null;
}

export interface PlaybackSessionState {
  sessionId: string;
  mode: string;
  progress?: number;
  playlistUrl?: string;
  message?: string;
  fileName?: string;
  candidate?: PlaybackCandidate | null;
  [key: string]: unknown;
}

export interface ResolveParams {
  type: 'movie' | 'tv';
  tmdbId: number;
  season?: number | null;
  episode?: number | null;
  capabilities: PlaybackCapabilities;
}

const unwrapError = (error: any): Error => {
  const res = error?.response?.data;
  if (res?.message) {
    const err = new Error(String(res.message)) as any;
    err.code = res.code;
    err.status = error?.response?.status;
    err.addonErrors = res.addonErrors;
    err.rejected = res.rejected;
    return err;
  }
  return error instanceof Error ? error : new Error('Lỗi không xác định');
};

/** Turn a backend-relative HLS path into an absolute playable URL. */
export function resolveAssetUrl(pathOrUrl: string | undefined): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const path = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
  return `${API_ORIGIN}${path}`;
}

export const playbackAPI = {
  async resolve(params: ResolveParams): Promise<ResolveResult> {
    try {
      const res = await playbackClient.post('/playback/resolve', params);
      return res.data?.data as ResolveResult;
    } catch (error) {
      throw unwrapError(error);
    }
  },

  async getSession(sessionId: string): Promise<PlaybackSessionState> {
    try {
      const res = await playbackClient.get(
        `/playback/session/${encodeURIComponent(sessionId)}`
      );
      return res.data?.data as PlaybackSessionState;
    } catch (error) {
      throw unwrapError(error);
    }
  },
};

/* ------------------------------------------------------------ providers */

export interface ProviderStatus {
  connected: boolean;
  provider: string;
  masked?: string;
  fingerprint?: string | null;
  plan?: string;
  providerUserId?: string;
  lastVerifiedAt?: string | null;
  updatedAt?: string | null;
}

export const providersAPI = {
  async status(): Promise<Record<string, ProviderStatus>> {
    const res = await playbackClient.get('/providers/status');
    return (res.data?.data ?? {}) as Record<string, ProviderStatus>;
  },

  async connect(apiKey: string) {
    // apiKey travels in the POST body only; never logged or persisted client-side.
    const res = await playbackClient.post('/providers/torbox/connect', {
      apiKey,
    });
    return res.data;
  },

  async disconnect() {
    const res = await playbackClient.post('/providers/torbox/disconnect');
    return res.data;
  },
};
