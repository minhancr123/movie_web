import { safeFetchJson } from '../security/safeFetch.js';
import { normalizeTitle, scoreMeta, MIN_MATCH_SCORE } from './vimoMatch.js';

const REQUEST_TIMEOUT_MS = 5000; // Giảm xuống 5s để không làm nghẽn luồng resolve chính

const DEFAULT_YASTREAM_BASE_URL =
  'https://yastream.tamthai.de/eyJjYXRhbG9ncyI6WyJraXNza2guc2VyaWVzLktvcmVhbiIsIm9uZXRvdWNodHYuc2VyaWVzLktvcmVhbiIsImtpc3NraC5zZXJpZXMuU2VhcmNoIiwia2lzc2toLm1vdmllLlNlYXJjaCIsIm9uZXRvdWNodHYuc2VyaWVzLlNlYXJjaCIsImlkcmFtYS5zZXJpZXMuaURyYW1hIiwiaWRyYW1hLnNlcmllcy5TZWFyY2giXSwiY2F0YWxvZyI6WyJraXNza2giLCJvbmV0b3VjaHR2Il0sInN0cmVhbSI6WyJraXNza2giLCJvbmV0b3VjaHR2Iiwia2twaGltIiwib3BoaW0iXSwibnNmdyI6ZmFsc2UsImluZm8iOmZhbHNlLCJwb3N0ZXIiOiJycGRiIiwibWZwVXJsIjoiIiwidGJLZXkiOiIiLCJtZnBQYXNzIjoiIn0=';

const baseUrl = () =>
  (process.env.YASTREAM_ADDON_URL || DEFAULT_YASTREAM_BASE_URL)
    .trim()
    .replace(/\/manifest\.json$/i, '')
    .replace(/\/+$/, '');

export const resolveYaStreamSource = async ({ type, tmdbId, season = null, episode = null, detail = {} }) => {
  const titles = [detail?.name, detail?.englishTitle, detail?.originalTitle, detail?.title].filter(Boolean);
  const year = Number.isInteger(detail?.year) ? detail.year : null;
  
  // Stremio ID format: tt... for movies, tt...:s:e for series
  // If no IMDb ID, YaStream might not work well, but we can try search if they support it.
  const id = detail.imdbId || `tmdb:${tmdbId}`;
  const streamId = type === 'tv' ? `${id}:${season}:${episode}` : id;

  const stremioType = type === 'tv' ? 'series' : type;

  try {
    const url = `${baseUrl()}/stream/${stremioType}/${encodeURIComponent(streamId)}.json`;
    const payload = await safeFetchJson(url, { timeoutMs: REQUEST_TIMEOUT_MS });
    
    if (!Array.isArray(payload?.streams) || payload.streams.length === 0) return null;

    return {
      name: 'YaStream (KKPhim/OPhim)',
      origin: 'yastream',
      streams: payload.streams.map((s, index) => ({
        id: `yastream:${index}:${Buffer.from(s.url || '').toString('base64url').slice(0, 16)}`,
        sourceToken: `yastream:${index}:${Buffer.from(s.url || '').toString('base64url').slice(0, 16)}`,
        name: s.name || 'YaStream',
        origin: 'yastream',
        title: s.description || s.title || 'Vietsub',
        url: s.url,
        behaviorHints: s.behaviorHints,
        playable: true
      }))
    };
  } catch (error) {
    console.warn(`[yastream] lookup failed: ${error.message}`);
    return null;
  }
};

export default { resolveYaStreamSource };
