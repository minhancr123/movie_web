/** TMDB service returns normalized items, not the upstream results envelope. */
export const movieRequestMatches = payload => (payload?.items || [])
  .filter(item => ['movie', 'tv'].includes(item.mediaType) && Number.isInteger(item.tmdbId) && item.tmdbId > 0)
  .slice(0, 6)
  .map(item => ({
    tmdbId: item.tmdbId,
    mediaType: item.mediaType,
    title: item.title || item.originalTitle || '',
    year: item.year ? String(item.year) : null,
    poster: item.poster || null,
    popularity: item.popularity || 0,
  }));
