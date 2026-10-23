export interface GroupableSource {
  sourceToken?: string;
  origin?: string | null;
  resolution?: number | string | null;
  playable?: boolean;
  /** A Vietnamese subtitle release matches this source's release name. */
  hasViSub?: boolean;
  viSubRelease?: string;
  /** Bucket assigned by the backend (services/playback/sourcePicker.js). */
  qualityGroup?: string | null;
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
  // Widescreen / Cinemascope cropped video heights:
  // 4K (2160p) cropped 2.40:1 is ~1600p
  // 1440p (2K) cropped 2.40:1 is ~1200p
  // 1080p (Full HD) cropped 2.40:1 is ~800p
  // 720p (HD) cropped 2.40:1 is ~534p
  if (height >= 1600) return '4k';
  if (height >= 1200) return '1440p';
  if (height >= 768) return '1080p';
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
  // Within a group, sources with a hash-grade Vietnamese subtitle come first:
  // a perfectly synced experience outranks a marginal quality difference.
  return GROUPS.map(([key, label]) => ({
    key,
    label,
    sources: [...buckets.get(key)!].sort(
      (a, b) => Number(b.hasViSub === true) - Number(a.hasViSub === true),
    ),
  })).filter(group => group.sources.length > 0);
}
