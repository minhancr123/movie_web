import crypto from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { safeFetchJson, assertUrlShape, isPrivateAddress } from '../security/safeFetch.js';
import { normalizeTitle } from './vimoMatch.js';

// Fixed public catalogues; no arbitrary addon URL or debrid credential is forwarded.
const catalogues = [
  { id: 'kkphim', base: 'https://phimapi.com', search: '/v1/api/tim-kiem', detail: '/phim/' },
  { id: 'nguonc', base: 'https://phim.nguonc.com', search: '/api/films/search', detail: '/api/film/' },
];
export const matchesVietnameseCatalogue = (item, detail, requireYear = true) => {
  const tmdb = item.tmdb?.id, imdb = item.imdb?.id;
  if (tmdb && Number(tmdb) !== Number(detail.tmdbId)) return false;
  if (imdb && detail.imdbId && imdb !== detail.imdbId) return false;
  const names = [item.name, item.origin_name, item.original_name].map(normalizeTitle).filter(Boolean);
  const expected = [detail.title, detail.originalTitle, detail.englishTitle].map(normalizeTitle).filter(Boolean);
  if (!names.some(x => expected.includes(x))) return false;
  const year = Number(item.year);
  return (!requireYear && !year) || Boolean(year && year === Number(detail.year));
};
export const catalogueStreams = (movie, groups, { type, season, episode }, provider) => {
  const total = Number(movie.total_episodes || movie.episode_total) || 1;
  if (type === 'movie' && (movie.type === 'series' || total > 1)) return [];
  if (type === 'tv' && (Number(movie.tmdb?.season) > 0 ? Number(movie.tmdb.season) !== season : season !== 1)) return [];
  const result = [];
  for (const group of groups || []) {
    const episodes = group.server_data || group.items || [];
    // A movie must be one full feature, never arbitrarily the first item of a pack.
    const selected = type === 'movie' ? (episodes.length === 1 ? episodes : episodes.filter(x => /^(full|complete)$/i.test(x.name || '')))
      : episodes.filter(x => Number(String(x.name || x.slug || '').replace(/^(tap|ep|episode)\s*/i,'')) === episode);
    for (const ep of selected) {
      const url = ep.link_m3u8 || ep.m3u8;
      if (!url || /trailer|teaser|sample/i.test(ep.name || '')) continue;
      try { const { url: parsed } = assertUrlShape(url); if (parsed.protocol !== 'https:' || parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local')) continue; } catch { continue; }
      const id = crypto.createHash('sha256').update(`${provider}:${movie.slug}:${season ?? ''}:${episode ?? ''}:${group.server_name || ''}:${ep.slug || ep.name || ''}`).digest('hex').slice(0,24);
      result.push({ id: `yastream:vn:${id}`, sourceToken: `yastream:vn:${id}`, origin: 'yastream', name: provider,
        title: `${movie.name} • ${group.server_name || 'Vietsub'} • ${movie.quality || ''}`, url, playable: true });
    }
  }
  return result.slice(0,6);
};

export async function validateCatalogueVideoUrl(raw) {
  const { url } = assertUrlShape(raw);
  if (url.protocol !== 'https:') return false;
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g,''), { all: true });
  return addresses.length > 0 && addresses.every(x => !isPrivateAddress(x.address));
}

export async function lookupVietnameseCatalogues(args, { fetchJson = safeFetchJson, validateUrl = validateCatalogueVideoUrl } = {}) {
  const queries = [...new Set([args.detail.title, args.detail.originalTitle, args.detail.englishTitle].filter(Boolean))].slice(0,2);
  const get = url => fetchJson(url, { timeoutMs: 2200, headers: { 'user-agent': 'Mozilla/5.0 (compatible; CineVN/1.0)' } });
  const results = await Promise.all(catalogues.map(async provider => {
    try {
      const searches = await Promise.all(queries.map(async query => {
        try { const d = await get(`${provider.base}${provider.search}?keyword=${encodeURIComponent(query)}&limit=24`); return d.data?.items || d.items || []; }
        catch { return []; }
      }));
      const candidates = [...new Map(searches.flat().filter(x => x.slug && matchesVietnameseCatalogue(x,args.detail,false)).map(x => [x.slug,x])).values()];
      if (candidates.length !== 1 || !/^[\p{L}\p{N}_-]+$/u.test(candidates[0].slug)) return [];
      const data = await get(provider.base+provider.detail+encodeURIComponent(candidates[0].slug));
      const movie = data.movie || data.data?.item;
      if (!movie || !matchesVietnameseCatalogue(movie,args.detail)) return [];
      return catalogueStreams(movie, data.episodes || movie.episodes || data.data?.episodes || [], args, provider.id);
    } catch { return []; }
  }));
  const checked = await Promise.all(results.flat().map(async stream => {
    try { return await validateUrl(stream.url) ? stream : null; } catch { return null; }
  }));
  return checked.filter(Boolean);
}
