import http from 'k6/http';
import { check } from 'k6';

const baseURL = () => String(__ENV.BASE_URL || '').replace(/\/$/, '');
const tokens = () => String(__ENV.TEST_TOKENS || __ENV.TEST_TOKEN || '')
  .split(',').map(value => value.trim()).filter(Boolean);
const type = () => __ENV.FIXTURE_TYPE || 'movie';
const tmdbId = () => Number(__ENV.FIXTURE_TMDB_ID || 1272837);
const is4K = () => __ENV.TEST_4K === 'true'
  && (__VU % Number(__ENV.FOUR_K_EVERY || 10) === 0);
const smoke = __ENV.SMOKE === 'true';
const vuCount = Number(__ENV.VUS || 100);

const authParams = token => ({
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  tags: { kind: 'media_playback' },
});

const resolveAssetURL = (asset, playlistURL) => {
  if (/^https?:\/\//i.test(asset)) return asset;
  const origin = playlistURL.match(/^(https?:\/\/[^/]+)/i)?.[1] || '';
  if (asset.startsWith('/')) return `${origin}${asset}`;
  return `${playlistURL.slice(0, playlistURL.lastIndexOf('/') + 1)}${asset}`;
};

const capabilities = () => is4K() ? {
  windowedRemux: true, hevc: true, hevcMain10: true, av1: true,
  hdr: true, maxHeight: 2160, preferredMaxHeight: 2160,
  maxBitrateMbps: Number(__ENV.FOUR_K_BITRATE_MBPS || 25),
  eac3: true, webm: true, decodingSmooth: true,
  powerEfficient: false, smoothMaxHeight: 2160,
} : {
  windowedRemux: true, hevc: true, hevcMain10: false, av1: false,
  hdr: false, maxHeight: 1080, preferredMaxHeight: 1080,
  maxBitrateMbps: 10, eac3: true, webm: true,
  decodingSmooth: true, powerEfficient: true, smoothMaxHeight: 1080,
};

export const options = {
  scenarios: {
    playback: smoke
      ? { executor: 'per-vu-iterations', vus: 1, iterations: 1, maxDuration: '2m' }
      : {
        executor: 'per-vu-iterations',
        vus: vuCount,
        iterations: 1,
        maxDuration: __ENV.MAX_DURATION || '15m',
      },
  },
  thresholds: {
    'http_req_duration{kind:media_playback}': ['p(95)<5000'],
    'http_req_failed{kind:media_playback}': ['rate<0.01'],
    'checks{kind:media_playback}': ['rate>0.99'],
  },
};

export default function () {
  if (!baseURL() || __ENV.ALLOW_LOAD_TEST !== 'yes') {
    throw new Error('BASE_URL and ALLOW_LOAD_TEST=yes are required');
  }
  const tokenPool = tokens();
  if (!tokenPool.length) {
    throw new Error('TEST_TOKENS is required; use dedicated test account tokens');
  }
  if (!smoke && vuCount > 1 && tokenPool.length < vuCount) {
    throw new Error(`TEST_TOKENS must contain at least ${vuCount} tokens`);
  }
  const auth = authParams(tokenPool[(__VU - 1) % tokenPool.length]);
  const resolvePayload = JSON.stringify({
    type: type(),
    tmdbId: tmdbId(),
    capabilities: capabilities(),
    asyncQueue: true,
    resolveId: `k6-${__VU}-${__ITER}-${Date.now()}`,
  });
  const start = http.post(`${baseURL()}/api/playback/resolve`, resolvePayload, {
    ...auth,
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
  });
  check(start, {
    'resolve accepted': response => response.status === 200 || response.status === 202,
    'resolve response is JSON': response => response.headers['Content-Type']?.includes('application/json'),
  }, { kind: 'media_playback' });
  if (start.status === 429 || start.status === 503
      || (start.status !== 200 && start.status !== 202)) return;

  let body = start.json('data') || {};
  const deadline = Date.now() + Number(__ENV.RESOLVE_TIMEOUT_MS || 120000);
  while (body.mode === 'resolve_pending' && Date.now() < deadline) {
    const poll = http.get(
      `${baseURL()}/api/playback/resolve-jobs/${encodeURIComponent(body.jobId)}`,
      auth,
    );
    check(poll, {
      'resolve poll accepted': response => response.status === 200 || response.status === 202,
    }, { kind: 'media_playback' });
    if (poll.status === 429 || poll.status === 503) return;
    body = poll.json('data') || {};
  }

  check(body, {
    'resolve completed': data => Boolean(data.sessionId || data.url || data.playlistUrl),
  }, { kind: 'media_playback' });
  const playlist = body.playlistUrl || body.url;
  if (!playlist) return;
  const playlistURL = playlist.startsWith('http') ? playlist : `${baseURL()}${playlist}`;
  if (!/^https?:\/\//i.test(playlistURL) || /[\u0000-\u001f\u007f]/.test(playlistURL)) return;
  const manifest = http.get(playlistURL, auth);
  check(manifest, {
    'HLS manifest loads': response => response.status === 200,
    'HLS manifest has media': response => /#EXTM3U/.test(response.body || ''),
  }, { kind: 'media_playback' });
  if (manifest.status !== 200) return;

  const segment = (manifest.body || '').split('\n').map(line => line.trim()).find(line =>
    line && !line.startsWith('#') && /\.(m4s|ts)(\?.*)?$/.test(line));
  if (!segment || /[\u0000-\u001f\u007f]/.test(segment) || segment.length > 2048) return;
  const segmentURL = resolveAssetURL(segment, playlistURL);
  if (!/^https?:\/\//i.test(segmentURL) || /[\u0000-\u001f\u007f]/.test(segmentURL)) return;
  const segmentResponse = http.get(segmentURL, {
    headers: { Accept: '*/*' },
    tags: { kind: 'media_playback' },
  });
  check(segmentResponse, {
    'first HLS segment loads': response => response.status === 200,
  }, { kind: 'media_playback' });
}
