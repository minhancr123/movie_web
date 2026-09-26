/**
 * Playback + provider client for the Phase 2 TorBox flow.
 *
 * Every call goes to our own Node API (NEXT_PUBLIC_API_URL, same origin rule
 * as lib/catalog.ts). Provider API keys are only ever sent on the connect
 * POST body; status responses carry the masked fingerprint only.
 *
 * Capability probing lives in lib/capabilities.ts (one detector, used by the
 * resolve and prewarm calls) and the playback calls live in lib/api.ts. What
 * remains here is the provider connection surface.
 */
import axios from 'axios';
import { getSession } from 'next-auth/react';

const playbackClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 35000,
});

// Load-bearing: every /providers/* route sits behind authMiddleware, so the
// Bearer token is what makes status/connect/disconnect work at all.
playbackClient.interceptors.request.use(async (config) => {
  if (typeof window !== 'undefined') {
    const session = await getSession();
    if (session?.user?.accessToken) {
      config.headers.Authorization = `Bearer ${session.user.accessToken}`;
    }
  }
  return config;
});

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
