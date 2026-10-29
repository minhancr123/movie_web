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
  return sources.filter(s => s.playable !== false && s.sourceToken
      && ![...failed].some(token => isSourceActiveToken(s.sourceToken, token)))
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

/** Robust matching for active candidate token across versioned index tags and raw hashes */
export function isSourceActiveToken(candidateToken?: string, currentToken?: string): boolean {
  if (!candidateToken || !currentToken) return false;
  const a = candidateToken.toLowerCase();
  const b = currentToken.toLowerCase();
  if (a === b) return true;
  if (a.startsWith('vimo|') && b.startsWith('vimo|')) {
    const idA = a.split('|')[2]?.split(':')[0];
    const idB = b.split('|')[2]?.split(':')[0];
    if (idA && idB && idA === idB) return true;
  }
  const hashA = a.split(':')[0];
  const hashB = b.split(':')[0];
  return hashA.length === 40 && hashA === hashB;
}
