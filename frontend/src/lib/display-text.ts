import { decode } from 'html-entities';

/** Plain text only: legacy encoded markup must never become rendered HTML. */
export const commentText = (value: unknown): string => {
  let text = typeof value === 'string' ? value : '';
  for (let i = 0; i < 3; i++) {
    const next = decode(text, { level: 'html5' });
    if (next === text) break;
    text = next;
  }
  return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|blockquote)\s*>/gi, '\n')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
};
export const formatRuntimeMinutes = (value: number | null | undefined): string => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'Đang cập nhật';
  const minutes = Math.round(value), hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours} giờ${rest ? ` ${rest} phút` : ''}` : `${minutes} phút`;
};
