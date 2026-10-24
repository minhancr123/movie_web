import fs from 'node:fs/promises';

// Preserve original indices: IDs must still address the same stream after
// prioritization. Vietnamese can appear after dozens of other languages.
export const selectEmbeddedSubtitleTracks = (subtitles, convertible, limit = 6) => {
  const priority = language => {
    const tag = String(language || '').trim().toLowerCase();
    return ['vi', 'vie', 'vit'].includes(tag) ? 0 : ['en', 'eng'].includes(tag) ? 1 : 2;
  };
  return (subtitles || [])
    .map((s, inventoryIndex) => ({ ...s, inventoryIndex }))
    .filter(s => convertible(s.codec))
    .sort((a, b) => priority(a.language) - priority(b.language) || a.inventoryIndex - b.inventoryIndex)
    .slice(0, limit);
};

export const needsEmbeddedInventory = ({ externalOnly, ownedSession, probeFacts, readyTracks, convertible }) => {
  if (externalOnly || !ownedSession) return false;
  if (!probeFacts) return true;
  return selectEmbeddedSubtitleTracks(probeFacts.subtitles, convertible)
    .some(s => !readyTracks.some(t => Number(String(t.id).split(':').pop()) === s.inventoryIndex));
};

// Overlap leaves time to prepare the next slice while the current one plays.
export const subtitleWindowAt = value => {
  const at = Math.max(0, Math.min(86400, Number(value) || 0));
  return { startAt: Math.floor(at / 120) * 120, durationSeconds: 300 };
};
export const subtitleSidecarName = (scope, index, window) =>
  `v5-${scope}-w${window.startAt}-${index}.vtt`;
export const isCompletedSubtitle = async file => {
  try { return /^WEBVTT(?:\s|$)/.test(await fs.readFile(file, 'utf8')); }
  catch { return false; }
};

// Windows step in buckets of 120s and span 300s, so neighbours overlap: a
// viewer seeking one bucket forward already HAS most of the bytes in a
// previously completed sidecar. Reading them again (or worse, telling the
// player "not ready" for 30-60s) is what made seeking feel like the subtitle
// vanished.
const VTT_CUE_TIME = /^((?:\d{1,3}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{1,3}:)?\d{2}:\d{2}\.\d{3})/;
const vttStampSeconds = stamp => {
  let seconds = 0;
  for (const part of String(stamp).split(':')) seconds = seconds * 60 + Number(part);
  return Number.isFinite(seconds) ? seconds : NaN;
};

const cuesWithin = (text, start, end) => {
  const out = [];
  for (const block of String(text).split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed || /^(WEBVTT|NOTE|STYLE|REGION)\b/.test(trimmed)) continue;
    const match = VTT_CUE_TIME.exec(trimmed.split('\n').find(l => VTT_CUE_TIME.test(l)) || '');
    if (!match) continue;
    const cueStart = vttStampSeconds(match[1]);
    const cueEnd = vttStampSeconds(match[2]);
    if (Number.isFinite(cueStart) && Number.isFinite(cueEnd)
      && cueEnd > start && cueStart < end) out.push(trimmed);
  }
  return out;
};

/**
 * Build the requested window sidecar from completed sidecars of the same
 * track whose coverage overlaps it. Returns { sliced, fullCoverage }:
 * sliced=true means the file now exists and covers at least the CURRENT
 * bucket (the 120s the viewer is actually in); fullCoverage=false means the
 * rest of the 300s span is missing and a background refill is worthwhile.
 */
export const trySliceWindowFromCoverage = async (subsRoot, scope, index, window) => {
  const requestedStart = window.startAt;
  const requestedEnd = window.startAt + window.durationSeconds;
  const bucketEnd = requestedStart + 120;
  const names = await fs.readdir(subsRoot).catch(() => []);
  const sidecarRe = new RegExp(`^v5-${String(scope).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-w(\\d+)-${index}\\.vtt$`);
  const sources = [];
  for (const name of names) {
    const match = sidecarRe.exec(name);
    if (!match) continue;
    const file = `${subsRoot}/${name}`;
    if (!(await isCompletedSubtitle(file))) continue;
    const start = Number(match[1]);
    sources.push({ file, start, end: start + window.durationSeconds });
  }
  if (!sources.length) return { sliced: false, fullCoverage: false };

  // Union of source coverage vs the ranges we care about.
  const segments = sources.map(src => [src.start, src.end]).sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const [start, end] of segments) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  const covers = (from, to) => merged.some(([start, end]) => start <= from && end >= to);
  if (!covers(requestedStart, bucketEnd)) return { sliced: false, fullCoverage: false };

  const seen = new Set();
  const cueBlocks = [];
  for (const src of sources) {
    const text = await fs.readFile(src.file, 'utf8').catch(() => '');
    for (const cue of cuesWithin(text, requestedStart, requestedEnd)) {
      if (seen.has(cue)) continue; // overlapping windows carry duplicate cues
      seen.add(cue);
      cueBlocks.push(cue);
    }
  }
  cueBlocks.sort((a, b) => {
    const ta = vttStampSeconds(VTT_CUE_TIME.exec(a)?.[1] || '0:00.000');
    const tb = vttStampSeconds(VTT_CUE_TIME.exec(b)?.[1] || '0:00.000');
    return ta - tb;
  });
  const body = cueBlocks.length ? `WEBVTT\n\n${cueBlocks.join('\n\n')}\n` : 'WEBVTT\n';
  const out = `${subsRoot}/${subtitleSidecarName(scope, index, window)}`;
  const temp = `${out}.slice-${Date.now()}-${Math.random().toString(36).slice(2)}.vtt`;
  await fs.writeFile(temp, body);
  await fs.rename(temp, out);
  return { sliced: true, fullCoverage: covers(requestedStart, requestedEnd) };
};

// Input seeking can rewind to an earlier video keyframe. Keep original cue
// timestamps, but discard cues entirely outside the requested subtitle slice.
export const trimSubtitleWindow = (text, window) => {
  if (!(window.durationSeconds > 0)) return text;
  const seconds = value => value.split(':').reduce((at, part) => at * 60 + Number(part), 0);
  const end = window.startAt + window.durationSeconds;
  return text.replace(/\r\n/g, '\n').split(/\n\s*\n/).filter((block, index) => {
    if (index === 0) return true;
    const times = block.match(/([\d:.]+)\s+-->\s+([\d:.]+)/);
    return times && seconds(times[2]) > window.startAt && seconds(times[1]) < end;
  }).join('\n\n') + '\n\n';
};
