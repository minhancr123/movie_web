// Scoped media grants for native HLS (Đợt 1, local, không cần DB/production).
// Repro: Safari native fetches init.mp4 / seg_*.m4s itself with no header and
// relative playlist URLs do not inherit the parent's query — child assets must
// carry a short-lived ?media_grant= scoped to the exact session/rendition,
// never the long-lived login JWT.
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-login-jwt-secret-0123456789abcdef';
process.env.MEDIA_GRANT_SECRET = 'test-media-grant-secret-fedcba9876543210';

const grant = await import('../services/playback/mediaGrant.js');
const auth = await import('../middleware/auth.js');

const failures = [];
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error.message}`);
  }
};

const SID_A = 'a'.repeat(32);
const SID_B = 'b'.repeat(32);
const RID = 'c'.repeat(32);

check('query-param-name', () => {
  assert.equal(grant.MEDIA_GRANT_QUERY, 'media_grant');
});

// --- mint / verify round-trip -------------------------------------------
let sessionToken;
check('session-grant-roundtrip', () => {
  const minted = grant.mintMediaGrant({ sessionId: SID_A });
  sessionToken = minted.token;
  assert.ok(sessionToken);
  assert.ok(minted.expiresAtMs > Date.now());
  const verified = grant.verifyMediaGrant(sessionToken, { expectSessionId: SID_A });
  assert.equal(verified.ok, true);
  assert.equal(verified.sessionId, SID_A);
});

check('session-grant-wrong-session-rejected', () => {
  const verified = grant.verifyMediaGrant(sessionToken, { expectSessionId: SID_B });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, 'scope-mismatch');
});

check('session-grant-on-rendition-url-rejected', () => {
  const verified = grant.verifyMediaGrant(sessionToken, { expectRenditionId: RID });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, 'scope-mismatch');
});

let renditionToken;
check('rendition-grant-roundtrip', () => {
  const minted = grant.mintMediaGrant({ renditionId: RID });
  renditionToken = minted.token;
  const verified = grant.verifyMediaGrant(renditionToken, { expectRenditionId: RID });
  assert.equal(verified.ok, true);
  assert.equal(verified.renditionId, RID);
});

check('rendition-grant-on-session-url-rejected', () => {
  const verified = grant.verifyMediaGrant(renditionToken, { expectSessionId: SID_A });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, 'scope-mismatch');
});

check('verify-without-expectation-refused', () => {
  // Without a URL-derived expectation there is nothing to pin the scope to.
  assert.equal(grant.verifyMediaGrant(sessionToken).ok, false);
});

// --- lifetime: per-session cap, never beyond min(session.expiresAt, +6h) ---
check('expiry-capped-by-session', () => {
  const now = Date.now();
  const minted = grant.mintMediaGrant({ sessionId: SID_A, sessionExpiresAtMs: now + 60_000 });
  assert.ok(minted.expiresAtMs <= now + 60_000);
  assert.ok(minted.expiresAtMs > now);
});

check('already-expired-session-refuses-mint', () => {
  assert.throws(
    () => grant.mintMediaGrant({ sessionId: SID_A, sessionExpiresAtMs: Date.now() - 1000 }),
    /already-expired/,
  );
});

check('sub-second-remainder-refuses-mint', () => {
  // Exact second boundary + 500ms: no whole second of life remains, and a
  // delta-based `expiresIn || 1` would have minted a full extra second past
  // the session. Fixed clocks keep this deterministic (wall-clock +500ms may
  // or may not cross a second boundary).
  const nowMs = 1_700_000_000_000;
  assert.throws(
    () => grant.mintMediaGrant({ sessionId: SID_A, sessionExpiresAtMs: nowMs + 500, nowMs }),
    /already-expired/,
  );
});

check('grant-exp-never-gains-a-second', () => {
  const nowMs = 1_700_000_000_700;
  const minted = grant.mintMediaGrant({ sessionId: SID_A, sessionExpiresAtMs: nowMs + 500, nowMs });
  assert.equal(jwt.decode(minted.token).exp, Math.floor((nowMs + 500) / 1000));
});

check('expired-token-reports-expired', () => {
  const stale = jwt.sign(
    { pur: grant.MEDIA_GRANT_PURPOSE, aud: grant.MEDIA_GRANT_AUDIENCE, sid: SID_A },
    process.env.MEDIA_GRANT_SECRET,
    { expiresIn: -10 },
  );
  const verified = grant.verifyMediaGrant(stale, { expectSessionId: SID_A });
  assert.equal(verified.ok, false);
  assert.equal(verified.reason, 'expired');
});

// --- scope discipline -----------------------------------------------------
check('dual-scope-mint-refused', () => {
  assert.throws(() => grant.mintMediaGrant({ sessionId: SID_A, renditionId: RID }), /scope-invalid/);
});

check('missing-scope-mint-refused', () => {
  assert.throws(() => grant.mintMediaGrant({}), /scope-invalid/);
});

check('malformed-id-mint-refused', () => {
  assert.throws(() => grant.mintMediaGrant({ sessionId: 'not-hex' }), /scope-invalid/);
});

check('wrong-purpose-rejected', () => {
  const other = jwt.sign({ hello: 'world' }, process.env.MEDIA_GRANT_SECRET, { expiresIn: 600 });
  assert.equal(grant.verifyMediaGrant(other, { expectSessionId: SID_A }).reason, 'invalid');
});

check('wrong-secret-rejected', () => {
  const forged = jwt.sign(
    { pur: grant.MEDIA_GRANT_PURPOSE, aud: grant.MEDIA_GRANT_AUDIENCE, sid: SID_A },
    'some-other-secret',
    { expiresIn: 600 },
  );
  assert.equal(grant.verifyMediaGrant(forged, { expectSessionId: SID_A }).reason, 'invalid');
});

// --- manifest rewrite: in-memory response only, disk bytes untouched -------
const DISK_PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-TARGETDURATION:4',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXT-X-MAP:URI="init.mp4"',
  '#EXTINF:4.0,',
  'seg_00000.m4s',
  '#EXTINF:4.0,',
  'seg_00001.m4s',
  '',
].join('\n');

check('rewrite-adds-grant-to-init-and-segments', () => {
  const out = grant.rewriteManifestWithGrant(DISK_PLAYLIST, 'GRANT123');
  assert.ok(out.includes('URI="init.mp4?media_grant=GRANT123"'));
  assert.ok(out.includes('seg_00000.m4s?media_grant=GRANT123'));
  assert.ok(out.includes('seg_00001.m4s?media_grant=GRANT123'));
  // Disk source is pure: the rewrite never mutates its input.
  assert.ok(!DISK_PLAYLIST.includes('media_grant'));
});

check('rewrite-leaves-absolute-urls-alone', () => {
  const text = '#EXT-X-MAP:URI="https://cdn.example/x/init.mp4"\nseg_00000.m4s\n';
  const out = grant.rewriteManifestWithGrant(text, 'G');
  assert.ok(out.includes('URI="https://cdn.example/x/init.mp4"'));
  assert.ok(out.includes('seg_00000.m4s?media_grant=G'));
});

check('rewrite-grants-any-relative-bare-uri', () => {
  // Future asset kinds (WebVTT subtitles, .ts fallbacks, nested playlists)
  // must not 401 on native just because their filename is unfamiliar.
  const text = '#EXTM3U\nseg_00000.m4s\nsubs_vi.m3u8\nchunk0.vtt\n';
  const out = grant.rewriteManifestWithGrant(text, 'G');
  assert.ok(out.includes('seg_00000.m4s?media_grant=G'));
  assert.ok(out.includes('subs_vi.m3u8?media_grant=G'));
  assert.ok(out.includes('chunk0.vtt?media_grant=G'));
});

check('rewrite-matches-param-boundary', () => {
  const text = 'seg_00000.m4s?foo=media_grant%3Dbar\n';
  const out = grant.rewriteManifestWithGrant(text, 'G');
  assert.ok(out.includes('media_grant=G'));
});

check('rewrite-does-not-double-append', () => {
  const once = grant.rewriteManifestWithGrant(DISK_PLAYLIST, 'G');
  const twice = grant.rewriteManifestWithGrant(once, 'G2');
  assert.equal(twice.match(/media_grant=/g).length, once.match(/media_grant=/g).length);
});

check('grant-redacted-from-logs', () => {
  const redacted = grant.redactMediaGrant('GET /hls/abc/index.m3u8?media_grant=SECRET123 x');
  assert.ok(!redacted.includes('SECRET123'));
  assert.ok(redacted.includes('media_grant=[đã-ẩn]'));
});

// --- middleware: grants never open account APIs ---------------------------
const fakeRes = () => {
  const res = { _code: null, _body: null };
  res.status = (code) => {
    res._code = code;
    return { json: (obj) => { res._body = obj; } };
  };
  return res;
};

check('account-api-rejects-media-grant', () => {
  let nexted = false;
  const res = fakeRes();
  auth.authMiddleware(
    { headers: { authorization: `Bearer ${sessionToken}` } },
    res,
    () => { nexted = true; },
  );
  assert.equal(nexted, false);
  assert.equal(res._code, 401);
});

check('account-api-accepts-login-jwt', () => {
  const login = jwt.sign({ userId: 'u1', role: 'user' }, process.env.JWT_SECRET, { expiresIn: 600 });
  let nexted = false;
  const req = { headers: { authorization: `Bearer ${login}` } };
  auth.authMiddleware(req, fakeRes(), () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.user.userId, 'u1');
});

check('media-guard-accepts-matching-grant-get', () => {
  let nexted = false;
  const req = {
    method: 'GET',
    params: { sessionId: SID_A },
    query: { [grant.MEDIA_GRANT_QUERY]: sessionToken },
    headers: {},
  };
  auth.mediaAuthMiddleware(req, fakeRes(), () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.mediaGrant.sessionId, SID_A);
});

check('media-guard-rejects-cross-session-grant', () => {
  let nexted = false;
  const res = fakeRes();
  auth.mediaAuthMiddleware(
    {
      method: 'GET',
      params: { sessionId: SID_B },
      query: { [grant.MEDIA_GRANT_QUERY]: sessionToken },
      headers: {},
    },
    res,
    () => { nexted = true; },
  );
  assert.equal(nexted, false);
  assert.equal(res._code, 403);
});

check('media-guard-rejects-grant-on-write', () => {
  let nexted = false;
  const res = fakeRes();
  auth.mediaAuthMiddleware(
    {
      method: 'POST',
      params: { sessionId: SID_A },
      query: { [grant.MEDIA_GRANT_QUERY]: sessionToken },
      headers: {},
    },
    res,
    () => { nexted = true; },
  );
  assert.equal(nexted, false);
  assert.equal(res._code, 401);
});

check('media-guard-rejects-grant-replayed-as-access-token', () => {
  let nexted = false;
  const res = fakeRes();
  auth.mediaAuthMiddleware(
    { method: 'GET', params: { sessionId: SID_A }, query: { access_token: sessionToken }, headers: {} },
    res,
    () => { nexted = true; },
  );
  assert.equal(nexted, false);
  assert.equal(res._code, 401);
});

check('media-guard-keeps-login-jwt-path', () => {
  const login = jwt.sign({ userId: 'u9', role: 'user' }, process.env.JWT_SECRET, { expiresIn: 600 });
  let nexted = false;
  const req = {
    method: 'GET',
    params: { sessionId: SID_A },
    query: { access_token: login },
    headers: {},
  };
  auth.mediaAuthMiddleware(req, fakeRes(), () => { nexted = true; });
  assert.equal(nexted, true);
  assert.equal(req.user.userId, 'u9');
});

if (failures.length) {
  console.error(`FAIL checks=${[...new Set(failures)].join(',')}`);
  process.exit(1);
}

console.log('PASS media-grant checks');
