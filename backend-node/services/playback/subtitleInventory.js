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
