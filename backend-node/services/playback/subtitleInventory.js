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
  `v6-${scope}-w${window.startAt}-${index}.vtt`;
export const isCompletedSubtitle = async file => {
  try { return /^WEBVTT(?:\s|$)/.test(await fs.readFile(file, 'utf8')); }
  catch { return false; }
};

// Coverage is embedded in the atomically published VTT, so bytes and metadata
// cannot disagree after a concurrent read or a process restart.
const COVERAGE_NOTE = /^NOTE CINEVN-COVERAGE (.+)$/m;
export const mergeSubtitleCoverage = ranges => {
  const sorted = (Array.isArray(ranges) ? ranges : [])
    .filter(r => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite)
      && r[0] >= 0 && r[1] <= 172800 && r[1] > r[0])
    .map(r => [...r]).sort((a, b) => a[0] - b[0]);
  const result = [];
  for (const [start, end] of sorted) {
    const last = result[result.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else result.push([start, end]);
  }
  return result;
};
export const subtitleCoverageFromText = text => {
  if (!/^WEBVTT(?:\s|$)/.test(text)) return [];
  try { return mergeSubtitleCoverage(JSON.parse(text.match(COVERAGE_NOTE)?.[1] || 'null')); }
  catch { return []; }
};
export const withSubtitleCoverage = (text, ranges) => {
  const blocks = String(text).replace(/\r\n/g, '\n').split(/\n\s*\n/)
    .filter(block => !/^NOTE CINEVN-COVERAGE /.test(block.trim()));
  const header = blocks.shift()?.trim() || 'WEBVTT';
  return `${header}\n\nNOTE CINEVN-COVERAGE ${JSON.stringify(mergeSubtitleCoverage(ranges))}\n\n${blocks.join('\n\n').trim()}\n`;
};
const coverageContains = (ranges, start, end) => ranges.some(r => r[0] <= start && r[1] >= end);
export const subtitleWindowStatus = async (file, window) => {
  const text = await fs.readFile(file, 'utf8').catch(() => '');
  const ranges = subtitleCoverageFromText(text);
  const start = window.startAt;
  const end = start + window.durationSeconds;
  return { ready: coverageContains(ranges, start, Math.min(end, start + 120)),
    fullCoverage: coverageContains(ranges, start, end), ranges };
};

const VTT_CUE_TIME = /^((?:\d{1,3}:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d{1,3}:)?\d{2}:\d{2}\.\d{3})/;
const vttStampSeconds = stamp => String(stamp).split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
const cueTimes = block => {
  const timing = block.trim().split('\n').find(line => VTT_CUE_TIME.test(line));
  const match = timing?.match(VTT_CUE_TIME);
  return match ? [vttStampSeconds(match[1]), vttStampSeconds(match[2])] : null;
};

/** Reuse only measured coverage. Slices never manufacture new covered time. */
export const trySliceWindowFromCoverage = async (subsRoot, scope, index, window) => {
  const start = window.startAt;
  const end = start + window.durationSeconds;
  const names = await fs.readdir(subsRoot).catch(() => []);
  const prefix = `v6-${scope}-w`;
  const suffix = `-${index}.vtt`;
  const sources = [];
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith(suffix)
      || !/^\d+$/.test(name.slice(prefix.length, -suffix.length))) continue;
    const text = await fs.readFile(`${subsRoot}/${name}`, 'utf8').catch(() => '');
    const ranges = subtitleCoverageFromText(text)
      .map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b > a);
    if (ranges.length) sources.push({ text, ranges });
  }
  const ranges = mergeSubtitleCoverage(sources.flatMap(source => source.ranges));
  if (!coverageContains(ranges, start, Math.min(end, start + 120))) return { sliced: false, fullCoverage: false };
  const unique = new Map();
  for (const source of sources) {
    for (const block of source.text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
      const times = cueTimes(block);
      if (times && times[1] > start && times[0] < end) unique.set(block.trim(), times[0]);
    }
  }
  const blocks = [...unique].sort((a, b) => a[1] - b[1]).map(([block]) => block);
  const body = withSubtitleCoverage(`WEBVTT\n\n${blocks.join('\n\n')}\n`, ranges);
  const out = `${subsRoot}/${subtitleSidecarName(scope, index, window)}`;
  const temp = `${out}.slice-${Date.now()}-${Math.random().toString(36).slice(2)}.vtt`;
  try { await fs.writeFile(temp, body); await fs.rename(temp, out); }
  finally { await fs.rm(temp, { force: true }).catch(() => {}); }
  return { sliced: true, fullCoverage: coverageContains(ranges, start, end) };
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
