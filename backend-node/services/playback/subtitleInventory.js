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
