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
