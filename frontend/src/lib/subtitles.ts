/** Minimal WebVTT client: fetch + parse + active-cue lookup. */

export interface SubCue {
  start: number;
  end: number;
  text: string;
}

export interface SubTrack {
  id: string;
  language: string;
  label: string;
  url: string;
  /** False while the background extraction job is still running. */
  ready?: boolean;
  /**
   * Where the track came from. 'embedded' tracks are extracted from the
   * playing file itself, so their timing is exact; anything else is an
   * online sidecar timed for some (possibly different) release.
   */
  source?: string;
}

/**
 * True for tracks extracted from the playing file: either an explicit
 * embedded source, or the backend's `<infohash>:<index>` id shape (the
 * session-less extraction path mints those without a source field).
 * Only these have timing guaranteed to match the picture.
 */
export const isEmbeddedTrack = (t: { source?: string; id: string }): boolean =>
  t.source === 'embedded' || /^[0-9a-f]{40}:\d+$/i.test(t.id);

/** Coarse timing-base grouping for bilingual pairing. */
export const trackSource = (t: { source?: string; id: string }): string =>
  t.source || (isEmbeddedTrack(t) ? 'embedded' : 'online');

export const isViTrack = (t: { language: string }): boolean =>
  t.language.toLowerCase().startsWith('vi');

export const isEnTrack = (t: { language: string }): boolean =>
  t.language.toLowerCase().startsWith('en');

export const isReadyTrack = (t: { ready?: boolean; url: string }): boolean =>
  t.ready !== false && !!t.url;

const TS = '(\\d{2,}):(\\d{2}):(\\d{2})[.,](\\d{3})';
const TS_SHORT = '(\\d{2}):(\\d{2})[.,](\\d{3})';

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

function parseTimestamp(value: string): number | null {
  let match = new RegExp(`^${TS}$`).exec(value.trim());
  if (match) return toSeconds(match[1], match[2], match[3], match[4]);
  match = new RegExp(`^${TS_SHORT}$`).exec(value.trim());
  if (match) return toSeconds('0', match[1], match[2], match[3]);
  return null;
}

/** Strip cue tags, ASS overrides and positioning noise, keep readable lines. */
function cleanText(raw: string): string {
  return raw
    .replace(/\{[^}]*\}/g, '')
    .replace(/<[^>]*>/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function parseVtt(text: string): SubCue[] {
  const cues: SubCue[] = [];
  const normalized = text.replace(/\r\n?/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    if (/^WEBVTT/i.test(lines[0])) {
      lines.shift();
      if (lines.length === 0) continue;
    }
    const arrowIdx = lines.findIndex((l) => l.includes('-->'));
    if (arrowIdx < 0) continue;
    const [startRaw, endRaw] = lines[arrowIdx].split('-->').map((s) => s.trim());
    const start = parseTimestamp(startRaw.split(' ')[0]);
    const end = parseTimestamp(endRaw.split(' ')[0]);
    if (start === null || end === null || end <= start) continue;
    const body = cleanText(lines.slice(arrowIdx + 1).join('\n'));
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export async function fetchCues(url: string): Promise<SubCue[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Tải phụ đề thất bại (${res.status})`);
  return parseVtt(await res.text());
}

/** All cues active at `time` (usually 0-1; overlapping bilingual lines join). */
export function activeCues(cues: SubCue[], time: number): SubCue[] {
  return cues.filter((c) => time >= c.start && time <= c.end);
}

