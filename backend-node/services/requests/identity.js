/** Read identifiers, never fetch a URL supplied in request notes. */
export function requestIdentity(row) {
  const id = Number(row.tmdbId);
  if (Number.isSafeInteger(id) && id > 0) {
    return { tmdbId: id, mediaType: row.mediaType === 'tv' ? 'tv' : 'movie' };
  }
  const refs = new Map();
  for (const text of String(row.note || '').slice(0, 8192).match(/https?:\/\/[^\s<>"']+/gi) || []) {
    try {
      const url = new URL(text);
      if (url.username || url.password || url.port) continue;
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const match = host === 'cinevn.me'
        ? url.pathname.match(/^\/(?:phim|xem-phim)\/(movie|tv)\/([1-9]\d*)(?:\/|$)/)
        : host === 'themoviedb.org' ? url.pathname.match(/^\/(movie|tv)\/([1-9]\d*)(?:[-/]|$)/) : null;
      if (!match) continue;
      const tmdbId = Number(match[2]);
      if (!Number.isSafeInteger(tmdbId)) continue;
      refs.set(`${match[1]}:${tmdbId}`, { tmdbId, mediaType: match[1] });
    } catch { /* Free text or a malformed link is not an identifier. */ }
  }
  if (refs.size > 1) return { ambiguous: true };
  return refs.size === 1 ? [...refs.values()][0] : null;
}
