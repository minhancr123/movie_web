import crypto from 'crypto';
import path from 'path';
import { matchesTitle } from './sourceRanker.js';

export const FILE_SELECTION_BUILD = 2;
// A torrent hash identifies a pack, not a film. Every byte-derived cache must
// include the selected file ID (including zero), never the array position.
export const fileIdentity = (hash, fileId) => {
  const id = fileId == null ? 'unknown' : /^\d+$/.test(String(fileId))
    ? String(Number(fileId)) : crypto.createHash('sha256').update(String(fileId)).digest('hex').slice(0, 16);
  return `${String(hash).toLowerCase()}-${id}`;
};
const basename = (name) => path.posix.basename(String(name || '').replaceAll('\\', '/')).toLowerCase();
const videoName = (file) => basename(file.name || file.path);
const biggest = (files) => [...files].sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0] || null;

export const pickBestFile = (files, { season = null, episode = null, fileIdx = null, filename = '', expectedTitles = [], expectedYear = null } = {}) => {
  const videos = (Array.isArray(files) ? files : []).filter((f) => f?.fileId != null
    && /\.(mkv|mp4|avi|mov|webm|m2ts|ts|m4v)$/i.test(videoName(f))
    && !/(^|[ ._\/-])(sample|trailer|proof|subpack)([ ._\/-]|$)/i.test(videoName(f)));
  if (!videos.length) return null;
  const hinted = (pool) => pool.find((f) => filename && videoName(f) === basename(filename))
    || pool.find((f) => fileIdx != null && String(f.fileId) === String(fileIdx));
  if (Number.isInteger(season) && Number.isInteger(episode)) {
    const s = String(season).padStart(2, '0'), e = String(episode).padStart(2, '0');
    const exact = videos.filter((f) => new RegExp(`s${s}e${e}(?![0-9])|${season}x${e}(?![0-9])`, 'i').test(videoName(f)));
    if (exact.length) return hinted(exact) || biggest(exact);
    const weak = videos.filter((f) => new RegExp(`(?:^|[ ._-])(?:e|ep)${e}(?![0-9])|tap ${episode}(?![0-9])`, 'i').test(videoName(f)));
    return hinted(weak) || biggest(weak) || hinted(videos) || biggest(videos);
  }
  if (expectedTitles.length) {
    // Compare the individual basename: pack directories may name every year.
    const matches = videos.filter((f) => matchesTitle(videoName(f), expectedTitles, expectedYear).matched);
    if (matches.length) return hinted(matches) || biggest(matches);
    const explicit = hinted(videos);
    if (explicit && !matchesTitle(videoName(explicit), expectedTitles, expectedYear).yearConflict) return explicit;
    // Never guess the largest unrelated film in a multi-movie pack.
    if (videos.length > 1 || matchesTitle(videoName(videos[0]), expectedTitles, expectedYear).yearConflict) return null;
  }
  return hinted(videos) || biggest(videos);
};
