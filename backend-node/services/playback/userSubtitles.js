/**
 * Viewer-uploaded subtitles (.srt, and .vtt passed through).
 *
 * When no timed sidecar exists for the playing file — the common case the
 * drift warning describes — the viewer often HAS the right file on their own
 * disk. This takes it: validate, convert to WebVTT, store per user+title,
 * and serve it back through the same token URLs as every other track.
 *
 * Security shape, all enforced, none assumed:
 * - JSON body, never multipart: no new parser dependency, and the route
 *   carries its own 3MB body limit instead of raising the global one.
 * - Size cap (2MB text) + cue-structure validation: a mislabeled binary or
 *   an HTML error page must fail here, not render as garbage cues later.
 * - Random hex filenames under a user-scoped directory: the original
 *   filename never touches the disk, so no traversal and no collisions.
 * - Count cap per title+episode (oldest pruned with its file): uploads are
 *   small but unbounded "small" is how disks fill.
 * - Served only through the same unguessable vtt tokens as embedded tracks,
 *   minted per list request — never a stable path.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const UPLOAD_MAX_PER_TITLE = 10;

const SRT_TS = '(\\d{1,2}):(\\d{2}):(\\d{2})[,.](\\d{1,3})';
const SRT_STAMP_LINE = new RegExp(`^\\s*${SRT_TS}\\s*-->\\s*${SRT_TS}\\s*.*$`);

const toMs = (h, m, s, ms) =>
  Number(h) * 3600000 + Number(m) * 60000 + Number(s) * 1000 + Number(String(ms).padEnd(3, '0').slice(0, 3));

/**
 * Parse SRT text into cues, or throw a viewer-readable reason. Pure and
 * strict on structure, lenient on content: sequence numbers optional,
 * positions/ass tags kept for the text cleaner downstream, but at least one
 * cue needs a valid stamp pair and non-blank text.
 */
export const parseSrt = (text) => {
  const clean = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!clean.trim()) throw new Error('File trống, không có nội dung');
  const blocks = clean.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trimEnd());
    const stampIdx = lines.findIndex((l) => SRT_STAMP_LINE.test(l));
    if (stampIdx === -1) continue;
    const m = lines[stampIdx].match(
      new RegExp(`^\\s*${SRT_TS}\\s*-->\\s*${SRT_TS}`),
    );
    if (!m) continue;
    const start = toMs(m[1], m[2], m[3], m[4]);
    const end = toMs(m[5], m[6], m[7], m[8]);
    const content = lines.slice(stampIdx + 1).join('\n').trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (!content) continue;
    cues.push({ start, end, text: content });
  }
  if (cues.length === 0) {
    throw new Error('Không đọc được khung giờ nào — file có đúng là .srt không?');
  }
  return cues;
};

const fmtVttTs = (ms) => {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = Math.floor(ms % 1000);
  const pad = (n, w) => String(n).padStart(w, '0');
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}.${pad(r, 3)}`;
};

/** SRT text (or already-VTT) → WebVTT document. Throws viewer-readable reasons. */
export const toVttDocument = (text, filename = '') => {
  const raw = String(text || '');
  if (Buffer.byteLength(raw, 'utf8') > UPLOAD_MAX_BYTES) {
    throw new Error(`File quá lớn (tối đa ${UPLOAD_MAX_BYTES / 1024 / 1024}MB)`);
  }
  const isVtt = /^\s*WEBVTT/i.test(raw.replace(/^\uFEFF/, '')) || /\.vtt$/i.test(filename);
  if (isVtt) {
    // Passed through, not re-serialized: the player parses VTT itself and
    // rewriting risks mangling cues it already understands.
    const cues = parseSrt(raw.replace(/^\s*WEBVTT[^\n]*\n/, ''));
    if (cues.length === 0) throw new Error('Không đọc được khung giờ nào trong file .vtt');
    return raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim() + '\n';
  }
  const cues = parseSrt(raw);
  return `WEBVTT\n\n${cues.map((c) => `${fmtVttTs(c.start)} --> ${fmtVttTs(c.end)}\n${c.text}`).join('\n\n')}\n`;
};

export const uploadKey = ({ userId, tmdbId, season = null, episode = null }) =>
  [String(userId), String(tmdbId), season ?? '', episode ?? ''].join(':');

export default {
  UPLOAD_MAX_BYTES,
  UPLOAD_MAX_PER_TITLE,
  parseSrt,
  toVttDocument,
  uploadKey,
};
