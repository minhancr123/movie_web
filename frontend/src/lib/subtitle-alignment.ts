import type { SubCue, SubTrack } from './subtitles';

export type SubtitleAlignment = {
  offset: number; anchorT: number; matchRate: number; samples: number;
  spread: number; confident: boolean;
};
export type SubtitleTimeMapping = { offset: number; anchorT: number; slope: number };
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Positive offset means the target cue timestamp is later than source time. */
export const alignedSubtitleTime = (sourceTime: number, mapping: SubtitleTimeMapping | null) =>
  sourceTime + (mapping ? mapping.offset + mapping.slope * (sourceTime - mapping.anchorT) : 0);

/** Compare only shared, actually covered intervals. Cue density is not proof of a cut. */
export function measureSubtitleAlignment(target: SubCue[], reference: SubCue[],
  track: Pick<SubTrack, 'coverageRanges' | 'windowStart' | 'windowSeconds'>): SubtitleAlignment | null {
  if (!target.length || !reference.length) return null;
  const maxOffset = 10;
  const ranges = track.coverageRanges?.length ? track.coverageRanges
    : typeof track.windowStart === 'number' && typeof track.windowSeconds === 'number'
      ? [[track.windowStart, track.windowStart + track.windowSeconds]]
      : [[Math.min(...reference.map(c => c.start)), Math.max(...reference.map(c => c.end))]];
  const covered = (time: number) => ranges.some(([a, b]) => time >= a && time < b);
  const refs = reference.filter(c => covered(c.start)).sort((a, b) => a.start - b.start);
  const targets = target.filter(c => covered(c.start)).sort((a, b) => a.start - b.start);
  if (targets.length < 3 || refs.length < 3) return null;

  // Vote for a constant offset, rather than pairing every line to an arbitrary
  // nearby line. Repeated dialogue grids can have multiple equally good fits;
  // those are reported as ambiguous and never corrected automatically.
  const votes = new Map<number, number[]>();
  let left = 0;
  for (const cue of targets) {
    while (left < refs.length && refs[left].start < cue.start - maxOffset) left++;
    for (let i = left; i < refs.length && refs[i].start <= cue.start + maxOffset; i++) {
      const delta = cue.start - refs[i].start;
      const bin = Math.round(delta * 10);
      const bucket = votes.get(bin) || [];
      bucket.push(delta); votes.set(bin, bucket);
    }
  }
  const candidates = [...votes.values()].sort((a, b) => b.length - a.length)
    .slice(0, 16).map(bucket => median(bucket));
  if (!candidates.length) return null;
  const scored = candidates.map(offset => {
    const comparisons: { target: number; reference: number; residual: number }[] = [];
    for (let ti = 0; ti < targets.length; ti++) {
      const expected = targets[ti].start - offset;
      if (!covered(expected)) continue;
      let lo = 0, hi = refs.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (refs[mid].start < expected) lo = mid + 1; else hi = mid; }
      for (const ri of [lo - 1, lo]) {
        if (ri < 0 || ri >= refs.length) continue;
        const residual = Math.abs(targets[ti].start - refs[ri].start - offset);
        if (residual <= 0.35) comparisons.push({ target: ti, reference: ri, residual });
      }
    }
    const usedTarget = new Set<number>(), usedReference = new Set<number>();
    const pairs = comparisons.sort((a, b) => a.residual - b.residual).filter(pair => {
      if (usedTarget.has(pair.target) || usedReference.has(pair.reference)) return false;
      usedTarget.add(pair.target); usedReference.add(pair.reference); return true;
    });
    const deltas = pairs.map(p => targets[p.target].start - refs[p.reference].start);
    const fitted = deltas.length ? median(deltas) : offset;
    return { offset: fitted, anchorT: pairs.length ? median(pairs.map(p => refs[p.reference].start)) : 0,
      samples: pairs.length, matchRate: pairs.length / targets.length,
      spread: deltas.length ? median(deltas.map(d => Math.abs(d - fitted))) : Infinity };
  }).sort((a, b) => b.samples - a.samples || a.spread - b.spread);
  const best = scored[0];
  const ambiguous = scored.some(s => Math.abs(s.offset - best.offset) >= 1
    && s.matchRate >= best.matchRate - 0.08);
  return { ...best, confident: !ambiguous && best.samples >= 8 && best.matchRate >= 0.7 && best.spread <= 0.25 };
}

/** Offsets and slopes use SOURCE time as their anchor, for either target track. */
export function subtitleMappingFromMeasurements(previous: SubtitleAlignment | null,
  current: SubtitleAlignment): SubtitleTimeMapping | null {
  if (!current.confident) return null;
  let slope = 0;
  if (previous?.confident && Math.abs(current.anchorT - previous.anchorT) >= 90) {
    const measured = (current.offset - previous.offset) / (current.anchorT - previous.anchorT);
    if (Math.abs(measured) >= 0.002 && Math.abs(measured) <= 0.06) slope = measured;
  }
  return { offset: current.offset, anchorT: current.anchorT, slope };
}
