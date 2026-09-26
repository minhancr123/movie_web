import { hasKnownHeight, isPreferredAutoSource } from './sourceRanker.js';

/**
 * Picker buckets, in the order they are shown. The backend tags every source
 * with one of these (`qualityGroup`) so the client never has to re-derive the
 * bands — see frontend/src/lib/source-groups.ts.
 */
const GROUP_ORDER = ['vietsub', '1080p', '720p', '1440p', '4k', 'other'];

/**
 * Which bucket a release belongs in, by parsed height.
 *
 * Monotone bands, so a height that is not one of the standard rungs still lands
 * somewhere sensible: 1440p is a mainstream release and belongs with the other
 * named qualities, not in "other" next to releases that state no height at all.
 */
const sourceGroup = (source) => {
  if (['yastream', 'vimo'].includes(source.origin)
    || /^(yastream:|vimo\|)/.test(source.sourceToken || '')) return 'vietsub';
  const height = Number(source.resolution);
  if (!Number.isFinite(height) || height <= 0) return 'other';
  if (height >= 2160) return '4k';
  if (height >= 1440) return '1440p';
  if (height >= 1080) return '1080p';
  return '720p';
};

/** Bound the picker without letting one quality crowd out every alternative.
 * Input is already ranked; round-robin preserves that order within each group.
 * Auto selection uses rankCandidates, not this presentation-only selection.
 */
export const selectDiverseSources = (sources, limit = 15) => {
  const budget = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 15;
  const groups = new Map(GROUP_ORDER.map(key => [key, []]));
  const seen = new Set();
  for (const source of sources || []) {
    if (!source || source.playable === false) continue;
    const token = source.sourceToken || source.infoHash;
    if (token && seen.has(token)) continue;
    if (token) seen.add(token);
    const qualityGroup = sourceGroup(source);
    groups.get(qualityGroup).push({ ...source, qualityGroup });
  }
  const selected = [];
  for (let round = 0; selected.length < budget; round += 1) {
    let added = false;
    for (const key of GROUP_ORDER) {
      const source = groups.get(key)[round];
      if (source && selected.length < budget) {
        selected.push(source);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
};

/** The reuse shortcut must not bypass a ready preferred Auto source.
 * If preferred files still need downloading, allow a ready session fallback.
 *
 * A release whose label states no height stays in the scan even when a
 * preferred one exists: "unknown" is not "too tall", and dropping it here
 * silently turns a 2-second reuse into a full TorBox prepare — the exact stall
 * this shortcut exists to avoid.
 */
export const selectReuseCandidates = (attempts, preferredMaxHeight = 0, manual = false) => {
  const cap = Number(preferredMaxHeight) || 0;
  if (manual || cap <= 0 || !attempts.some((s) => s.cached && isPreferredAutoSource(s, cap))) {
    return attempts;
  }
  return attempts.filter((s) => isPreferredAutoSource(s, cap) || !hasKnownHeight(s));
};
