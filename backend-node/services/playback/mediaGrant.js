/**
 * Scoped media grants for native HLS playback.
 *
 * Problem: Safari native `<video src="...index.m3u8?access_token=<login JWT>">`
 * fetches child assets (init.mp4, seg_*.m4s) itself with no way to attach an
 * Authorization header, and relative URLs in the playlist do NOT inherit the
 * parent's query string. Rewriting child URLs with the long-lived login JWT
 * would leak account credentials into logs, history and any shared cache.
 *
 * Design (per docs/playback/implementation-handoff-prompt.vi.md):
 *   - Short-lived, single-purpose bearer scoped to ONE playback session or ONE
 *     published rendition, verified by purpose/audience/scope — never usable
 *     as an account API token (authMiddleware rejects pur === 'media').
 *   - Issued only by an already-authenticated manifest response; the playlist
 *     bytes on disk NEVER contain a token. The rewrite happens in memory on
 *     the response path (`serveHlsAsset` / `serveRenditionAsset`).
 *   - Query param name is `media_grant`. Manifests are served
 *     `Cache-Control: private, no-store`; segments stay immutable.
 *   - Lifetime is per-session: never beyond
 *     min(session.expiresAt, issuedAt + 6h). Fixtures may use a short TTL to
 *     exercise refresh; production TTL is NOT shortened ad hoc.
 *   - GET/HEAD only. A revoked/expired/deleted session still 404/410s because
 *     the controller re-checks the session row even on the grant path — a
 *     valid grant for a dead session buys nothing, so nothing is "re-issued".
 */

import crypto from 'crypto';
import jwt from 'jsonwebtoken';

export const MEDIA_GRANT_QUERY = 'media_grant';
export const MEDIA_GRANT_PURPOSE = 'media';
export const MEDIA_GRANT_AUDIENCE = 'playback-hls';
/** Session-scoped lifetime ceiling: a grant never outlives the viewing session. */
export const MEDIA_GRANT_MAX_TTL_MS = 6 * 60 * 60 * 1000;

const HEX32 = /^[a-f0-9]{32}$/i;

const normId = (value) => {
  const s = String(value || '').toLowerCase();
  return HEX32.test(s) ? s : '';
};

/**
 * Signing key for media grants. Production MUST set a dedicated
 * MEDIA_GRANT_SECRET (see docker-compose.prod.yml); local/dev falls back to
 * JWT_SECRET so the suite runs without extra env. The fallback is explicit —
 * see `isMediaGrantSecretFallback()` — and purpose/audience checks still keep
 * grants unusable as account tokens even when the keys coincide.
 */
export const getMediaGrantSecret = () =>
  process.env.MEDIA_GRANT_SECRET || process.env.JWT_SECRET || '';

export const isMediaGrantSecretFallback = () => !process.env.MEDIA_GRANT_SECRET;

/**
 * Mint a grant for exactly one scope.
 *
 * @param {object} args
 * @param {string} [args.sessionId] - 32-hex playback session (route /hls/:sessionId/*)
 * @param {string} [args.renditionId] - 32-hex published rendition (route /hls/r/:renditionId/*)
 * @param {number} [args.sessionExpiresAtMs] - session.expiresAt; grant never exceeds it
 * @param {number} [args.nowMs] - clock override for tests
 * @param {number} [args.ttlMs] - requested lifetime; clamped to MEDIA_GRANT_MAX_TTL_MS
 */
export const mintMediaGrant = ({
  sessionId = null,
  renditionId = null,
  sessionExpiresAtMs = null,
  nowMs = Date.now(),
  ttlMs = MEDIA_GRANT_MAX_TTL_MS,
} = {}) => {
  const secret = getMediaGrantSecret();
  if (!secret) throw new Error('media-grant-secret-missing');
  const sid = sessionId ? normId(sessionId) : '';
  const rid = renditionId ? normId(renditionId) : '';
  if ((sid && rid) || (!sid && !rid)) throw new Error('media-grant-scope-invalid');
  const now = Number(nowMs) || Date.now();
  const requestedTtl = Math.min(Number(ttlMs) > 0 ? Number(ttlMs) : MEDIA_GRANT_MAX_TTL_MS, MEDIA_GRANT_MAX_TTL_MS);
  let expMs = now + requestedTtl;
  const cap = Number(sessionExpiresAtMs);
  if (Number.isFinite(cap) && cap > 0) expMs = Math.min(expMs, cap);
  // Absolute second-precision expiry, floored. JWT `exp` cannot represent
  // sub-second remainders: at most <1s of slack past the cap, which the
  // per-request session-expiry check (410 in serveHlsAsset) closes — a grant
  // for a dead session opens nothing. What this MUST NOT do is gain a whole
  // extra second via a delta `expiresIn ... || 1`, minting past the session.
  const expSec = Math.floor(expMs / 1000);
  if (!(expSec > Math.floor(now / 1000))) throw new Error('media-grant-already-expired');
  const payload = {
    pur: MEDIA_GRANT_PURPOSE,
    aud: MEDIA_GRANT_AUDIENCE,
    ...(sid ? { sid } : { rid }),
    exp: expSec,
  };
  const token = jwt.sign(payload, secret);
  return { token, expiresAtMs: expMs };
};

/**
 * Verify a presented grant, optionally pinning the expected scope from the URL.
 * Returns { ok: true, sessionId?, renditionId?, expiresAtMs? } or
 * { ok: false, reason } where reason is expired|scope-mismatch|invalid.
 */
export const verifyMediaGrant = (token, { expectSessionId = null, expectRenditionId = null } = {}) => {
  const secret = getMediaGrantSecret();
  if (!token || typeof token !== 'string' || !secret) return { ok: false, reason: 'invalid' };
  let decoded;
  try {
    decoded = jwt.verify(token, secret);
  } catch (error) {
    if (error?.name === 'TokenExpiredError') return { ok: false, reason: 'expired' };
    return { ok: false, reason: 'invalid' };
  }
  if (!decoded || decoded.pur !== MEDIA_GRANT_PURPOSE || decoded.aud !== MEDIA_GRANT_AUDIENCE) {
    return { ok: false, reason: 'invalid' };
  }
  const sid = decoded.sid ? normId(decoded.sid) : '';
  const rid = decoded.rid ? normId(decoded.rid) : '';
  if ((sid && rid) || (!sid && !rid)) return { ok: false, reason: 'invalid' };
  if (expectSessionId && sid !== normId(expectSessionId)) return { ok: false, reason: 'scope-mismatch' };
  if (expectRenditionId && rid !== normId(expectRenditionId)) return { ok: false, reason: 'scope-mismatch' };
  // A session grant must never open a rendition URL and vice versa: without an
  // expectation the caller must still pick the right field, so require the
  // peer expectation to be absent rather than silently accepting either.
  if (!expectSessionId && !expectRenditionId) {
    return { ok: false, reason: 'invalid' };
  }
  const expMs = Number(decoded.exp) * 1000;
  return {
    ok: true,
    ...(sid ? { sessionId: sid } : { renditionId: rid }),
    ...(Number.isFinite(expMs) ? { expiresAtMs: expMs } : {}),
  };
};

/**
 * Append ?media_grant=<token> to internal asset URIs in an HLS playlist text.
 * Only relative asset references are rewritten; absolute URLs (upstream) and
 * lines that already carry the param are left untouched. The file on disk is
 * never modified — callers rewrite the in-memory response body only.
 */
export const rewriteManifestWithGrant = (text, grantToken, { param = MEDIA_GRANT_QUERY } = {}) => {
  if (!grantToken) return String(text || '');
  const suffix = `${param}=${encodeURIComponent(grantToken)}`;
  const escaped = String(param).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const paramRe = new RegExp(`(?:^|&)${escaped}=`);
  const hasGrant = (uri) => paramRe.test(String(uri || '').split('?').slice(1).join('?'));
  const withGrant = (uri) => {
    const u = String(uri || '');
    if (!u || /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(u) || u.startsWith('/')) return uri;
    if (hasGrant(u)) return uri;
    return u.includes('?') ? `${u}&${suffix}` : `${u}?${suffix}`;
  };
  return String(text || '')
    .split('\n')
    .map((line) => {
      if (line.includes('URI=')) {
        return line.replace(/URI="([^"]+)"/g, (m, uri) => `URI="${withGrant(uri)}"`);
      }
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      // Bare m3u8 lines are always media URIs by spec (segments, init maps,
      // subtitles, nested playlists) — never metadata. Our playlists today
      // hold init.mp4 + seg_*.m4s, but granting every relative bare URI keeps
      // future asset kinds (WebVTT, .ts, Rendition-Report targets) working on
      // native instead of 401ing them.
      const rewritten = withGrant(trimmed);
      return rewritten === trimmed ? line : rewritten;
    })
    .join('\n');
};

/** Redact grant (and legacy access_token) values before anything reaches logs. */
export const redactMediaGrant = (text) =>
  String(text || '')
    .replace(/(media_grant=)[^&\s"']+/gi, '$1[đã-ẩn]')
    .replace(/(access_token=)[^&\s"']+/gi, '$1[đã-ẩn]');

/** Constant-time-ish scope comparison for ids already normalized to 32-hex. */
export const sameScopeId = (a, b) => {
  const x = normId(a);
  const y = normId(b);
  if (!x || !y || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
};

export const mediaGrantFingerprint = (token) =>
  crypto.createHash('sha256').update(String(token || '')).digest('hex').slice(0, 12);
