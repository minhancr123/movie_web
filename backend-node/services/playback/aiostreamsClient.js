import crypto from 'node:crypto';

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export const aiostreamsCacheScope = (config = process.env.AIOSTREAMS_USER_DATA || '') =>
  crypto.createHash('sha256').update(config).digest('hex').slice(0, 20);

/** A fixed, operator-configured Docker peer; never a URL supplied by a viewer. */
export const fetchAioStreams = async ({ type, id }, {
  env = process.env, fetchFn = globalThis.fetch, timeoutMs = 8000,
} = {}) => {
  const base = new URL(env.AIOSTREAMS_BASE_URL || 'http://aiostreams:3000');
  if (base.protocol !== 'http:' || !['aiostreams', 'cineon-aiostreams', '127.0.0.1'].includes(base.hostname)
      || !['3000', '3100'].includes(base.port) || base.username || base.password
      || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('AIOStreams endpoint configuration is invalid');
  }
  if (!['movie', 'series'].includes(type) || !/^tt\d+(?::\d+:\d+)?$/.test(id)) {
    throw new Error('AIOStreams media identifier is invalid');
  }
  if (!env.AIOSTREAMS_USER_DATA) throw new Error('AIOStreams configuration is missing');
  const url = new URL('/api/v1/search', base);
  url.search = new URLSearchParams({ type, id, format: 'true' }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      headers: { 'x-aiostreams-user-data': env.AIOSTREAMS_USER_DATA, accept: 'application/json' },
      signal: controller.signal, redirect: 'error',
    });
    if (!response.ok) throw new Error(`AIOStreams HTTP ${response.status}`);
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) { controller.abort(); throw new Error('AIOStreams response is too large'); }
      chunks.push(Buffer.from(value));
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!payload.success || !Array.isArray(payload.data?.results)) throw new Error('AIOStreams search failed');
    // Return Stremio-shaped metadata to the existing validated infohash path.
    // Account-specific debrid links are deliberately not shared between viewers.
    return payload.data.results.slice(0, 150).map((row) => ({
      infoHash: row.infoHash,
      fileIdx: row.fileIdx,
      name: row.name || 'AIOStreams',
      title: row.filename || row.description || '',
      description: row.description || '',
      behaviorHints: { filename: row.filename || '', videoSize: row.size || 0 },
    }));
  } finally {
    clearTimeout(timer);
  }
};
