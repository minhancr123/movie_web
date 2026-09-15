#!/usr/bin/env node
/**
 * Tells you whether an addon URL will actually work in this backend, before you
 * put it in .env and find out through a failed playback.
 *
 * It answers with this backend's own rules, not a generic HTTP check: the same
 * assertUrlShape, the same safeFetchJson, the same URL construction the resolver
 * uses. That matters because the two ways an addon usually fails here are both
 * invisible to curl — a port outside the allowlist, and a private address the
 * SSRF guard refuses. A self-hosted Jackettio on :4000 answers curl perfectly
 * and is rejected by this backend every time.
 *
 *   node scripts/probe-addon.js <addon-url> [imdb-id]
 *   node scripts/probe-addon.js https://torrentio.strem.fun tt1375666
 *   node scripts/probe-addon.js https://nhamsub.mobifone.solutions
 *
 * Exit code is 0 only when the addon returned usable results.
 */

import { assertUrlShape, safeFetchJson, SsrfError } from '../services/security/safeFetch.js';
import { buildSubtitleUrl } from '../services/addonClient.js';

/** Inception: old, universally indexed, and subtitled in many languages. */
const DEFAULT_ID = 'tt1375666';
const MANIFEST_TIMEOUT_MS = 8000;
const PROBE_TIMEOUT_MS = 10000;

/**
 * A configured Comet or MediaFusion URL carries the debrid API key inside its
 * path. Printing it back — to a terminal, a CI log, a pasted bug report — hands
 * that key to whoever reads the output, so only the origin is ever echoed.
 */
const safeLabel = (raw) => {
  try {
    const url = new URL(raw);
    const hiddenSegments = url.pathname.split('/').filter(Boolean).length;
    return hiddenSegments > 0 ? `${url.origin}/…(${hiddenSegments} path segment(s) ẩn)` : url.origin;
  } catch {
    return '(URL không hợp lệ)';
  }
};

const ok = (msg) => console.log(`  [32mOK[0m    ${msg}`);
const bad = (msg) => console.log(`  [31mFAIL[0m  ${msg}`);
const warn = (msg) => console.log(`  [33mWARN[0m  ${msg}`);
const info = (msg) => console.log(`        ${msg}`);

const timed = async (fn) => {
  const started = Date.now();
  try {
    return { value: await fn(), ms: Date.now() - started };
  } catch (error) {
    return { error, ms: Date.now() - started };
  }
};

const describeFailure = (error) => {
  if (error instanceof SsrfError) return `chặn bởi SSRF guard: ${error.message}`;
  const message = String(error?.message || error);
  if (/timeout|abort/i.test(message)) return `quá ${PROBE_TIMEOUT_MS / 1000}s không phản hồi`;
  return message;
};

const main = async () => {
  const [rawUrl, id = DEFAULT_ID] = process.argv.slice(2);
  if (!rawUrl) {
    console.error('Dùng: node scripts/probe-addon.js <addon-url> [imdb-id]');
    process.exit(2);
  }

  const addon = rawUrl.trim().replace(/\/+$/, '');
  console.log(`\nProbe addon: ${safeLabel(addon)}`);
  console.log(`Thử với id : ${id}\n`);

  /* 1. Shape — the check that rejects self-hosted ports before any network. */
  try {
    assertUrlShape(addon);
    ok('URL shape hợp lệ (scheme, cổng, không có credential)');
  } catch (error) {
    bad(`URL shape bị từ chối: ${error.message}`);
    info('Cổng cho phép: 80, 443, 8080, 8443, 7000.');
    info('Jackettio mặc định 4000 và Jackett 9117 đều KHÔNG nằm trong đó —');
    info('đặt sau reverse proxy HTTPS ở cổng 443 là cách chạy được.');
    // Every path ends with a verdict line so the output is greppable whether it
    // failed at the first check or the last.
    console.log('\nKết luận: KHÔNG dùng được — URL bị từ chối trước cả khi gọi mạng.\n');
    process.exit(1);
  }

  /* 2. Manifest — first real request, so DNS and the private-address rule
        both get exercised here rather than during someone's playback. */
  const manifest = await timed(() => safeFetchJson(`${addon}/manifest.json`, { timeoutMs: MANIFEST_TIMEOUT_MS }));
  if (manifest.error) {
    bad(`manifest.json: ${describeFailure(manifest.error)} (${manifest.ms}ms)`);
    if (manifest.error instanceof SsrfError) {
      info('Địa chỉ private (10.x, 127.x, 192.168.x, CGNAT, ::1) luôn bị từ chối.');
      info('Addon phải nằm trên địa chỉ công khai.');
    }
    console.log('\nKết luận: KHÔNG dùng được — không lấy được manifest.\n');
    process.exit(1);
  }

  const m = manifest.value || {};
  const resources = (m.resources || []).map((r) => (typeof r === 'string' ? r : r?.name)).filter(Boolean);
  ok(`manifest.json (${manifest.ms}ms)`);
  info(`id=${m.id || '?'}  name=${m.name || '?'}`);
  info(`resources=${JSON.stringify(resources)}  types=${JSON.stringify(m.types || [])}`);
  if (m.idPrefixes && !m.idPrefixes.includes('tt')) {
    warn(`idPrefixes=${JSON.stringify(m.idPrefixes)} — không nhận IMDb id, backend này chỉ gửi "tt…"`);
  }

  /* 3. The resource this addon actually claims to serve. Probing a subtitle
        addon for streams would report a false failure, and vice versa. */
  const hasStream = resources.includes('stream');
  const hasSubtitles = resources.includes('subtitles');
  if (!hasStream && !hasSubtitles) {
    bad('Addon không khai báo "stream" lẫn "subtitles" — backend này không dùng được.');
    process.exit(1);
  }

  let usable = false;
  // A request that errored and one that answered with an empty list are
  // different verdicts: the first is broken, the second is simply missing this
  // title. Reporting them the same way sends you looking in the wrong place.
  let errored = false;

  if (hasStream) {
    // Exactly the URL getStreamCandidates builds.
    const url = `${addon}/stream/movie/${encodeURIComponent(id)}.json`;
    const res = await timed(() => safeFetchJson(url, { timeoutMs: PROBE_TIMEOUT_MS }));
    if (res.error) {
      errored = true;
      bad(`stream: ${describeFailure(res.error)} (${res.ms}ms)`);
      info('403/404 ở đây thường nghĩa là addon cần config nhúng trong path.');
      info('Dán URL ĐÃ CẤU HÌNH (vd https://comet.../<config>), không phải domain trần.');
    } else {
      const streams = Array.isArray(res.value?.streams) ? res.value.streams : [];
      if (streams.length) {
        usable = true;
        ok(`stream: ${streams.length} nguồn (${res.ms}ms)`);
        info(`ví dụ: ${String(streams[0]?.title || streams[0]?.name || '').split('\n')[0].slice(0, 70)}`);
      } else {
        warn(`stream: 0 nguồn cho ${id} (${res.ms}ms) — addon sống nhưng không có phim này`);
      }
    }
  }

  if (hasSubtitles) {
    const url = buildSubtitleUrl(addon, 'movie', id);
    const res = await timed(() => safeFetchJson(url, { timeoutMs: PROBE_TIMEOUT_MS }));
    if (res.error) {
      errored = true;
      bad(`subtitles: ${describeFailure(res.error)} (${res.ms}ms)`);
    } else {
      const subs = Array.isArray(res.value?.subtitles) ? res.value.subtitles : [];
      const vi = subs.filter((s) => /^vi/i.test(String(s?.lang || s?.language || ''))).length;
      if (subs.length) {
        usable = true;
        ok(`subtitles: ${subs.length} bản, trong đó ${vi} tiếng Việt (${res.ms}ms)`);
      } else {
        warn(`subtitles: 0 bản cho ${id} (${res.ms}ms)`);
      }
    }
  }

  /* 4. Latency is a real cost, not a footnote: addons are queried in parallel
        but the resolve waits for the slowest, and a cold start already spends
        most of its time here. */
  const slowest = Math.max(manifest.ms, 0);
  if (slowest > 4000) {
    warn(`Addon chậm (${slowest}ms). Addon chạy song song nhưng resolve chờ thằng chậm nhất;`);
    info('timeout là 10s, nên một addon chậm kéo dài lần bật đầu của mọi phim.');
  }

  if (usable) {
    console.log('\nKết luận: dùng được — thêm vào STREMIO_ADDONS / STREMIO_SUBTITLE_ADDONS.\n');
  } else if (errored) {
    console.log('\nKết luận: KHÔNG dùng được — request bị lỗi, xem dòng FAIL ở trên.\n');
  } else {
    console.log('\nKết luận: addon chạy nhưng không có id này. Thử id khác trước khi loại nó.\n');
  }
  process.exit(usable ? 0 : 1);
};

main().catch((error) => {
  console.error(`\nProbe lỗi ngoài dự kiến: ${error?.message || error}\n`);
  process.exit(2);
});
