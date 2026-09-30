/**
 * Shared finished remuxes ("renditions").
 *
 * Every resolve spawns its own ffmpeg and remuxes from byte zero, even when
 * the exact same bytes were already produced for another viewer (or an
 * earlier viewing): session dirs are keyed by random sessionId, so nothing is
 * ever reusable across sessions. This module keys finished remuxes by WHAT
 * they contain instead of WHO asked, so a repeat view starts instantly with
 * zero CPU: no ffmpeg, no buffer waits.
 *
 * Only COMPLETE playlists are ever shared (they carry EXT-X-ENDLIST and never
 * change again). Partial output stays per-session exactly as before — sharing
 * a moving target would corrupt readers on writer restart. Sessions keep
 * their per-user records and ownership checks; only the bytes on disk are
 * shared, addressed by content hash.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { sessionPath, VIEWER_LEASE_MS } from './remuxService.js';

const GB = 1024 ** 3;

const positiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const RENDITIONS_ROOT = path.resolve(
  process.env.RENDITIONS_ROOT
  || path.join(process.cwd(), 'tmp', 'renditions'),
);
// Production pins this to /data/transcodes/renditions (same volume as
// TRANSCODE_ROOT) so publishRendition() stays a hard-link. Migration rule for
// the old default (/app/tmp/renditions, no volume): COPY surviving complete
// renditions across, verify bytes + meta.json, and only then remove the old
// root — never move blindly and never serve from two roots at once.
export const RENDITION_FORMAT_VERSION = 1;
export const RENDITION_MAX_BYTES = positiveNumber(process.env.RENDITIONS_MAX_GB, 100) * GB;
export const RENDITION_TTL_MS = positiveNumber(process.env.RENDITIONS_TTL_DAYS, 14) * 24 * 60 * 60 * 1000;

const safeRenditionId = (value) =>
  /^[a-f0-9]{32}$/i.test(String(value || '')) ? String(value).toLowerCase() : '';

/**
 * Deterministic identity of one finished remux. Same file + same audio
 * mapping + same video plan + same segmenting = same bytes (same machine,
 * same ffmpeg), so the id is stable across viewers and restarts. Anything
 * that changes the bytes must change the id — when in doubt, add the field
 * and bump RENDITION_FORMAT_VERSION.
 */
export const buildRenditionId = ({
  infoHash,
  fileId,
  audioStreamIndex = null,
  audioCopy = false,
  audioChannels = null,
  audioDelayMs = 0,
  video = null,
  segmentSeconds = 4,
} = {}) => {
  const norm = {
    v: RENDITION_FORMAT_VERSION,
    infoHash: String(infoHash || '').toLowerCase(),
    fileId: String(fileId ?? ''),
    audio: {
      idx: audioStreamIndex ?? null,
      copy: Boolean(audioCopy),
      ch: audioChannels ?? null,
      // Lip-sync compensation changes the bytes: only present when used, so
      // existing ids stay byte-identical when it is not.
      ...(Number(audioDelayMs) > 0 ? { dly: Math.round(Number(audioDelayMs)) } : {}),
    },
    video:
      video && video.mode === 'transcode'
        ? {
          mode: 'transcode',
          height: video.height ?? null,
          kbps: video.kbps ?? null,
          tonemap: Boolean(video.tonemap),
          tenBit: Boolean(video.tenBit),
          // A seek-started session holds truncated bytes: only present when
          // seeking, so existing ids are byte-identical when unused. `seek`
          // rides along so renditions cut with the old accurate seek — whose
          // audio sits ~146ms ahead of the picture whenever the cut landed on
          // a keyframe — can never be handed back for reuse.
          ...(video.startAt > 0 ? { startAt: video.startAt, seek: 'inexact' } : {}),
        }
        : video && (video.startAt ?? 0) > 0
          // Seek + copy: same file and settings, different start — the only
          // field that changes the bytes. `seek` retires the renditions cut
          // with the old accurate seek (see the transcode branch above).
          ? { mode: video.mode, startAt: video.startAt, seek: 'inexact' }
          : { mode: video?.mode ?? 'copy' },
    seg: segmentSeconds,
  };
  return crypto.createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 32);
};

export const renditionPath = (renditionId, asset = 'index.m3u8') => {
  const id = safeRenditionId(renditionId);
  return path.join(RENDITIONS_ROOT, id || 'invalid', path.basename(String(asset || '')));
};

const parsePlaylist = (text) => {
  const duration = [...String(text || '').matchAll(/#EXTINF:([\d.]+)/g)].reduce(
    (sum, match) => sum + Number(match[1] || 0),
    0,
  );
  return { duration, ended: String(text || '').includes('#EXT-X-ENDLIST') };
};

export const readRenditionState = async (renditionId) => {
  try {
    const playlist = await fs.readFile(renditionPath(renditionId, 'index.m3u8'), 'utf8');
    const { duration, ended } = parsePlaylist(playlist);
    return { exists: true, ended, duration };
  } catch {
    return { exists: false, ended: false, duration: 0 };
  }
};

const isAllowedAsset = (name) => {
  const base = path.basename(String(name || ''));
  if (base === 'index.m3u8' || base === 'init.mp4' || base === 'meta.json') return true;
  return /^seg_\d+\.m4s$/.test(base);
};

const linkOrCopy = async (src, dst) => {
  try {
    await fs.link(src, dst);
  } catch (error) {
    if (error?.code !== 'EXDEV' && error?.code !== 'EPERM') throw error;
    await fs.copyFile(src, dst);
  }
};

/**
 * Publish a finished session dir as a shared rendition. Idempotent: the
 * second call for the same id is a no-op. Only links files; the session dir
 * stays untouched (its own TTL still governs it). The caller inserts the DB
 * row AFTER this resolves, so readers can never observe a partial publish.
 */
export const publishRendition = async ({ renditionId, sessionId }) => {
  const id = safeRenditionId(renditionId);
  if (!id) return { ok: false, reason: 'bad-id' };
  const sessionDir = path.dirname(sessionPath(sessionId, 'index.m3u8'));
  if (!sessionDir || sessionDir === path.dirname(sessionDir)) {
    return { ok: false, reason: 'bad-session' };
  }

  const outDir = renditionPath(id, '.');
  const metaPath = path.join(outDir, 'meta.json');
  try {
    await fs.stat(metaPath);
    return { ok: true, dedup: true };
  } catch {
    // Not published yet.
  }

  // Source must be complete RIGHT NOW, not "was complete when asked".
  let playlist;
  try {
    playlist = await fs.readFile(path.join(sessionDir, 'index.m3u8'), 'utf8');
  } catch {
    return { ok: false, reason: 'no-playlist' };
  }
  const { duration, ended } = parsePlaylist(playlist);
  if (!ended || duration <= 0) return { ok: false, reason: 'incomplete' };

  let entries;
  try {
    entries = await fs.readdir(sessionDir);
  } catch {
    return { ok: false, reason: 'no-dir' };
  }
  const assets = entries.filter((name) => isAllowedAsset(name) && name !== 'meta.json' && name !== 'index.m3u8');
  if (!assets.includes('init.mp4') || assets.filter((n) => n.startsWith('seg_')).length === 0) {
    return { ok: false, reason: 'missing-assets' };
  }

  await fs.mkdir(outDir, { recursive: true });
  // Logical bytes (sum of stat.size) for quota math. On the shared volume
  // these inodes are the SAME as the session's files (hard-link), so do not
  // add rendition bytes + transcode bytes and present the sum as physical
  // usage — physical truth comes only from statfs/freeDiskBytes.
  let bytes = 0;
  try {
    for (const name of [...assets, 'index.m3u8']) {
      const src = path.join(sessionDir, name);
      const dst = path.join(outDir, name);
      const stat = await fs.stat(src);
      if (!stat.isFile()) throw new Error(`not-a-file:${name}`);
      try {
        await fs.unlink(dst);
      } catch {
        // Fresh publish; nothing to replace.
      }
      await linkOrCopy(src, dst);
      bytes += stat.size;
    }
    await fs.writeFile(
      metaPath,
      JSON.stringify({ renditionId: id, bytes, duration, publishedAt: new Date().toISOString() }),
    );
  } catch (error) {
    await fs.rm(outDir, { recursive: true, force: true });
    return { ok: false, reason: `link-failed:${error.message}` };
  }
  return { ok: true, bytes, duration, segments: assets.filter((n) => n.startsWith('seg_')).length };
};

/**
 * Viewer pins on finished renditions: a rendition with a live viewer lease
 * is inviolable, even when expired or LRU-oldest. Pins are fed by the
 * session heartbeat/leave endpoints (a published session carries its
 * rendition id) and lapse on their own after a missed-lease window, so a
 * crashed tab cannot pin forever. In-memory like the writer leases: the
 * backend is a single process, and a restart orphans writers anyway.
 */
const renditionPins = new Map();

/** Add/refresh one viewer's pin. Unknown ids are ignored, never throw. */
export const pinRenditionViewer = (renditionId, viewerId, now = Date.now()) => {
  const id = safeRenditionId(renditionId);
  if (!id || !viewerId) return false;
  let viewers = renditionPins.get(id);
  if (!(viewers instanceof Map)) {
    viewers = new Map();
    renditionPins.set(id, viewers);
  }
  viewers.set(String(viewerId), Number(now) || Date.now());
  return true;
};

/** Drop one viewer's pin; prunes the id entirely when no viewers remain. */
export const unpinRenditionViewer = (renditionId, viewerId) => {
  const id = safeRenditionId(renditionId);
  const viewers = id ? renditionPins.get(id) : null;
  if (!(viewers instanceof Map)) return 0;
  if (viewerId) viewers.delete(String(viewerId));
  if (viewers.size === 0) renditionPins.delete(id);
  return viewers.size;
};

/** True when one rendition holds any unexpired viewer lease (sweeping only
 * its own stale viewers). Used as a last-moment re-check before unlink: a
 * heartbeat that lands after the budget snapshot must still save the file.
 */
export const isRenditionPinned = (renditionId, { now = Date.now(), leaseMs = VIEWER_LEASE_MS } = {}) => {
  const id = safeRenditionId(renditionId);
  const viewers = id ? renditionPins.get(id) : null;
  if (!(viewers instanceof Map)) return false;
  const t = Number(now) || Date.now();
  for (const [viewerId, seen] of viewers) {
    if (t - (Number(seen) || 0) >= leaseMs) viewers.delete(viewerId);
  }
  if (viewers.size === 0) {
    renditionPins.delete(id);
    return false;
  }
  return true;
};

/** Live pins after sweeping lapsed leases. Exported for budget enforcement. */
export const getPinnedRenditionIds = ({ now = Date.now(), leaseMs = VIEWER_LEASE_MS } = {}) => {
  const t = Number(now) || Date.now();
  const pinned = new Set();
  for (const [id, viewers] of renditionPins) {
    if (!(viewers instanceof Map)) {
      renditionPins.delete(id);
      continue;
    }
    for (const [viewerId, seen] of viewers) {
      if (t - (Number(seen) || 0) >= leaseMs) viewers.delete(viewerId);
    }
    if (viewers.size === 0) renditionPins.delete(id);
    else pinned.add(id);
  }
  return pinned;
};

/**
 * Eviction planner (pure): expired rows first (oldest access first), then
 * least-recently-used until under budget — SKIPPING anything pinned by a
 * live viewer lease. Mirrors the transcode janitor's semantics so operators
 * get one mental model for both stores. When everything is pinned, the
 * answer is an empty evict list (log, do not delete what is being watched).
 */
export const selectRenditionEvictions = (
  entries,
  { now = Date.now(), maxBytes = RENDITION_MAX_BYTES, ttlMs = RENDITION_TTL_MS, pinnedIds = null } = {},
) => {
  const pinned = pinnedIds instanceof Set ? pinnedIds : new Set();
  const isPinned = (id) => pinned.has(String(id || '').toLowerCase());
  // Pinned bytes still occupy the disk: they count toward the cap (forcing
  // unpinned victims out) but can never be victims themselves.
  const pinnedBytes = (entries || [])
    .filter((e) => e?.renditionId && isPinned(e.renditionId))
    .reduce((sum, e) => sum + (Number(e.bytes) || 0), 0);
  const rows = (entries || [])
    .filter((e) => e && e.renditionId && !isPinned(e.renditionId))
    .map((e) => ({
      renditionId: e.renditionId,
      bytes: Number(e.bytes) || 0,
      lastAccessAtMs: Number(e.lastAccessAtMs ?? e.lastAccessAt ?? e.createdAtMs ?? 0),
    }));
  const expired = rows
    .filter((e) => now - e.lastAccessAtMs > ttlMs)
    .sort((a, b) => a.lastAccessAtMs - b.lastAccessAtMs)
    .map((e) => e.renditionId);
  const expiredBytes = rows
    .filter((e) => expired.includes(e.renditionId))
    .reduce((sum, e) => sum + e.bytes, 0);
  let live = rows.filter((e) => !expired.includes(e.renditionId));
  let total = pinnedBytes + live.reduce((sum, e) => sum + e.bytes, 0);
  const overCap = [];
  live = [...live].sort((a, b) => a.lastAccessAtMs - b.lastAccessAtMs);
  while (total > maxBytes && live.length > 0) {
    const victim = live.shift();
    overCap.push(victim.renditionId);
    total -= victim.bytes;
  }
  return { evict: [...expired, ...overCap], expiredBytes };
};
