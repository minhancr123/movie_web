# Cloudflare cached layout chunk 404 — 2026-11-01

The reported `ChunkLoadError` for chunk 7177 referenced
`/_next/static/chunks/app/layout-8726a5c03b52b644.js`.

## Evidence

- Frontend port 3000 and nginx port 80 returned 200, 47,812 bytes.
- The public URL returned 404, `CF-Cache-Status: HIT`, and a 30-day TTL.
- The same URL with a fresh query returned 200. Only this file failed among
  the 14 static assets referenced by the homepage.
- Cloudflare rule `Cache static assets at edge`
  (`d296abce1da34fada3fa413999271820`) matched static file extensions and
  overrode both edge and browser TTL to 30 days, ignoring origin directives.

## Production action

Purged only the exact layout chunk URL in Cloudflare. Updated that existing
rule: edge TTL now uses the origin cache-control header and bypasses cache
when absent; browser TTL respects the origin TTL. Match expression and other
rules were unchanged. No application deployment or service restart was needed.

The previous settings were edge `Ignore cache-control header and use this
TTL: 30 days` and browser `Override origin and use this TTL: 30 days`.

## Verification

- Exact public URL: 200, 47,812 bytes, initial cache MISS.
- SHA-256: `7af6127c36bb017971a97e7a3bb49924e7a3cf17627f030df474471dfc99682a`.
- All 14 homepage static assets returned 200.
- Two requests for a deliberately nonexistent chunk returned 404 with
  `private, no-cache, no-store, max-age=0, must-revalidate` and cache BYPASS.
- `/sw.js` returned 200, no-store, cache BYPASS.
- Fresh browser load rendered the homepage with no captured console errors.
- Existing Chrome tab retained its locally cached 404 on normal reload;
  Cmd+Shift+R restored the homepage. Existing affected browsers may also need
  one hard refresh because CDN purging cannot clear their local cache.

The separate `/cdn-cgi/rum` connection-closed report was not reproduced or
established as a cause of the chunk failure. No analytics settings were changed.
