const SUB_ERROR_MARKERS = [
  'limit has been reached', 'download limit', 'daily limit', 'quota exceeded',
  'too many requests', 'api key', 'not available', 'no subtitles found',
  'lỗi cấu hình', 'chưa nhập api key', 'không tìm thấy phụ đề',
];
export const isErrorSubtitleText = (text) => {
  const head = String(text || '').slice(0, 4096).toLowerCase();
  return SUB_ERROR_MARKERS.some((marker) => head.includes(marker));
};
