/**
 * Cloudflare Worker: minimal reverse proxy for the TMDB API.
 *
 * Why this exists: several Vietnamese ISPs block api.themoviedb.org at the
 * TLS/SNI layer. DNS resolves, TCP connects, then the handshake is reset — so
 * changing DNS does not help. A Worker sits outside that path and is reachable
 * from Vietnam, so the backend can reach TMDB through it.
 *
 * Deploy:
 *   1. npm i -g wrangler && wrangler login
 *   2. wrangler deploy scripts/tmdb-proxy-worker.js --name tmdb-proxy --compatibility-date 2024-01-01
 *   3. wrangler secret put PROXY_TOKEN      (any long random string)
 *   4. Put these in backend-node/.env:
 *        TMDB_BASE_URL=https://tmdb-proxy.<your-subdomain>.workers.dev/3
 *        TMDB_PROXY_TOKEN=<the same random string>
 *
 * The shared token keeps this from being an open proxy for strangers. Your TMDB
 * credentials still travel in the Authorization header, which this Worker
 * forwards untouched and never logs.
 *
 * Not needed when the backend runs on a VPS outside Vietnam — leave
 * TMDB_BASE_URL unset there and the default upstream is used directly.
 */

const UPSTREAM = 'https://api.themoviedb.org';

export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    if (env.PROXY_TOKEN) {
      const presented = request.headers.get('x-proxy-token');
      if (presented !== env.PROXY_TOKEN) {
        return new Response('Forbidden', { status: 403 });
      }
    }

    const incoming = new URL(request.url);
    const target = new URL(incoming.pathname + incoming.search, UPSTREAM);

    // Forward only what TMDB needs; drop cookies, client IP headers and our own
    // proxy token so nothing extra reaches upstream.
    const headers = new Headers();
    const auth = request.headers.get('authorization');
    if (auth) headers.set('authorization', auth);
    headers.set('accept', request.headers.get('accept') || 'application/json');

    const response = await fetch(target.toString(), {
      method: request.method,
      headers,
      redirect: 'follow',
    });

    const out = new Headers(response.headers);
    out.delete('set-cookie');
    return new Response(response.body, { status: response.status, headers: out });
  },
};
