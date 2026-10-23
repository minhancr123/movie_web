/**
 * TorBox Streaming API adapter — EXPERIMENTAL.
 *
 * This adapter wraps the TorBox Streaming endpoints (/stream/createstream,
 * /stream/getstreamdata) so they can be tested independently of the existing
 * requestdl-based adapter in torbox.js.
 *
 * WARNING: The OpenAPI spec does not fully describe the response schema or
 * the terms of use for third-party streaming. This adapter is for TESTING
 * ONLY and must not replace requestdl in production until verified.
 *
 * See: https://api.torbox.app (OpenAPI spec, checked 2026-10-23)
 */

import { cacheClient } from '../../config/redis.js';

const BASE_URL = (process.env.TORBOX_BASE_URL || 'https://api.torbox.app/v1/api').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 15000;

export const PROVIDER = 'torbox-stream';

const scrub = (text, key) => {
  let output = String(text ?? '');
  if (key) output = output.split(key).join('<redacted>');
  return output.replace(/(token|api_key|apikey)=[^&\s"']+/gi, '$1=<redacted>');
};

export class DebridError extends Error {
  constructor(message, { status = 502, code = 'debrid_error' } = {}) {
    super(message);
    this.name = 'DebridError';
    this.status = status;
    this.code = code;
  }
}

const request = async (path, key, { method = 'GET', params = {}, timeoutMs = REQUEST_TIMEOUT_MS } = {}) => {
  if (!key) throw new DebridError('Thiếu TorBox API key', { status: 401, code: 'no_token' });

  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([name, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(name, String(value));
    }
  });

  const budget = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? Number(timeoutMs)
    : REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budget);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json',
      },
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload = null;
    try { payload = JSON.parse(raw); } catch { /* upstream returned HTML */ }

    if (response.status === 401 || response.status === 403) {
      throw new DebridError('TorBox từ chối API key này', { status: 401, code: 'invalid_token' });
    }
    if (response.status === 429) {
      throw new DebridError('TorBox đang giới hạn tần suất', { status: 429, code: 'rate_limited' });
    }
    if (!response.ok) {
      throw new DebridError(`TorBox ${path} trả về ${response.status}: ${scrub(raw.slice(0, 200), key)}`);
    }
    if (payload && payload.success === false) {
      throw new DebridError(`TorBox ${path} thất bại: ${scrub(payload.detail || payload.error || 'không rõ', key)}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof DebridError) throw error;
    if (error.name === 'AbortError') {
      throw new DebridError(`TorBox ${path} quá ${budget / 1000}s không phản hồi`, { status: 504, code: 'timeout' });
    }
    throw new DebridError(`Không gọi được TorBox ${path}: ${scrub(error.message, key)}`);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Create a stream from a file in the user's TorBox account.
 *
 * @param {string} key - TorBox API key
 * @param {object} opts
 * @param {string} opts.id - TorBox item id
 * @param {string} opts.fileId - File id within the item
 * @param {string} opts.type - 'torrent' | 'usenet' | 'webdl'
 * @param {number} [opts.chosenAudioIndex] - Audio track index
 * @param {number} [opts.chosenSubtitleIndex] - Subtitle track index
 * @param {number} [opts.chosenResolutionIndex] - Resolution index
 * @param {boolean} [opts.scrobblingEnabled] - Enable scrobbling
 * @returns {Promise<object>} Stream creation response (token, presigned_token, etc.)
 */
export const createStream = async (key, opts = {}) => {
  const {
    id,
    fileId,
    type = 'torrent',
    chosenAudioIndex,
    chosenSubtitleIndex,
    chosenResolutionIndex,
    scrobblingEnabled = false,
  } = opts;

  if (!id) throw new DebridError('Thiếu id của item TorBox', { status: 400, code: 'bad_request' });

  const params = { id, file_id: fileId, type };
  if (chosenAudioIndex !== undefined) params.chosen_audio_index = chosenAudioIndex;
  if (chosenSubtitleIndex !== undefined) params.chosen_subtitle_index = chosenSubtitleIndex;
  if (chosenResolutionIndex !== undefined) params.chosen_resolution_index = chosenResolutionIndex;
  if (scrobblingEnabled) params.scrobbling_enabled = 'true';

  const payload = await request('/stream/createstream', key, { params });

  // Cache the stream token briefly (short-lived upstream)
  const token = payload?.data?.token;
  const presignedToken = payload?.data?.presigned_token;
  if (token) {
    await cacheClient.set(`torbox:stream:${token}`, JSON.stringify(payload.data), 'EX', 300).catch(() => {});
  }

  return payload?.data || payload;
};

/**
 * Get stream data using a token and presigned_token.
 *
 * @param {string} key - TorBox API key
 * @param {object} opts
 * @param {string} opts.token - Stream token from createStream
 * @param {string} opts.presignedToken - Presigned token from createStream
 * @returns {Promise<object>} Stream data (URL, manifest, etc.)
 */
export const getStreamData = async (key, opts = {}) => {
  const { token, presignedToken } = opts;
  if (!token) throw new DebridError('Thiếu stream token', { status: 400, code: 'bad_request' });

  // Check cache first
  const cached = await cacheClient.get(`torbox:stream:${token}`).catch(() => null);
  if (cached) {
    try { return JSON.parse(cached); } catch { /* fall through */ }
  }

  const params = { token };
  if (presignedToken) params.presigned_token = presignedToken;

  const payload = await request('/stream/getstreamdata', key, { params });
  return payload?.data || payload;
};

/**
 * Test whether a stream can be used for direct playback.
 * Returns metadata about the stream format, supported codecs, etc.
 *
 * @param {string} key - TorBox API key
 * @param {object} opts - Same as createStream opts
 * @returns {Promise<{usable: boolean, format: string, url: string|null, metadata: object}>}
 */
export const probeStream = async (key, opts = {}) => {
  try {
    const streamData = await createStream(key, opts);
    const token = streamData?.token;
    const presignedToken = streamData?.presigned_token;

    if (!token) {
      return { usable: false, format: 'unknown', url: null, metadata: streamData, error: 'No token returned' };
    }

    const data = await getStreamData(key, { token, presignedToken });

    // Determine if the response contains a playable URL or manifest
    const url = data?.url || data?.stream_url || data?.manifest_url || null;
    const format = data?.format || data?.type || (url ? (url.includes('.m3u8') ? 'hls' : 'direct') : 'unknown');

    return {
      usable: Boolean(url),
      format,
      url,
      metadata: data,
      token,
      presignedToken,
    };
  } catch (error) {
    return {
      usable: false,
      format: 'unknown',
      url: null,
      metadata: {},
      error: error.message,
    };
  }
};

export default {
  PROVIDER,
  createStream,
  getStreamData,
  probeStream,
};
