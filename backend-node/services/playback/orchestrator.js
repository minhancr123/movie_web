/**
 * Playback Orchestrator — central coordination layer.
 *
 * This module provides a unified interface for playback resolution,
 * decoupling the controller from provider-specific details.
 *
 * Architecture:
 *   Frontend → Orchestrator → Media Adapters → Processing Engine → Delivery
 *
 * Each adapter returns normalized metadata about the source, so the
 * orchestrator never needs to know provider-specific details.
 */

import { getStreamCandidates as addonCandidates } from '../addonClient.js';
import { rankCandidates, normalizeCapabilities } from './sourceRanker.js';
import { setResolveStage } from './resolveProgress.js';

// --- Adapter registry ---
const adapters = new Map();

export function registerAdapter(name, adapter) {
  adapters.set(name, adapter);
}

export function getAdapter(name) {
  return adapters.get(name);
}

export function listAdapters() {
  return [...adapters.keys()];
}

// --- Source selection ---
export function selectBestSource(candidates, caps, options = {}) {
  if (!candidates || !candidates.length) return null;

  const compatible = filterByCapability(candidates, caps);
  if (!compatible.length) return null;

  // Sort by quality (height desc, then bitrate desc)
  compatible.sort((a, b) => {
    if (heightOf(b) !== heightOf(a)) return heightOf(b) - heightOf(a);
    return (b.bitrate || 0) - (a.bitrate || 0);
  });

  return compatible[0];
}

// --- Session management ---
const sessions = new Map();
const MAX_SESSIONS = 1000;

export function createSession(sessionId, metadata) {
  if (sessions.size >= MAX_SESSIONS) {
    // Evict oldest
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
  }
  sessions.set(sessionId, {
    ...metadata,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return sessions.get(sessionId);
}

export function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) session.updatedAt = Date.now();
  return session;
}

export function updateSession(sessionId, updates) {
  const session = sessions.get(sessionId);
  if (session) {
    Object.assign(session, updates, { updatedAt: Date.now() });
  }
  return session;
}

export function deleteSession(sessionId) {
  return sessions.delete(sessionId);
}

// --- Resolve coordination ---
// Only source discovery/ranking has migrated. Mongo sessions and delivery
// remain in the controller until their ownership/seek tests can move together.
registerAdapter('torbox', { getCandidates: addonCandidates });
export const getStreamCandidates = params => coordinateResolve(null, params);
export async function coordinateResolve(resolveId, params, context = {}) {
  const adapter = getAdapter(context.provider || 'torbox');
  if (!adapter || typeof adapter.getCandidates !== 'function') throw new Error('Playback adapter unavailable');
  if (resolveId) setResolveStage(resolveId, 'sources');
  return adapter.getCandidates(params, context);
}
export const rankPlaybackCandidates = (candidates, caps, options) =>
  rankCandidates(candidates, normalizeCapabilities(caps), options);
const heightOf = candidate => Number(candidate.height ?? candidate.resolution ?? candidate.probedHeight) || 0;

// --- Capability-based source filtering ---
export function filterByCapability(candidates = [], rawCaps = {}) {
  const caps = normalizeCapabilities(rawCaps);
  return candidates.filter((c) => {
    // Height check
    if (heightOf(c) > caps.maxHeight) return false;

    // Codec check
    if (c.codec === 'hevc' && !caps.hevc) return false;
    if (c.codec === 'hevc' && /main.?10/i.test(c.profile || '') && !caps.hevcMain10) return false;
    if (c.codec === 'hevc10' && !caps.hevcMain10) return false;
    if (c.codec === 'av1' && !caps.av1) return false;

    // WebM check
    if (c.container === 'webm' && !caps.webm) return false;

    // Bitrate check (if available)
    if (caps.maxBitrateMbps > 0 && c.bitrate) {
      const bitrateMbps = c.bitrate / 1_000_000;
      if (bitrateMbps > caps.maxBitrateMbps * 1.5) return false; // 50% headroom
    }

    return true;
  });
}

// --- Device-aware quality selection ---
export function selectQualityForDevice(candidates, caps) {
  const filtered = filterByCapability(candidates, caps);

  if (filtered.length === 0) return null;

  // Prefer smooth playback over max quality
  const smoothMax = Number(caps.smoothMaxHeight) || Number(caps.maxHeight) || 1080;
  const preferred = filtered.filter((c) => heightOf(c) <= smoothMax);

  if (preferred.length > 0) {
    preferred.sort((a, b) => heightOf(b) - heightOf(a));
    return preferred[0];
  }

  // Choose the least demanding compatible source if every source exceeds the smooth ceiling.
  filtered.sort((a, b) => heightOf(a) - heightOf(b));
  return filtered[0];
}

export default {
  registerAdapter,
  getAdapter,
  listAdapters,
  selectBestSource,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  coordinateResolve,
  filterByCapability,
  selectQualityForDevice,
};
