import type { SubCue } from './subtitles';

export const SUBTITLE_SYNC_STORAGE = 'cine_sub_sync_v2';
export const clampSubtitleDelay = (value: number) => Number.isFinite(value)
  ? Math.round(Math.max(-300, Math.min(300, value)) * 10) / 10 : 0;

/** No expiring URLs/session IDs: seek rebuilds keep calibration; other cuts do not. */
export function subtitleSyncKey(context: { type: string; tmdbId: number; season?: number | null; episode?: number | null; sourceToken?: string } | null | undefined,
  trackId: string, cues: SubCue[]): string | null {
  if (!context?.sourceToken || !trackId || trackId === 'off' || !cues.length) return null;
  // Fingerprint all cues, including text, so replacement uploads cannot reuse an old correction.
  let hash = 2166136261;
  for (const cue of cues) for (const ch of `${cue.start}|${cue.end}|${cue.text}\n`) {
    hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
  }
  return JSON.stringify([context.type, context.tmdbId, context.season ?? null,
    context.episode ?? null, context.sourceToken, trackId, cues.length, hash]);
}
export function readSubtitleDelay(raw: string | null, key: string | null): number {
  if (!key) return 0;
  try { const map = JSON.parse(raw || '{}'); return clampSubtitleDelay(map?.[key]); } catch { return 0; }
}
export function writeSubtitleDelay(raw: string | null, key: string, value: number): string {
  let map: Record<string, number> = {};
  try {
    const parsed = JSON.parse(raw || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      map = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'number' && Number.isFinite(v))) as Record<string, number>;
    }
  } catch { /* Replace malformed preferences. */ }
  delete map[key];
  map[key] = clampSubtitleDelay(value);
  return JSON.stringify(Object.fromEntries(Object.entries(map).slice(-200)));
}
/** Positive lookup offset shows cues earlier. Anchor uses the unadjusted source clock. */
export function subtitleAnchorDelay(cueStart: number, sourceClock: number): number | null {
  if (![cueStart, sourceClock].every(Number.isFinite) || cueStart < 0 || sourceClock < 0 || Math.abs(cueStart - sourceClock) > 300) return null;
  return clampSubtitleDelay(cueStart - sourceClock);
}
