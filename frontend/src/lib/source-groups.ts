interface GroupableSource {
  sourceToken?: string;
  origin?: string | null;
  resolution?: number | string | null;
  playable?: boolean;
  /** Bucket assigned by the backend (services/playback/sourcePicker.js). */
  qualityGroup?: string;
}

const GROUPS = [
  ['vietsub', 'Vietsub / Direct'],
  ['1080p', '1080p — Full HD'],
  ['720p', '720p trở xuống — Tiết kiệm dữ liệu'],
  ['1440p', '1440p — QHD'],
  ['4k', '4K — Chất lượng cao'],
  ['other', 'Chất lượng khác'],
] as const;

type GroupKey = (typeof GROUPS)[number][0];

const GROUP_KEYS = new Set<string>(GROUPS.map(([key]) => key));

/**
 * Height band, mirroring the backend's `sourceGroup` so both agree.
 * 1440p is a named quality here, not "other"; a release that states no height
 * is the only thing that belongs in "other".
 */
function deriveGroup(source: GroupableSource): GroupKey {
  if (source.origin === 'yastream' || source.origin === 'vimo'
    || /^(yastream:|vimo\|)/.test(source.sourceToken || '')) return 'vietsub';
  const height = Number(source.resolution);
  if (!Number.isFinite(height) || height <= 0) return 'other';
  if (height >= 2160) return '4k';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  return '720p';
}

/**
 * Trusts the backend's bucket when it sent one, and derives it only for the
 * direct-provider response (which has no `qualityGroup`). Two copies of the
 * same bands is how 1440p ended up filed under "other" while the server said
 * otherwise.
 */
export function groupPlaybackSources<T extends GroupableSource>(sources: T[]) {
  const buckets = new Map<string, T[]>(GROUPS.map(([key]) => [key, []]));
  for (const source of sources) {
    if (source.playable === false) continue;
    const key = source.qualityGroup && GROUP_KEYS.has(source.qualityGroup)
      ? (source.qualityGroup as GroupKey)
      : deriveGroup(source);
    buckets.get(key)!.push(source);
  }
  return GROUPS.map(([key, label]) => ({ key, label, sources: buckets.get(key)! }))
    .filter(group => group.sources.length > 0);
}
