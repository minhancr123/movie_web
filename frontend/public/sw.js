/* eslint-env serviceworker */
/**
 * CineVN service worker.
 *
 * Replaces a workbox build that had been sitting in public/ since April 2026,
 * precaching a Pages-Router route table that no longer exists (xem-phim/[slug]/,
 * phim/[slug]/, chunks/pages/_app-*.js) against a single frozen build id. Because
 * it lived in public/ it was copied verbatim into every image, so its bytes never
 * changed, the browser never re-installed it, and returning visitors have had it
 * intercepting every .js through StaleWhileRevalidate ever since. This file
 * replaces it and purges what it left behind.
 *
 * Scope, deliberately small. This is a video site: the media is hundreds of
 * megabytes per episode served immutable from /api/playback/hls/r/, and the HTTP
 * cache already does that job correctly. Putting segments in the Cache API
 * would duplicate 450 MB per episode into storage and serve nothing faster. So
 * this caches the shell, and nothing else.
 */

/** Bump on any behavioural change: the old cache is purged on activate. */
const VERSION = 'cinevn-v1';
const SHELL_CACHE = `cinevn-shell-${VERSION}`;
const ASSET_CACHE = `cinevn-assets-${VERSION}`;
const OWN_CACHES = new Set([SHELL_CACHE, ASSET_CACHE]);

/**
 * Never touched, whatever the strategy would otherwise say.
 *
 * /api/ is the playback, catalog and auth surface: a cached resolve or session
 * poll is worse than no response at all. The HLS routes are the media itself.
 * Cross-origin is the font CDN, which has its own long-lived headers.
 */
const isUncacheable = (url) =>
  url.pathname.startsWith('/api/')
  || url.pathname.startsWith('/_next/image')
  || url.origin !== self.location.origin;

/** Content-hashed and served immutable, so a hit can never be wrong. */
const isImmutableAsset = (url) => url.pathname.startsWith('/_next/static/');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(['/offline.html', '/manifest.json', '/icon-192.png', '/icon.png']))
      // An offline page that cannot be cached must not block installation.
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        // Everything not named by this version goes, including the workbox
        // caches from the old build. That is the whole point of this file: a
        // visitor who installed the April precache is currently serving a
        // chunk list from a Pages-Router app that has not existed since then.
        names.filter((name) => !OWN_CACHES.has(name))
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

// The page asks for this instead of calling skipWaiting from here, so the worker
// only advances at a moment the page chose — mid-session it would swap the code
// under a running player.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isUncacheable(url)) return;

  // Hashed build output: cache-first. The name changes when the bytes change,
  // so there is nothing to revalidate.
  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Pages: network-first. The server sends them no-store, so a cached copy would
  // be a stale document showing a build that is no longer deployed — the exact
  // failure that made "which build am I running?" unanswerable from the page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html')),
    );
    return;
  }

  // Same-origin images and icons: stale-while-revalidate.
  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => hit);
      return hit || network;
    }),
  );
});
