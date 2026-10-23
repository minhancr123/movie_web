export type DeliveryState = 'verified' | 'likely' | 'remux' | 'unknown' | 'unavailable';
export type SourceFilter = 'all' | 'direct' | 'remux';
interface Source {
  sourceToken?: string; directPlay?: DeliveryState; origin?: string | null;
  playable?: boolean; cached?: boolean; resolution?: number | string | null;
}
export const deliveryState = (source: Source): DeliveryState => source.directPlay
  || (['vimo', 'yastream'].includes(source.origin || '') ? 'likely' : 'unknown');
export function filterPlaybackSources<T extends Source>(sources: T[], filter: SourceFilter): T[] {
  return sources.filter(s => filter === 'all' || (filter === 'direct'
    ? ['verified', 'likely'].includes(deliveryState(s)) : deliveryState(s) === 'remux'));
}
/** The menu is grouped for display. Recovery must choose by suitability instead. */
export function pickFallbackSource<T extends Source>(sources: T[], failed: Set<string>, height = 0): T | undefined {
  return sources.filter(s => s.playable !== false && s.sourceToken && !failed.has(s.sourceToken))
    .map((source,index) => ({source,index}))
    .sort((a,b) => {
      const priority = (s: Source) => {
        const h=Number(s.resolution)||0;
        return Number(Boolean(s.cached))*100 + (height && h === height ? 50 : height && h > height ? -50 : 0)
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
