# Cineon Media and CDN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CDN cho web hoạt động mà không đưa video được bảo vệ vào public cache hoặc phá playback hiện có.

**Architecture:** Control API giữ cùng origin cineon.me; URL bytes do backend tạo chuyển sang media.cineon.me DNS-only. Caddy phân luồng, chuẩn hóa client IP và chặn endpoints nội bộ; Cloudflare chỉ cache public assets đã xác định.

**Tech Stack:** Express, Next.js/hls.js, Caddy, Cloudflare DNS/Cache Rules, node:test, Python unittest.

**Spec:** [Thiết kế đã duyệt](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/specs/2026-09-24-cineon-production-devops-design.md).

## Global Constraints

- “Bypass cache vẫn đi qua Cloudflare proxy.” Video bytes đi direct hoặc DNS-only, không coi cache bypass là tránh proxy.
- `PUBLIC_MEDIA_BASE_URL=https://media.cineon.me`; production HTTPS; không lấy host từ request.
- Giữ auth/ownership hiện hữu, không đổi JWT sang cookie chung domain; không bỏ token khỏi cache key để chia sẻ nội dung có bảo vệ.
- `VIDEO_TRANSCODE_FALLBACK=never`, `REMUX_MAX_WRITERS=1`; quốc tế 10 Mbps vẫn là giới hạn origin.
- Đọc hợp đồng [master](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/plans/2026-09-24-cineon-devops-implementation.md); D3 deploy/rollback sẵn có trước khi đổi hostname production.

## Review Focus

1. URL absolute, encoded traversal hoặc token bị ghép vào sai origin — C1 dùng origin cấu hình và allowlist route.
2. Native Safari và subtitle capability khác header-auth của hls.js — C1 giữ cơ chế tương ứng, kiểm từng đường.
3. `X-Forwarded-For` tự khai báo hoặc Docker NAT peer khác localhost — C2 kiểm trust chain trên network thật.
4. Route `/api/auth` gửi nhầm Express thay vì NextAuth — C2 test exact routes/trailing slash.
5. Zone có rule trước đó hoặc cache HIT mang nội dung user — C3 diff có precondition, không replace toàn zone.

## File Structure

`backend-node/services/playback/publicMediaUrl.js` sở hữu URL bytes; `config/trustedProxy.js` sở hữu trust chain. Caddy templates và `deploy/cloudflare/` là nguồn cấu hình; tests riêng cho logic URL, routing và policy. Source spans bên dưới là mốc khảo sát, phải refresh khi file đã đổi bởi task trước.

### Task C1: Public media URL và auth-preserving playback

**Files:** Create `backend-node/services/playback/publicMediaUrl.js`, `backend-node/tests/production-media-url.test.mjs`, `production-media-auth.test.mjs`; modify `backend-node/controllers/playbackController.js` tại `resolvePlayback:974-1966`, `getPlaybackSubtitles:2400-2774`, `runSubtitleExtractionJob:2777-2831`, `getPlaybackSession:2874-3063`, `serveHlsAsset:3079-3193`, `serveRenditionAsset:3208-3238`; modify `backend-node/routes/playback.js:24-37`, `frontend/src/lib/api.ts`, `frontend/src/components/VideoPlayer.tsx` chỉ nơi đang đổi absolute URL/auth headers. Giữ các thay đổi seek/remux của người dùng.

**Interfaces:** `publicMediaUrl(path:string,{origin?:string,query?:Record<string,string>}={}) -> string`; chỉ nhận pathname do ứng dụng tạo. Direct provider URL không đi qua helper. `isMediaPath(pathname:string)->boolean` allowlist đúng ba route bytes trong spec.

- [ ] **1. Test đỏ:**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {publicMediaUrl} from '../services/playback/publicMediaUrl.js';
test('media URL has configured origin and encoded token', () => {
  const u = new URL(publicMediaUrl('/api/playback/hls/session_1/index.m3u8',
    {origin:'https://media.cineon.me',query:{access_token:'fixture+token'}}));
  assert.equal(u.origin,'https://media.cineon.me');
  assert.equal(u.searchParams.get('access_token'),'fixture+token');
});
test('control API is not moved', () => {
  assert.throws(()=>publicMediaUrl('/api/playback/resolve',{origin:'https://media.cineon.me'}));
});
```

Thêm path traversal, origin có userinfo/query, Host header attacker không đổi URL, relative segment playlist sau rewrite, subtitle VTT capability.
- [ ] **2. Run** `node --test backend-node/tests/production-media-url.test.mjs backend-node/tests/production-media-auth.test.mjs`; expected đỏ trước helper/integration.
- [ ] **3. Implement allowlist core**:

```js
export function isMediaPath(path) {
  if (path.split('/').some(x=>x==='.' || x==='..')) return false;
  return /^\/api\/playback\/(?:hls\/(?:r\/)?[\w-]+\/[\w.-]+|subtitles\/vtt\/[\w-]+)$/.test(path);
}
export function publicMediaUrl(path,{origin='',query={}}={}) {
  if (!isMediaPath(path)) throw new Error('invalid media path');
  const base = new URL(origin || 'http://localhost');
  if (origin && (base.protocol!=='https:' || base.username || base.password || base.pathname!=='/' || base.search || base.hash))
    throw new Error('invalid media origin');
  const u = new URL(path,base);
  for (const [k,v] of Object.entries(query)) u.searchParams.set(k,v);
  return origin ? u.href : u.pathname+u.search;
}
```

Graft grep tất cả URL `/api/playback/hls/` và `/subtitles/vtt/`, sửa producer sites, không replace mọi `/api/playback/*`. Playlist segments tương đối phải resolve trên media host; absolute segment/subtitle URI phải qua helper. Frontend giữ URL absolute, hls.js header token đúng hostname; native video dùng cơ chế query token hiện hữu. `Cache-Control: private, no-store` cho bytes được bảo vệ; `Referrer-Policy:no-referrer`; bỏ chú thích CDN ignore-query sai trong route.

Phạm vi A09: session HLS của user A không được user B truy cập; published rendition dùng chung vẫn cho user B hợp lệ theo policy hiện hữu, anonymous/expired token bị chặn; VTT capability hợp lệ vẫn là bearer capability, không ép ownership mới. Kiểm expiry/asset traversal cho từng kiểu, không làm test sai mong đợi quyền hiện có.
- [ ] **4. Verify** fixture playlist init/segment/Range, seek, audio, subtitles, source direct, native Safari thực và hls.js. Safari chưa có thiết bị thì ghi chưa kiểm chứng, không thay bằng Chromium rồi đánh dấu xong. Backend media suite và frontend playback tests phải giữ kết quả.
- [ ] **5. Commit** `feat: separate public media origin without changing playback authorization`.

### Task C2: Proxy trust, rate limits và Caddy routing

**Files:** Create `backend-node/config/trustedProxy.js`, `backend-node/tests/production-proxy.test.mjs`, `deploy/tests/test_caddy_routes.py`, `deploy/caddy/render-trust.py`; modify `backend-node/services/playback/clientNetwork.js:78-116`, `backend-node/server.js`, `backend-node/middleware/rateLimit.js`, `backend-node/config/cors.js`, `deploy/Caddyfile`.

**Interfaces:** `configureTrustedProxy(app,cidrs:string[])` dùng Express trust function dựa trên CIDR validator; `clientAddress(req)` lấy `req.ip` đã được Express chuẩn hóa, không tự tin entry trái đầu XFF. `render_trust(cidrs:list[str])->str` validate public CIDRs từ nguồn Cloudflare chính thức; output static Caddy trusted-proxy fragment.

- [ ] **1. Test đỏ** Express server thật với request XFF/CF-Connecting-IP giả từ untrusted peer, IPv4-mapped IPv6 và chuỗi proxy nhiều hop. Assert attacker không tự chọn IP/private LAN để né rate limit. Test routing với hai mock upstream và cả exact `/socket.io`, trailing slash, NextAuth callback, backend `/api/auth/login`, `/metrics`, diagnostic, media host với admin path.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {clientAddress} from '../services/playback/clientNetwork.js';
import {configureTrustedProxy} from '../config/trustedProxy.js';
test('network helper uses the verified Express IP, not raw forwarding data',()=>{
  assert.equal(clientAddress({ip:'198.51.100.10',socket:{remoteAddress:'172.18.0.1'},
    headers:{'x-forwarded-for':'127.0.0.1'}}),'198.51.100.10');
});
test('trust-all networks are rejected',()=>{
  assert.throws(()=>configureTrustedProxy({set(){}},['0.0.0.0/0']));
});
```
- [ ] **2. Run** `node --test backend-node/tests/production-proxy.test.mjs` và `python -m unittest discover -s deploy/tests -p test_caddy_routes.py -v`.
- [ ] **3. Implement trust/routing.** Thêm dependency `proxy-addr` trực tiếp và pin lockfile; compile allowlist CIDR cụ thể từ config, reject `0.0.0.0/0`, `::/0`, chuỗi `true`. Provision ghi IP/subnet peer thực của Caddy qua Docker publish, không giả định backend luôn thấy 127.0.0.1. Backend đọc IP đã chuẩn hóa, giữ explicit test override trong unit tests nếu cần.

```js
import proxyaddr from 'proxy-addr';
export function configureTrustedProxy(app,cidrs) {
  if (!Array.isArray(cidrs) || cidrs.some(x=>['0.0.0.0/0','::/0','true'].includes(x)))
    throw new Error('invalid proxy allowlist');
  app.set('trust proxy',cidrs.length ? proxyaddr.compile(cidrs) : false);
}
```

Host Caddy normalize upstream XFF to the resolved client address; web trust only Cloudflare source ranges with strict traversal, media direct connection ignores client-supplied CF header. Web origin source gate ở host block, không firewall toàn IP vì media trực tiếp. Renewal ACME must pass before source gate enabled. Update CF range file atomically after validate; failed fetch keeps old file and raises alert.

Caddy giữ regex backend auth allowlist trong kit trước NextAuth catch-all, `/api/health` frontend trước `/api/*` backend, `/ready` backend no-store, `/metrics`/diagnostic 404 public. Media host chỉ allow ba routes C1 và OPTIONS tương ứng; CORS chỉ `https://cineon.me`, expose Range response headers, không wildcard+credentials; mọi path khác 404. Không gzip/compress thêm video bytes. Stream flush và WebSocket upgrade phải được test; không dùng `handle_path` làm mất prefix.

Login/register/search/resolve/poll/segments dùng bucket riêng theo client identity; response 429 có Retry-After. Test hai user khác nhau không cùng hạn mức sai vì proxy; segment burst bình thường không ăn hạn mức login. URL outbound đã chạm phải validate HTTPS/scheme, DNS addresses và redirects chống private/link-local SSRF; nếu provider có ngoại lệ nội bộ thì phải cấu hình riêng, không dùng input request mở tùy ý.

C1 chỉ thay URL đầu ra, không thêm arbitrary URL fetch. Bổ sung fixture HTTP listener trên private address: request media kèm `?url=http://127.0.0.1/...` không được làm listener nhận request; Caddy media host chặn các route proxy/control không allowlisted. Nếu việc tích hợp đòi sửa một outbound fetch hiện hữu thì bổ sung test redirect/DNS-rebinding tại chính adapter đó trước sửa, không mặc định mọi fetch trong repo đã được audit.
- [ ] **4. Validate Caddy thật**, chạy route matrix fixture rồi Linux network real-Caddy/container để xác minh Docker NAT peer; test spoof direct-media và web qua CDN ở C3. Kiểm certificate renew và socket.io polling + WebSocket.
- [ ] **5. Commit** `fix: enforce proxy trust and isolate web media routes`.

### Task C3: Cloudflare DNS/cache rules, diff và activation

**Files:** Create `deploy/cloudflare/policy.py`, `manage.py`, `README.md`, `deploy/tests/test_cloudflare_policy.py`, `deploy/tests/test_cloudflare_diff.py`; add DNS/TLS/cache smoke checks to `deploy/smoke.sh`.

**Interfaces:** `cache_class(host,path,has_auth,has_cookie)->'public_static'|'bypass'`; `plan_changes(current,desired)->list[dict]` có before/after/record-id; `apply_changes(changes,expected_before_hash,client)` kiểm precondition và chỉ sửa records/rules do Cineon quản lý. CLI mặc định export/plan; apply nhận file plan đã review; token chỉ đọc từ secret file/env, không argv/log.

- [ ] **1. Test đỏ policy**:

```python
import unittest
from deploy.cloudflare.policy import cache_class
class CacheTest(unittest.TestCase):
    def test_private_routes_never_public(self):
        for p in ['/api/auth/session','/api/playback/hls/r/a/0.m4s','/admin','/','/_next/image']:
            self.assertEqual(cache_class('cineon.me',p,False,False),'bypass')
    def test_auth_static_bypasses(self):
        self.assertEqual(cache_class('cineon.me','/_next/static/a.js',True,False),'bypass')
```

- [ ] **2. Run** `python -m unittest discover -s deploy/tests -p 'test_cloudflare*.py' -v`.
- [ ] **3. Implement conservative policy**:

```python
def cache_class(host,path,has_auth,has_cookie):
    if host != 'cineon.me' or has_auth or has_cookie:
        return 'bypass'
    return 'public_static' if path.startswith('/_next/static/') else 'bypass'
```

Cloudflare API adapter maps policy to Cache Rules theo schema chính thức tại thời điểm chạy; public static chỉ GET/HEAD, tôn trọng origin TTL và response Set-Cookie, không cache HTML/RSC/API/admin/media. Các static folder khác chỉ thêm khi có test versioned filename; không tự bật Cache Everything. Query string được giữ, không ignore token. Browser SW vẫn disabled theo baseline F1; cleanup cache/service worker cũ chỉ của app, không xóa cache người dùng không liên quan.

Desired DNS: root/www proxied cho web; media DNS-only về đúng VPS; AAAA chỉ tạo khi IPv6 đã kiểm chứng. TLS Full (strict). Export current records, SSL và rules trước apply; giữ MX/TXT/email và các rule không do Cineon quản lý. Abort nếu zone/account/record đã đổi từ lúc lập plan. Nếu account không hỗ trợ rule cần thiết, giữ trạng thái chưa kích hoạt và cung cấp diff/manual procedure, không tự chọn plan trả phí. Rule ordering được kiểm với existing rules bằng actual HTTP response, không chỉ test classifier Python.
- [ ] **4. Activate sau input thật và preflight:** chứng chỉ origin + media hợp lệ, DNS resolve đúng, static warm có `CF-Cache-Status:HIT`, private responses không HIT cả khi lặp request/two users, video bytes không qua web proxy. CF response metadata chỉ là một phần; kiểm authority/route và quyền thật. Thử rollback đúng records/rules trước đó trên staging zone, không xóa toàn zone.
- [ ] **5. Commit** `ops: manage verified Cloudflare web-only CDN policy`; lưu evidence đã lọc và giữ production activation checkbox riêng nếu chưa có zone/token.
