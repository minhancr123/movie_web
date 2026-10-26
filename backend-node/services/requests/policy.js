const fold = text => String(text || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g,'d').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const findRequestMatch = (title, items = []) => {
  const clean = fold(title), year = /\b(19\d{2}|20\d{2})\b/.exec(clean)?.[1];
  const name = clean.replace(/\b(19\d{2}|20\d{2})\b/g,'').trim();
  const exact = items.filter(x => ['movie','tv'].includes(x.mediaType) && (!year || String(x.year) === year)
    && [x.title,x.originalTitle,x.englishTitle].some(t => fold(t) === name));
  return exact.length === 1 ? exact[0] : null;
};
export const readyProbe = (probe, expectedMinutes) => {
  const streams = probe?.streams || [], duration = Number(probe?.format?.duration);
  return streams.some(s => s.codec_type === 'video' && ['h264','hevc','av1','vp9'].includes(s.codec_name))
    && streams.some(s => s.codec_type === 'audio') && duration > 60
    && (!(expectedMinutes > 0) || Math.abs(duration - expectedMinutes * 60) <= Math.max(180, expectedMinutes * 60 * 0.12));
};
export const retryAt = (state, now = Date.now()) => new Date(now + ({ downloading: 30000, waiting_slot: 60000,
  verifying: 60000, waiting_provider: 5*60000, waiting_source: 6*3600000, needs_match: 24*3600000 }[state] || 5*60000));
export const initialAutomation = () => ({ enabled: true, state: 'queued', progress: 0, priority: 1, nextAttemptAt: new Date(), attempts: 0 });
