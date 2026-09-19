/**
 * Pure Vimo title matching (no network, no cache imports — unit-testable).
 *
 * Vimo catalog names are bilingual Vietnamese ("Kẻ Đánh Cắp Giấc Mơ -
 * Inception"), so matching must be diacritics-insensitive, and the year
 * gate must reject same-title remakes before any string similarity.
 */

/**
 * Lowercase, strip Vietnamese diacritics (d/đ included), drop punctuation:
 * "Búp bê - The Doll" and "bup-be-the-doll" must compare equal.
 */
export const normalizeTitle = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const titleTokens = (value) => new Set(normalizeTitle(value).split(' ').filter(Boolean));

/**
 * 0..1 similarity of a catalog entry against our known titles.
 * Year must match within tolerance or the entry is out, no matter how
 * similar the name (remakes/reboots share titles across decades).
 */
export const scoreMeta = (meta, { titles = [], year = null }) => {
  const wanted = titles.map(titleTokens).filter((tokens) => tokens.size > 0);
  if (wanted.length === 0) return 0;
  const metaText = `${meta?.name || ''} ${meta?.id || ''}`;
  const metaTokens = titleTokens(metaText);
  if (metaTokens.size === 0) return 0;

  if (Number.isInteger(year) && Number.isInteger(meta?.year)) {
    if (Number(meta.year) !== year) return 0;
  }

  let best = 0;
  for (const query of wanted) {
    let hit = 0;
    for (const token of query) if (metaTokens.has(token)) hit += 1;
    // Favour entries that contain the whole query, not just one word.
    const coverage = hit / query.size;
    const precision = hit / Math.max(metaTokens.size, query.size);
    best = Math.max(best, coverage * 0.7 + precision * 0.3);
  }
  
  return best >= MIN_MATCH_SCORE ? best : 0;
};

export const MIN_MATCH_SCORE = 0.45;

/** "Full • 1080p" / "Tập 02 • 1080p" -> { resolution, label }. */
export const parseVimoQuality = (title) => {
  const text = String(title || '');
  const res = /(\d{3,4})\s*p/i.exec(text);
  return {
    resolution: res ? Number(res[1]) : null,
    label: text.split('\n').map((line) => line.trim()).filter(Boolean).join(' • '),
  };
};

export default { normalizeTitle, scoreMeta, parseVimoQuality, MIN_MATCH_SCORE };
