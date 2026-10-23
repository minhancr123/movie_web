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

import { isTransientDebridError } from '../debrid/torbox.js';
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

  // Filter by capability
  const compatible = candidates.filter((c) => {
    if (c.codec === 'hevc' && !caps.hevc) return false;
    if (c.codec === 'hevc10' && !caps.hevcMain10) return false;
    if (c.codec === 'av1' && !caps.av1) return false;
    if (c.height > caps.maxHeight) return false;
    return true;
  });

  if (!compatible.length) return candidates[0]; // fallback to first

  // Sort by quality (height desc, then bitrate desc)
  compatible.sort((a, b) => {
    if (b.height !== a.height) return b.height - a.height;
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
export async function coordinateResolve(resolveId, params, context) {
  const { type, tmdbId, season, episode, caps, debridKey } = params;

  setResolveStage(resolveId, 'source_lookup', 'Đang tìm nguồn phát...');

  // This is a coordination point — actual logic stays in playbackController
  // until full migration. The orchestrator will gradually take over.
  return {
    resolveId,
    coordinated: true,
    timestamp: Date.now(),
  };
}

// --- Capability-based source filtering ---
export function filterByCapability(candidates, caps) {
  return candidates.filter((c) => {
    // Height check
    if (c.height && c.height > caps.maxHeight) return false;

    // Codec check
    if (c.codec === 'hevc' && !caps.hevc) return false;
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

  if (filtered.length === 0) return candidates[0] || null;

  // Prefer smooth playback over max quality
  const smoothMax = caps.smoothMaxHeight || caps.maxHeight;
  const preferred = filtered.filter((c) => c.height <= smoothMax);

  if (preferred.length > 0) {
    preferred.sort((a, b) => b.height - a.height);
    return preferred[0];
  }

  // Fallback to highest available
  filtered.sort((a, b) => b.height - a.height);
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
