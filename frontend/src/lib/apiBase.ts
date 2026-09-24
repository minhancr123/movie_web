/**
 * Where this process should reach the API.
 *
 * NEXT_PUBLIC_* values are baked into the bundle at build time and are shared
 * by the server render and the browser, which is fine on a platform where the
 * app and the API are different hosts. Self-hosted behind one reverse proxy it
 * is not: the container would have to call its own public domain and loop back
 * in through the proxy, which depends on the host being able to reach itself
 * (hairpin NAT). Where that is blocked — and several providers block it — the
 * server render fails, the catalog falls back to empty, and the home page comes
 * up blank with nothing in the log but a fetch error.
 *
 * So the server prefers a private address (INTERNAL_API_URL, read at runtime,
 * not baked) and the browser always uses the public one.
 */
export const resolveApiBase = (args: {
  /** True while rendering on the server. */
  isServer: boolean;
  /** Private address reachable from inside the network, e.g. http://backend-node:5001/api */
  internal?: string | null;
  /** Public address the browser uses, e.g. https://phim.example.com/api */
  publicUrl?: string | null;
  fallback?: string;
}): string => {
  const clean = (v?: string | null) => {
    const s = String(v ?? '').trim().replace(/\/+$/, '');
    return s || null;
  };
  const fallback = args.fallback ?? 'http://localhost:5001/api';
  if (args.isServer) {
    // Private first; a deployment that sets neither still works via the public
    // one, so this stays optional rather than another thing to get wrong.
    return clean(args.internal) ?? clean(args.publicUrl) ?? fallback;
  }
  // The browser can never use a private address, so it never looks at one.
  return clean(args.publicUrl) ?? fallback;
};
