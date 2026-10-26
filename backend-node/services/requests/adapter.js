import { getDecryptedKey } from '../providers/connectionStore.js';
import * as tmdb from '../tmdb.js';
import * as torbox from '../debrid/torbox.js';
import { getStreamCandidates } from '../addonClient.js';
import { rankCandidates, matchesTitle } from '../playback/sourceRanker.js';
import { pickBestFile } from '../playback/fileSelection.js';
import { resolveVimoSource } from '../playback/vimoClient.js';
import { resolveYaStreamSource } from '../playback/yastreamClient.js';
import { ffprobe } from '../playback/remuxService.js';
import { assertUrlShape, isPrivateAddress } from '../security/safeFetch.js';
import { lookup } from 'node:dns/promises';
import { cached, CACHE_TTL } from '../../config/redis.js';
import { findRequestMatch, readyProbe, matchesRequestedEpisode } from './policy.js';
import { credentialScope } from './library.js';

const caps = { hevc: true, hevcMain10: true, av1: true, hdr: true, eac3: true, maxHeight: 2160, preferredMaxHeight: 1080 };
const titles = detail => [detail.title, detail.originalTitle, detail.englishTitle].filter(Boolean);
async function readable(url) {
  // Provider links are private capabilities: validate, read a bounded prefix,
  // and never persist or log either the URL or ffprobe errors containing it.
  let current = url;
  for (let redirects = 0; redirects < 4; redirects++) {
    const { url: parsed } = assertUrlShape(current);
    const addresses = await lookup(parsed.hostname, { all: true });
    if (!addresses.length || addresses.some(a => isPrivateAddress(a.address))) return null;
    const response = await fetch(current, { headers: { Range: 'bytes=0-65535' }, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location) return null; current = new URL(location, current).toString(); continue;
    }
    if (![200,206].includes(response.status)) { await response.body?.cancel(); return null; }
    const reader = response.body.getReader(); let bytes = 0;
    try { while (bytes < 65536) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; } }
    finally { await reader.cancel(); }
    return bytes > 0 ? current : null;
  }
  return null;
}
export const createRuntimeRequestAdapter = db => ({
  scope: credentialScope,
  async detail(row) {
    let id = Number(row.tmdbId), type = row.mediaType || 'movie';
    if (!id) {
      const list = await tmdb.search(row.title);
      const match = findRequestMatch(row.title, list.items);
      if (!match) return null; id = match.tmdbId; type = match.mediaType;
    }
    const detail = await cached(`catalog:detail:${type}:${id}:v3`, CACHE_TTL.DETAIL, () => tmdb.getDetail(type,id), tmdb.STALE_OPTS);
    if (!detail || !matchesTitle(row.title, titles(detail), detail.year).matched) return null;
    return { ...detail, tmdbId: id, mediaType: type };
  },
  async key(row) { try { return (await getDecryptedKey(db, row.userId, 'torbox')).key; } catch { return null; } },
  async discover(detail, row, key) {
    const args = { type: detail.mediaType, tmdbId: detail.tmdbId, detail, season: row.season ?? null, episode: row.episode ?? null, requestDiscovery: true };
    const [ya,vimo,streams] = await Promise.all([
      resolveYaStreamSource(args), resolveVimoSource(args),
      detail.imdbId ? getStreamCandidates({ imdbId: detail.imdbId, mediaType: detail.mediaType, season: row.season, episode: row.episode,
        debridKey: key, requestDiscovery: true }) : { candidates: [] },
    ]);
    const direct = [...(ya?.streams || []), ...(vimo?.streams || []).map(s => ({ ...s,
      sourceToken: `vimo|${detail.mediaType === 'tv' ? 'series' : 'movie'}|${vimo.vimoId}${detail.mediaType === 'tv' ? `:${row.season}:${row.episode}` : ''}` }))]
      .filter(s => s.url).slice(0, 3).map(s => ({ kind: 'direct', sourceToken: s.sourceToken, url: s.url, filename: s.title || detail.title, cached: true }));
    let availability = {};
    if (key && streams.candidates.length) availability = await torbox.checkCached(key, streams.candidates.map(c => c.infoHash));
    const ranked = rankCandidates(streams.candidates.map(c => ({ ...c, cached: availability[c.infoHash] === 'cached' })), caps, {
      expectedTitles: titles(detail), expectedYear: detail.year, runtimeMinutes: detail.runtime, contentLanguage: detail.originalLanguage,
    }).playable;
    const ordered = ranked.filter(c => matchesTitle(c.filename || c.label, titles(detail), detail.year).matched)
      .sort((a,b) => Number(b.cached)-Number(a.cached) || Math.abs((a.resolution || 1080)-1080)-Math.abs((b.resolution || 1080)-1080));
    return [...ordered.filter(c => c.cached), ...direct, ...ordered.filter(c => !c.cached)];
  },
  persist(candidate) {
    if (candidate.kind === 'direct') return { kind: 'direct', sourceToken: candidate.sourceToken, filename: candidate.filename, cached: true };
    return Object.fromEntries(['infoHash','filename','fileIdx','label','sizeBytes','resolution','codec','hdr','cached','torrentId'].map(k => [k,candidate[k] ?? null]));
  },
  async prepare(candidate, key, row) {
    if (candidate.kind === 'direct') {
      // A stored job contains no URL. Rediscovery remints an expiring link.
      if (candidate.url) return { state: 'ready', url: candidate.url };
      throw Object.assign(new Error('rediscover'), { code: 'not_found' });
    }
    if (!key) throw Object.assign(new Error('provider'), { code: 'no_connection' });
    return torbox.prepareSource(key, { infoHash: candidate.infoHash, torrentId: candidate.torrentId,
      magnet: candidate.magnet || `magnet:?xt=urn:btih:${candidate.infoHash}`, assumeCached: true });
  },
  async verify(candidate, prepared, detail, row, key) {
    let url = prepared.url, file = null;
    if (candidate.kind !== 'direct') {
      file = pickBestFile(prepared.files, { filename: candidate.filename, fileIdx: candidate.fileIdx,
        expectedTitles: titles(detail), expectedYear: detail.year, season: row.season, episode: row.episode });
      if (!file || !matchesTitle(file.name || file.path, titles(detail), detail.year).matched) return null;
      if (detail.mediaType === 'tv' && !matchesRequestedEpisode(file.name || file.path, row.season, row.episode)) return null;
      url = await torbox.getDownloadUrl(key, { torrentId: prepared.torrentId, fileId: file.fileId, userId: 'request-worker-'+credentialScope(key).slice(0,16) });
    }
    const checked = await readable(url); if (!checked) return null;
    const probe = await ffprobe(checked);
    if (!readyProbe(probe, detail.runtime)) return null;
    return { file, probe };
  },
  async publish(candidate, prepared, detail, row, key, verified) {
    if (candidate.kind === 'direct') return;
    const scope = credentialScope(key), file = verified.file;
    const selected = { infoHash: candidate.infoHash, magnet: `magnet:?xt=urn:btih:${candidate.infoHash}`, filename: file.name || candidate.filename,
      fileIdx: file.fileId, label: file.name || candidate.label, sizeBytes: file.size || candidate.sizeBytes,
      source: 'requested-library', cached: true };
    const id = `${scope}:${detail.imdbId}:${row.season ?? ''}:${row.episode ?? ''}:${candidate.infoHash}:${file.fileId}`;
    await db.collection('requested_sources').updateOne({ _id: id }, { $set: { credentialScope: scope, imdbId: detail.imdbId, mediaType: detail.mediaType,
      season: row.season ?? null, episode: row.episode ?? null, candidate: selected, verifiedAt: new Date(), requestId: row._id } }, { upsert: true });
  },
});
