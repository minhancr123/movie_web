export type DeliveryState = 'verified' | 'likely' | 'remux' | 'unknown' | 'unavailable';
export type SourceFilter = 'all' | 'direct' | 'remux';
interface Source {
  sourceToken?: string; directPlay?: DeliveryState; origin?: string | null;
  playable?: boolean; cached?: boolean; resolution?: number | string | null;
  codec?: string | null; filename?: string | null;
}
/** Network errors can recover on the same URL; decoded-byte failures cannot. */
export const nativeMediaNeedsAnotherSource = (code?: number): boolean => code === 3 || code === 4;
export function sourceCodecFamily(source?: Source): string {
  const description = `${source?.codec || ''} ${source?.filename || ''}`;
  if (/\b(?:hevc|h\.?265|x265)\b/i.test(description)) return 'hevc';
  if (/\b(?:avc|h\.?264|x264)\b/i.test(description)) return 'avc';
  if (/\bav1\b/i.test(description)) return 'av1';
  return '';
}
export const deliveryState = (source: Source): DeliveryState => source.directPlay
  || (['vimo', 'yastream'].includes(source.origin || '') ? 'likely' : 'unknown');
export function filterPlaybackSources<T extends Source>(sources: T[], filter: SourceFilter): T[] {
  return sources.filter(s => filter === 'all' || (filter === 'direct'
    ? ['verified', 'likely'].includes(deliveryState(s)) : deliveryState(s) === 'remux'));
}
/** The menu is grouped for display. Recovery must choose by suitability instead. */
export function pickFallbackSource<T extends Source>(sources: T[], failed: Set<string>, height = 0, failedCodec = ''): T | undefined {
  // Recovery keeps the historical conservative torrent-wide failure veto;
  // it must not be used to identify/highlight the particular playing file.
  return sources.filter(s => s.playable !== false && s.sourceToken
      && ![...failed].some(token => isSourceActiveToken(s.sourceToken, token)
        || (/^[a-f0-9]{40}(?::|$)/i.test(token) && /^[a-f0-9]{40}(?::|$)/i.test(s.sourceToken || '')
          && token.slice(0,40).toLowerCase() === s.sourceToken!.slice(0,40).toLowerCase())))
    .map((source,index) => ({source,index}))
    .sort((a,b) => {
      const priority = (s: Source) => {
        const h=Number(s.resolution)||0;
        const differentCodec = failedCodec && sourceCodecFamily(s) && sourceCodecFamily(s) !== failedCodec;
        return Number(Boolean(s.cached))*100 + (height && h === height ? 50 : height && h > height ? -50 : 0)
          + (differentCodec ? 60 : 0)
          + ({verified:20,likely:10,remux:0,unknown:0,unavailable:-100}[deliveryState(s)]);
      };
      return priority(b.source)-priority(a.source) || a.index-b.index;
    })[0]?.source;
}

/** Audio indices identify tracks in one file, not a language across releases. */
export function audioIndexForSource(explicit: number | undefined, current: number | null,
  previousToken: string, nextToken: string): number | null {
  if (explicit !== undefined) return explicit;
  return nextToken && nextToken !== previousToken ? null : current;
}

/** File identity is narrower than a torrent hash: never merge pack indices,
 * provider types or episodes. Legacy numeric tags alias only that exact index.
 */
export function canonicalSourceToken(token?: string): string {
  if (!token) return '';
  const t = token.trim();
  const torrent = /^([a-f0-9]{40})(?::(?:(?:index:)?(\d+)|unknown:(.*)))?$/i.exec(t);
  if (!torrent) return t; // Provider identifiers can be case-sensitive.
  const hash = torrent[1].toLowerCase();
  if (torrent[2] !== undefined) return `${hash}:index:${torrent[2].replace(/^0+(?=\d)/, '')}`;
  return torrent[3] !== undefined ? `${hash}:unknown:${torrent[3].toLowerCase()}` : hash;
}
export function isSourceActiveToken(candidateToken?: string, currentToken?: string): boolean {
  return Boolean(candidateToken && currentToken && canonicalSourceToken(candidateToken) === canonicalSourceToken(currentToken));
}
/** Even duplicate rows/aliases must yield at most one highlighted object. */
export function findPlayingSource<T extends Source>(sources: T[], token?: string): T | undefined {
  return sources.find(s => s.playable !== false && isSourceActiveToken(s.sourceToken, token));
}
/** The resolve response identifies the bytes the player actually receives. */
export function resolvedPlayingToken(serverToken: unknown, requestedToken?: string): string {
  return typeof serverToken === 'string' && serverToken.trim() ? serverToken : requestedToken || '';
}

/** Use the same episode-specific pin as playback; storage can be unavailable. */
export function prewarmSourceToken(read: (key: string) => string | null, type: string, tmdbId: number,
  season?: number, episode?: number): string | undefined {
  if (type !== 'movie' && type !== 'tv') return undefined;
  if (type === 'tv' && (!Number.isInteger(season) || season! < 0 || !Number.isInteger(episode) || episode! < 1)) return undefined;
  const key = `playback:selectedSource:${type}:${tmdbId}:${type === 'tv' ? season : 'movie'}:${type === 'tv' ? episode : 'full'}`;
  try { const value = read(key); return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
  catch { return undefined; }
}
