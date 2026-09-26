/**
 * TorBox debrid adapter.
 *
 * Every method takes the caller's own decrypted API key: there is no shared
 * service account, so one user's quota or ban never touches another's.
 *
 * Two rules hold throughout this file:
 *   - the API key never reaches a log line, an error message, or a queue payload;
 *   - a resolved download URL is treated as a credential too — it grants the
 *     bytes to whoever holds it, so it is returned to the caller and never logged.
 */

import { cacheClient } from '../../config/redis.js';

const BASE_URL = (process.env.TORBOX_BASE_URL || 'https://api.torbox.app/v1/api').replace(/\/+$/, '');
const REQUEST_TIMEOUT_MS = 15000;

/** A resolved link is short-lived upstream; expire ours earlier to stay valid. */
const LINK_TTL_SECONDS = 900;
const CACHED_CHECK_TTL_SECONDS = 300;

export const PROVIDER = 'torbox';

/** Strip anything key-shaped before text goes anywhere observable. */
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

/**
 * Did TorBox fail to ANSWER, rather than answer "no"?
 *
 * The distinction decides what playback does next. A timeout or a rate limit is
 * the provider being briefly unreachable: the release is untouched, so the
 * honest move is to read the account again (cheaply) and, failing that, tell
 * the client to come back — not to write the candidate off and ship the viewer
 * to a different source. `not_found`/`bad_request` are real verdicts and must
 * keep failing fast.
 */
export const isTransientDebridError = (error) =>
  error instanceof DebridError &&
  (error.code === 'timeout' ||
    error.code === 'rate_limited' ||
    error.status === 502 ||
    error.status === 503 ||
    error.status === 504);

const request = async (path, key, { method = 'GET', params = {}, body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) => {
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
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const raw = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch {
      /* upstream returned an HTML error page */
    }

    if (response.status === 401 || response.status === 403) {
      throw new DebridError('TorBox từ chối API key này', { status: 401, code: 'invalid_token' });
    }
    if (response.status === 429) {
      throw new DebridError('TorBox đang giới hạn tần suất, thử lại sau', {
        status: 429,
        code: 'rate_limited',
      });
    }
    if (!response.ok) {
      // scrub(): the key can appear in an echoed query string.
      throw new DebridError(`TorBox ${path} trả về ${response.status}: ${scrub(raw.slice(0, 200), key)}`);
    }
    if (payload && payload.success === false) {
      throw new DebridError(`TorBox ${path} thất bại: ${scrub(payload.detail || payload.error || 'không rõ', key)}`);
    }

    return payload;
  } catch (error) {
    if (error instanceof DebridError) throw error;
    if (error.name === 'AbortError') {
      throw new DebridError(`TorBox ${path} quá ${budget / 1000}s không phản hồi`, {
        status: 504,
        code: 'timeout',
      });
    }
    throw new DebridError(`Không gọi được TorBox ${path}: ${scrub(error.message, key)}`);
  } finally {
    clearTimeout(timer);
  }
};

/* ------------------------------------------------------------- account check */

/**
 * Validate a key at connect time and return a display-safe profile.
 * Called before anything is persisted, so a typo fails fast.
 */
export const verifyKey = async (key) => {
  const payload = await request('/user/me', key, { params: { settings: 'false' } });
  const user = payload?.data;
  if (!user) throw new DebridError('TorBox không trả về thông tin tài khoản', { status: 401, code: 'invalid_token' });

  return {
    providerUserId: String(user.id ?? ''),
    email: user.email || '',
    plan: String(user.plan ?? ''),
    isSubscribed: Boolean(user.plan) && String(user.plan) !== '0',
    expiresAt: user.premium_expires_at || null,
  };
};

/* ------------------------------------------------------------ cached lookups */

/**
 * Ask which infohashes TorBox already holds. Cached instantly => no download
 * wait, which is the difference between 2s and 20 minutes to first frame.
 *
 * Cache key is hashed per key-holder so one user's answer is never served to
 * another (entitlements differ per account).
 */
export const checkCached = async (key, infoHashes) => {
  const hashes = [...new Set((infoHashes || []).map((h) => String(h).toLowerCase()).filter(Boolean))];
  if (!hashes.length) return {};

  const result = {};
  const misses = [];

  for (const hash of hashes) {
    const hit = await cacheClient.get(`torbox:cached:${hash}`).catch(() => null);
    if (hit === null) misses.push(hash);
    else result[hash] = hit === '1';
  }

  if (!misses.length) return result;

  // TorBox caps the query string, so ask in batches.
  const BATCH = 40;
  for (let i = 0; i < misses.length; i += BATCH) {
    const batch = misses.slice(i, i + BATCH);
    let payload;
    try {
      payload = await request('/torrents/checkcached', key, {
        params: { hash: batch.join(','), format: 'object', list_files: 'false' },
      });
    } catch (error) {
      // A cache probe failing must not kill playback: treat as "not cached".
      if (error.code === 'invalid_token') throw error;
      batch.forEach((hash) => {
        result[hash] = false;
      });
      continue;
    }

    const data = payload?.data || {};
    for (const hash of batch) {
      const isCached = Boolean(data[hash]);
      result[hash] = isCached;
      await cacheClient
        .set(`torbox:cached:${hash}`, isCached ? '1' : '0', 'EX', CACHED_CHECK_TTL_SECONDS)
        .catch(() => {});
    }
  }

  return result;
};

/* ------------------------------------------------------------- add / prepare */

/**
 * Read the account's torrent list.
 *
 * `bypass_cache: true` asks TorBox to re-scan instead of serving its cached
 * feed. That is the correct default when we have no idea what the account
 * holds, and the wrong call when `checkCached` already answered: under load the
 * re-scan is the request that misses the 15s deadline, and a resolve that only
 * ever wanted a torrent we KNOW is in the account dies on it.
 */
/** Env number with a fallback. Unset, blank and junk all take the default, so a
 *  blank line in .env can never mean "zero timeout". */
const positiveNumber = (raw, fallback) => {
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/**
 * How long the FORCED re-scan may take.
 *
 * That scan only answers one question: "is this infohash already in the
 * account?" When it cannot answer quickly, the cached feed plus the
 * magnet-add (which is idempotent, and is what a not-cached release needs
 * anyway) is a complete substitute — the caller already retries against the
 * cached feed on a timeout. Spending the full 15s to learn "no" is what turned
 * a 4.7s candidate into a 15s one, and the viewer waited for the difference.
 */
const FRESH_LIST_TIMEOUT_MS =
  positiveNumber(process.env.TORBOX_FRESH_LIST_TIMEOUT_SECONDS, 6) * 1000;

const findTorrentByHash = async (key, infoHash, { bypassCache = true, timeoutMs } = {}) => {
  const payload = await request('/torrents/mylist', key, {
    params: { bypass_cache: bypassCache ? 'true' : 'false' },
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  const wanted = String(infoHash).toLowerCase();
  return (payload?.data || []).find((t) => String(t.hash || '').toLowerCase() === wanted) || null;
};

/** Direct lookup by id: a just-added torrent can be missing from the list feed. */
const findTorrentById = async (key, torrentId, { bypassCache = true } = {}) => {
  if (torrentId === undefined || torrentId === null) return null;
  try {
    const payload = await request('/torrents/mylist', key, {
      params: { bypass_cache: bypassCache ? 'true' : 'false', id: torrentId },
    });
    const data = payload?.data;
    if (Array.isArray(data)) {
      return data.find((t) => String(t.id) === String(torrentId)) || null;
    }
    return data && data.id !== undefined ? data : null;
  } catch {
    return null;
  }
};

/**
 * TorBox reports progress as a 0-1 fraction; the UI wants a percentage.
 * Values above 1 are already percentages (older responses), so pass those through.
 */
const toPercent = (progress) => {
  const value = Number(progress || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return value <= 1 ? Math.round(value * 1000) / 10 : Math.min(value, 100);
};

/**
 * A cached torrent is instantly readable even before the account-side
 * download flags flip, so `download_state: 'cached'` counts as ready.
 */
const isTorrentReady = (torrent) =>
  Boolean(torrent.download_finished && torrent.download_present) ||
  String(torrent.download_state || '').toLowerCase() === 'cached' ||
  (Boolean(torrent.cached) && Number(torrent.progress || 0) >= 1);

/**
 * Make a source ready to read, then report its state.
 *
 * `ready` means a file can be requested now. `downloading` means the caller
 * should poll: TorBox is still pulling it, so an immediate read would stall.
 *
 * `assumeCached` is the caller's `checkCached` verdict for this infohash. It
 * only changes how the list is read (cached feed instead of a forced re-scan),
 * never the verdict: a stale "cached" answer that finds nothing in the feed
 * lands on the same add-magnet path as a genuine miss.
 */
export const prepareSource = async (
  key,
  { magnet, infoHash, torrentId = null, assumeCached = false },
) => {
  if (!magnet && !infoHash && torrentId === null) {
    throw new DebridError('Cần magnet hoặc infoHash', { status: 400, code: 'bad_request' });
  }

  const listOptions = { bypassCache: !assumeCached };
  // Only the forced re-scan gets the short deadline; a cached read is already
  // the cheap answer, and the post-add confirmation below must keep the full
  // budget because a wrong answer there stalls playback instead of just
  // costing a retry.
  const lookupOptions = assumeCached ? listOptions : { ...listOptions, timeoutMs: FRESH_LIST_TIMEOUT_MS };
  let torrent = infoHash ? await findTorrentByHash(key, infoHash, lookupOptions) : null;
  if (!torrent && torrentId !== null) torrent = await findTorrentById(key, torrentId, listOptions);

  if (!torrent) {
    if (!magnet) {
      throw new DebridError('Nguồn chưa có trong TorBox và không có magnet để thêm', {
        status: 404,
        code: 'not_found',
      });
    }

    // TorBox wants multipart/form-data here, not JSON.
    const form = new FormData();
    form.append('magnet', magnet);
    form.append('seed', '3'); // 3 = don't seed, cheapest for our use.
    form.append('allow_zip', 'false');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let added;
    try {
      const response = await fetch(`${BASE_URL}/torrents/createtorrent`, {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        body: form,
        signal: controller.signal,
      });
      const raw = await response.text();
      try {
        added = JSON.parse(raw);
      } catch {
        throw new DebridError(`TorBox trả về dữ liệu không hợp lệ khi thêm magnet (${response.status})`);
      }
      if (response.status === 401 || response.status === 403) {
        throw new DebridError('TorBox từ chối API key này', { status: 401, code: 'invalid_token' });
      }
      if (!response.ok || added?.success === false) {
        throw new DebridError(`Không thêm được magnet: ${scrub(added?.detail || raw.slice(0, 200), key)}`);
      }
    } catch (error) {
      if (error instanceof DebridError) throw error;
      if (error.name === 'AbortError') {
        throw new DebridError('Thêm magnet vào TorBox quá thời gian chờ', { status: 504, code: 'timeout' });
      }
      throw new DebridError(`Không thêm được magnet: ${scrub(error.message, key)}`);
    } finally {
      clearTimeout(timer);
    }

    const hash = added?.data?.hash || infoHash;
    const newId = added?.data?.torrent_id ?? null;
    torrent = await findTorrentByHash(key, hash);
    // The list feed lags behind createtorrent, so fall back to an id lookup
    // before declaring a freshly-added cached torrent "still downloading".
    if (!torrent) torrent = await findTorrentById(key, newId);
    if (!torrent) {
      // Queued but not yet listed: tell the caller to poll rather than fail.
      return { state: 'downloading', progress: 0, torrentId: newId, files: [] };
    }
  }

  const ready = isTorrentReady(torrent);

  return {
    state: ready ? 'ready' : 'downloading',
    progress: toPercent(torrent.progress),
    torrentId: torrent.id,
    name: torrent.name || '',
    size: Number(torrent.size || 0),
    seeds: Number(torrent.seeds || 0),
    files: (torrent.files || []).map((file) => ({
      fileId: file.id,
      name: file.short_name || file.name || '',
      path: file.name || '',
      size: Number(file.size || 0),
      mimeType: file.mimetype || '',
    })),
  };
};

/* ------------------------------------------------------------------- linking */

/**
 * Resolve a playable URL for one file.
 *
 * Cached briefly per (user, torrent, file): resolving is rate-limited upstream,
 * and a page reload during playback should not spend a fresh call. The cache key
 * includes userId because the link is account-scoped.
 */
export const getDownloadUrl = async (key, { torrentId, fileId, userId }) => {
  if (torrentId === undefined || torrentId === null) {
    throw new DebridError('Thiếu torrentId', { status: 400, code: 'bad_request' });
  }

  const cacheKey = `torbox:link:${userId || 'anon'}:${torrentId}:${fileId ?? 'auto'}`;
  const hit = await cacheClient.get(cacheKey).catch(() => null);
  if (hit) return hit;

  const payload = await request('/torrents/requestdl', key, {
    params: {
      token: key, // TorBox requires the key in the query string for this endpoint.
      torrent_id: torrentId,
      file_id: fileId,
      redirect: 'false',
    },
  });

  const url = payload?.data;
  if (!url || typeof url !== 'string') {
    throw new DebridError('TorBox không trả về link tải');
  }

  await cacheClient.set(cacheKey, url, 'EX', LINK_TTL_SECONDS).catch(() => {});
  return url;
};

/**
 * Bust one cached download URL so the next resolve mints a fresh link.
 *
 * The cache is what turns a single expired link into a 15-minute outage:
 * every retry inside the TTL would otherwise receive the same dead URL and
 * kill its ffmpeg the same way. Called when a writer dies on an
 * auth-flavoured error, and only then — a healthy cache entry is worth more
 * than a redundant requestdl call against a rate-limited endpoint.
 */
export const dropDownloadUrl = async ({ torrentId, fileId, userId }) => {
  // Both ids are required: 'auto'-keyed entries belong to callers that never
  // named a file, and busting the wrong key is worse than busting nothing.
  if (torrentId === undefined || torrentId === null) return false;
  if (fileId === undefined || fileId === null) return false;
  const cacheKey = `torbox:link:${userId || 'anon'}:${torrentId}:${fileId}`;
  try {
    await cacheClient.del(cacheKey);
    return true;
  } catch {
    return false;
  }
};

/** Drop a torrent from the account. Best-effort: never block a disconnect. */
export const removeTorrent = async (key, torrentId) => {
  try {
    await request('/torrents/controltorrent', key, {
      method: 'POST',
      body: { torrent_id: Number(torrentId), operation: 'delete' },
    });
    return true;
  } catch {
    return false;
  }
};

export default {
  PROVIDER,
  verifyKey,
  checkCached,
  prepareSource,
  isTransientDebridError,
  getDownloadUrl,
  dropDownloadUrl,
  removeTorrent,
};
