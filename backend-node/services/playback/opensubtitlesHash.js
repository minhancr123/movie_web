/**
 * OpenSubtitles file hash.
 *
 * Why this exists: Stremio subtitle addons looked up by IMDb id alone return
 * subtitles for the *title*, timed to whichever release the uploader had. When
 * the debrid file is a different release the timing is off, which is why sync
 * used to be a coin flip. Passing videoHash + videoSize lets an OpenSubtitles
 * backed addon return the subtitle matched to this exact file.
 *
 * Algorithm (as specified by OpenSubtitles):
 *   hash = filesize
 *        + sum of the first  64 KiB read as little-endian uint64
 *        + sum of the last   64 KiB read as little-endian uint64
 *   truncated to 64 bits, printed as 16 lowercase hex digits.
 *
 * Only 128 KiB is read, via two HTTP range requests — the file is never
 * downloaded.
 */

const CHUNK_SIZE = 65536;
const MASK_64 = (1n << 64n) - 1n;
const REQUEST_TIMEOUT_MS = 15000;

/** Sum a 64 KiB buffer as little-endian uint64 words. */
const sumChunk = (buffer) => {
  let total = 0n;
  const words = Math.floor(buffer.length / 8);
  for (let i = 0; i < words; i += 1) {
    total = (total + buffer.readBigUInt64LE(i * 8)) & MASK_64;
  }
  return total;
};

const fetchRange = async (url, start, end) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { range: `bytes=${start}-${end}` },
      signal: controller.signal,
    });
    // 206 means the server honoured the range. A 200 would hand back the whole
    // file, which is exactly what this must never do.
    if (response.status !== 206) {
      throw new Error(`server không hỗ trợ range request (HTTP ${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
};

/**
 * @returns {Promise<{ videoHash: string, videoSize: number } | null>}
 *   null when the size is too small or the source refuses range requests;
 *   callers fall back to an IMDb-only lookup.
 */
export const computeOpenSubtitlesHash = async (url, size) => {
  const fileSize = Number(size);
  if (!Number.isFinite(fileSize) || fileSize < CHUNK_SIZE * 2) return null;

  const [head, tail] = await Promise.all([
    fetchRange(url, 0, CHUNK_SIZE - 1),
    fetchRange(url, fileSize - CHUNK_SIZE, fileSize - 1),
  ]);

  if (head.length < CHUNK_SIZE || tail.length < CHUNK_SIZE) {
    throw new Error('range request trả về thiếu dữ liệu');
  }

  const hash = (BigInt(fileSize) + sumChunk(head) + sumChunk(tail)) & MASK_64;
  return {
    videoHash: hash.toString(16).padStart(16, '0'),
    videoSize: fileSize,
  };
};

export default { computeOpenSubtitlesHash };
