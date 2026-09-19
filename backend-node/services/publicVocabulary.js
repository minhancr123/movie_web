/**
 * What a production client is allowed to be told about the stack.
 *
 * Responses carry free text written for operators — "Remux video copy, audio
 * eac3 -> AAC-LC", "Dùng lại phiên remux đang có", the release filename — and
 * all of it is one devtools tab away from any viewer. Scrubbing in the UI does
 * not help: the JSON is already there. So it happens here, where the text is
 * produced.
 *
 * Deny-list with wholesale replacement, deliberately, rather than swapping
 * words out. Patching leaves "Luồng xử lý video copy, audio eac3" — the same
 * description of the pipeline, slightly mangled — and every newly added term
 * leaks until someone writes a rule for it. Replacing the whole message fails
 * closed: an unknown message that trips a single term is simply not published.
 */

/**
 * Terms that identify the provider, the container, the codecs, the tools or
 * the acquisition method. Word-bounded so ordinary Vietnamese is untouched.
 */
const TECHNICAL_TERMS = [
  // Providers and services
  'torbox', 'debrid', 'stremio', 'addon', 'opensubtitles', 'subdl', 'yastream',
  'vimo', 'nhamsub',
  // Pipeline and tooling
  'remux', 'transcode', 'ffmpeg', 'ffprobe', 'nvenc', 'libx264', 'libx265',
  // Delivery formats
  'hls', 'm3u8', 'fmp4', 'mp4', 'mkv', 'webvtt', 'vtt',
  // Codecs
  'hevc', 'avc', 'x264', 'x265', 'h264', 'h265', 'aac', 'ac3', 'eac3', 'ddp',
  'opus', 'flac', 'dts',
  // Release vocabulary
  'webrip', 'webdl', 'bluray', 'bdrip', 'hdrip', 'remaster',
  // Acquisition
  'torrent', 'magnet', 'infohash', 'seed', 'peer', 'tracker',
];

// `H.264` and `WEB-DL` carry punctuation, so the boundary has to allow it.
const TERM_PATTERN = new RegExp(
  `(^|[^\p{L}\p{N}])(${TECHNICAL_TERMS.join('|')}|h\.?26[45]|web[-.]?dl|web[-.]?rip|ddp\d|aac-lc)([^\p{L}\p{N}]|$)`,
  'iu',
);

/** Whether a string names anything we would rather not publish. */
export const hasTechnicalTerm = (text) => {
  const s = String(text ?? '');
  return s ? TERM_PATTERN.test(s) : false;
};

/**
 * The version of `text` a client may see.
 *
 * Outside production nothing is touched: this text is what makes a fault
 * diagnosable, and hiding it from the operator costs more than it protects.
 */
export const publicText = (text, fallback, isProduction = process.env.NODE_ENV === 'production') => {
  const s = String(text ?? '').trim();
  if (!s) return fallback;
  if (!isProduction) return s;
  return hasTechnicalTerm(s) ? fallback : s;
};

/**
 * The release filename is the single clearest giveaway — codec, source, group,
 * often the tracker — so production sends none at all rather than a trimmed one.
 */
export const publicFileName = (name, isProduction = process.env.NODE_ENV === 'production') => {
  const s = String(name ?? '').trim();
  if (!s) return '';
  return isProduction ? '' : s;
};
