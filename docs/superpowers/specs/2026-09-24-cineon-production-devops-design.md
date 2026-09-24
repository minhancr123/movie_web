# Cineon — thiết kế hoàn thiện production và DevOps

Ngày: 24/09/2026 · Phiên bản thiết kế: 1

Repo khảo sát: `C:\Users\ADMIN\Downloads\movie_web`. Các đường dẫn mã nguồn bên dưới tính từ thư mục này.

**Trạng thái: phạm vi repo + tài liệu đã được chọn; thiết kế này chờ người dùng duyệt.**
Đây là đặc tả của hệ thống sẽ triển khai, không phải báo cáo rằng VPS, CDN hay các dịch vụ cloud đã hoạt động.

## 1. Mục tiêu và tiêu chí thành công

Hoàn thiện cả mã nguồn/cấu hình trong repo và bộ hướng dẫn A–Z cho `cineon.me`, chạy trên Ubuntu 24.04 LTS, 1 vCPU, RAM 4 GB, NVMe 30 GB. Kết nối dịch vụ được cung cấp là 300 Mbps, đường quốc tế 10 Mbps; cổng vật lý 10 Gbps không phải băng thông được cấp cho ứng dụng.

Người dùng cần phục vụ trên 10 người xem. Thiết kế dùng bài kiểm tra 20 người dùng web đồng thời làm mốc ban đầu, đo riêng số luồng video và bitrate. Con số này là tải kiểm chứng, không phải cam kết sức chứa trước khi đo.

Thành công nghĩa là: dựng lại được máy chủ; triển khai đúng release đã kiểm thử; phát hiện lỗi; quay về release trước; phục hồi dữ liệu từ bản ngoài VPS; phân biệt rõ kết quả kiểm thử local, staging và production. Cài đủ tên công cụ chưa đáp ứng tiêu chí này.

Mục tiêu vận hành ban đầu, cần đo thực tế:

- Phát hiện website ngừng đáp ứng trong khoảng 5 phút bằng probe ngoài VPS.
- RPO dữ liệu tối đa 24 giờ; RTO mục tiêu tối đa 2 giờ khi đã có VPS thay thế, quyền truy cập và khóa giải mã. Thời gian mua/cấp máy mới phải được ghi riêng.
- Chấp nhận một khoảng gián đoạn ngắn khi đổi release hoặc backup nhất quán. Một VPS chưa có HA hoặc bảo đảm zero-downtime.
- Chưa bổ sung Kubernetes, service mesh, Sentry tự host hoặc toàn bộ Prometheus/Grafana/Loki trên VPS.

## 2. Phạm vi đã thống nhất và cách tiếp cận

Người dùng đã chọn hoàn thiện **repo + tài liệu**, gồm tối ưu production, triển khai tái lập, CI/CD, rollback, CDN, Sentry, metrics, uptime, backup và nghiệm thu.

| Cách tiếp cận | Đánh đổi | Quyết định đề xuất |
| --- | --- | --- |
| Một VPS + dịch vụ quan sát bên ngoài + backup ngoài VPS | Nhẹ cho VPS, cần tài khoản cloud và quản lý quota; máy ứng dụng vẫn là điểm lỗi duy nhất | Chọn cho cấu hình hiện tại |
| Tự host mọi công cụ trên cùng VPS | Giảm phụ thuộc SaaS nhưng cạnh tranh RAM/CPU; máy chết thì monitoring cũng chết | Không chọn |
| Nhiều VPS, load balancer và datastore dự phòng | Tăng khả năng chịu lỗi nhưng tăng chi phí và độ phức tạp state/video | Giai đoạn nâng cấp khi có yêu cầu HA |

Các dịch vụ bên ngoài được nối qua biến cấu hình; quota, nơi lưu dữ liệu và ngân sách được xác nhận khi kích hoạt tài khoản. Thiết kế không giả định gói miễn phí đáp ứng vô hạn hoặc đã bao gồm snapshot/PITR database.

## 3. Hiện trạng đã kiểm tra trong repo

Mốc khảo sát: nhánh `feat/torbox-playback-cinema`, HEAD `2236e51`, có nhiều thay đổi chưa commit do người dùng thực hiện. Các nhận xét bên dưới dựa vào working tree, không chỉ HEAD. Giai đoạn này chỉ thêm đặc tả; giữ nguyên các thay đổi đó.

| Bằng chứng | Ý nghĩa đối với thiết kế |
| --- | --- |
| `.github/workflows/deploy.yml:18` gọi reusable CI | Đã có nền tảng test gate, cần nâng cấp chứ không viết đè mù quáng |
| `.github/workflows/deploy.yml:89,94-101,127-129` | Deploy reset checkout và dùng `latest`; rollback chỉ backend, chưa đồng bộ release |
| `docker-compose.prod.yml:12,28,53-62,83` | Redis `allkeys-lru`; port publish toàn interface; cache mặc định 60 GB; proxy flag cần thống nhất |
| `backend-node/server.js:238-266` | Startup gọi tạo admin mặc định và khởi tạo playback cache |
| `backend-node/controllers/authController.js:393-420` | Có bootstrap tài khoản cố định; phải bỏ mật khẩu seed khỏi luồng startup production |
| `backend-node/config/database.js:11-25` | Database ứng dụng chọn tên `movieweb`; cần biến tên DB để diễn tập restore riêng |
| `backend-node/config/redis.js:40-67` | Cache best-effort đã có; phải giữ hành vi suy giảm có kiểm soát khi Redis lỗi |
| `backend-node/routes/playback.js:24-37` | Media dùng auth riêng/query token và subtitle capability; có chú thích CDN bỏ query cần sửa |
| `frontend/package.json` | Next.js 14.1.0; bộ test chính chưa bao gồm mọi test có script riêng |
| `.github/workflows/ci.yml` | Node 20; media test cần FFmpeg; có chạy test lặp để tìm skip |
| `docs/cineon-deployment/kit/` | Có bộ mẫu tốt hơn ở vài điểm nhưng chưa đồng bộ vào cấu hình production chính |

Nguồn chuẩn sau triển khai sẽ là cấu hình/script trong repo. Bộ kit trong tài liệu phải được sinh hoặc sao chép có kiểm chứng từ nguồn chuẩn, tránh hai phiên bản khác nhau.

## 4. Kiến trúc đích và ranh giới dữ liệu

```text
Trình duyệt ── HTTPS ── Cloudflare (web/assets) ── Caddy trên host
                                                   ├─ Next.js :3000 (localhost)
                                                   └─ Express :5001 (localhost)
                                                        ├─ MongoDB ngoài VPS
                                                        └─ Redis nội bộ Docker
                                                             ├─ Worker
                                                             └─ Scheduler

Trình duyệt ── video trực tiếp ── nguồn/provider đã được ứng dụng hỗ trợ
Trình duyệt ── media.cineon.me (DNS-only) ── Caddy ── media của backend

CI ── image digest + release bundle ── registry/VPS
Ứng dụng ── lỗi đã lọc ── Sentry Cloud
Alloy ── metrics/log đã chọn ── Grafana Cloud
Probe bên ngoài ── HTTPS + readiness ── cảnh báo email
Backup nhất quán ── restic mã hóa ── object storage ngoài VPS
```

MongoDB tiếp tục ở ngoài VPS. Redis không có port public. API/frontend chỉ bind `127.0.0.1`; Caddy là đầu vào web công khai. Worker và scheduler dùng đúng image backend của release.

Build frontend/backend ở CI, không build trên VPS đang phục vụ. Host Caddy giúp giữ trang bảo trì và TLS khi container ứng dụng đổi release.

### Phân bổ RAM/disk khởi đầu

| Thành phần | Giới hạn RAM dự kiến |
| --- | ---: |
| Backend + tiến trình FFmpeg con | 1280 MiB |
| Frontend | 768 MiB |
| Redis | 512 MiB; `maxmemory` ban đầu 256 MiB |
| Worker | 256 MiB |
| Scheduler | 192 MiB |
| Alloy | Ngân sách 256 MiB, cần đo và điều chỉnh thu thập |
| Tổng các ngân sách trên | 3264 MiB |

Phần RAM còn lại dành cho OS, Caddy, Docker và tác vụ quản trị. Giới hạn là điểm xuất phát, không phải số RAM đã đo. Backup chạy ngoài giờ tải cao với mức song song thấp, tránh chạy cùng rollout. Nếu tổng tải không có khoảng dự phòng thì giảm thu thập/job hoặc nâng VPS trước khi public.

Cache playback cấu hình ban đầu 3 GB mỗi nhóm cache hiện có, dự trù tối đa 6 GB và kiểm tra hai nhóm có dùng chung dữ liệu hay không. Giữ tối thiểu 6 GB disk trống. Deploy phải tính thêm image mới và image rollback trước khi pull. Không dọn volume dữ liệu hoặc file của session đang phát để lấy chỗ.

`VIDEO_TRANSCODE_FALLBACK=never`, `REMUX_MAX_WRITERS=1` ban đầu. Một writer mới vẫn cần benchmark; không suy ra rằng mọi người dùng đều được remux phim khác nhau đồng thời. Build, backup, quét image và nén log tránh tranh CPU với playback.

## 5. Nền tảng Ubuntu và cấu hình tái lập

Repo sẽ có bộ provision idempotent cho Ubuntu 24.04: kiểm tra điều kiện trước, tạo user triển khai, cài Docker/Compose/Caddy từ nguồn chính thức, thư mục release, timer backup và cấu hình giám sát. Lần chạy thứ hai phải giữ dữ liệu, secrets và ứng dụng khác trên máy.

- SSH key; xác minh đăng nhập bằng phiên thứ hai trước khi thay đổi truy cập SSH. Giữ đường console của nhà cung cấp cho phục hồi.
- Chỉ mở cổng web và cổng SSH đã xác định; kiểm tra cả firewall nhà cung cấp và host. Docker bind localhost là lớp bảo vệ trực tiếp cho ứng dụng.
- Tách secrets khỏi repo/release bundle; file runtime quyền tối thiểu. Log và output kiểm tra config không in giá trị secrets.
- Quyền Docker tương đương quyền cao trên host; dùng tài khoản deploy chuyên biệt, SSH key riêng, fingerprint host được kiểm chứng, không tắt kiểm tra host key.
- Container chạy non-root ở nơi đã kiểm thử quyền volume. Dùng giới hạn process, memory, log rotation; chỉ thêm read-only filesystem khi biết các thư mục cần ghi.
- Cập nhật bảo mật có lịch; reboot có cửa sổ bảo trì. Không tự nâng major runtime/Redis rồi coi là routine patch.
- Giữ volume Redis/transcodes hiện tại khi chuyển từ Compose cũ. Bước chuyển tên/project phải inventory và map volume trước, tránh khởi động với volume rỗng rồi tưởng mất dữ liệu.

## 6. Sửa production trong ứng dụng

### Runtime và dependency

Đích là Node 24 LTS và Next.js 16 stable đã vá, cùng React/thư viện tương thích; pin bằng lockfile và base image digest khi phát hành. Nâng theo từng bước có regression tests, không chỉ đổi số phiên bản. Tại thời điểm khảo sát Node 20 đã EOL, Next.js 14 nằm ngoài danh sách hỗ trợ. [Node.js](https://nodejs.org/en/about/previous-releases), [Next.js](https://nextjs.org/support-policy)

Giữ UI và hành vi playback hiện có; không làm lại giao diện. Kiểm tra thay đổi framework ảnh hưởng routing, cookies, middleware, PWA, images, NextAuth và standalone build. Các bài test đã có nhưng chưa nằm trong script mặc định phải được phân loại và đưa vào gate phù hợp.

### Auth, secrets và mạng

- Bỏ tự tạo admin với mật khẩu cố định khi server khởi động. Bootstrap là lệnh một lần, nhận secret riêng, kiểm tra trùng và không ghi đè tài khoản hiện có. Tài khoản seed cũ cần quy trình đổi mật khẩu/thu hồi session rõ ràng.
- Giữ `JWT_SECRET` và `NEXTAUTH_SECRET` riêng. `TOKEN_ENCRYPTION_KEYS` dùng version số nguyên dương; xoay khóa có giai đoạn đọc khóa cũ. Backup phải giữ được khóa cần giải mã dữ liệu.
- Thống nhất cách lấy client IP giữa Express và helper playback; chỉ tin proxy đã xác thực. Header giả từ kết nối trực tiếp phải bị bỏ qua.
- Rate limit theo nhóm: auth, search/resolve, polling, media. Không gộp hàng trăm segment video vào ngưỡng đăng nhập.
- Kiểm tra URL outbound trong các đường playback bị thay đổi: scheme, redirect và địa chỉ private/link-local phải được xử lý; tránh biến media host thành proxy URL tùy ý.
- Startup fail rõ ràng khi thiếu cấu hình bắt buộc; không đưa secret vào thông báo lỗi.

### Health và tắt tiến trình

- `/health`: liveness nhẹ, chứng minh process còn đáp ứng; tương thích với kiểm tra cũ.
- `/ready`: có timeout tổng, kiểm tra MongoDB và Redis bắt buộc; HTTP 503 khi dependency bắt buộc lỗi. Trả trạng thái tổng quát, không lộ URI hay lỗi nội bộ; kết quả ngắn hạn được gộp/cache để probe không gây tải.
- `/metrics`: chỉ scrape qua mạng nội bộ/localhost, bị chặn ở mọi public hostname. Nhãn dùng route template, status class và release; không chứa user ID, session ID, token hay URL phim.
- Worker/scheduler có heartbeat và một job kiểm thử không gây tác dụng phụ; container sống không đồng nghĩa queue đang xử lý.
- SIGTERM ngừng nhận công việc mới, drain trong thời gian hữu hạn, giải phóng child process và kết nối. Media đang phát có thể gián đoạn khi thay backend; thông báo bảo trì, không hứa zero-downtime.

Redis giữ một instance để phù hợp RAM, bật persistence AOF và `noeviction`; cache có TTL, queue có retention và cảnh báo bộ nhớ. Khi đầy, enqueue thất bại phải được báo chứ không trả thành công giả; cache ghi lỗi có thể bỏ qua theo hành vi hiện tại. BullMQ yêu cầu tránh eviction tùy ý của khóa queue. [BullMQ production](https://docs.bullmq.io/guide/going-to-production)

## 7. CDN, HTTPS và đường video

### Web

`cineon.me` và `www.cineon.me` qua Cloudflare sau khi chứng chỉ origin hợp lệ. Chọn Full (strict); redirect www về domain chính. Caddy phục vụ origin certificate hợp lệ và thử renewal. HSTS bật theo giai đoạn sau khi HTTPS ổn định, chưa preload.

Full (strict) xác thực chứng chỉ origin; dùng chứng chỉ CA công khai do Caddy quản lý cũng cho phép diễn tập đường trực tiếp khi cần. [Cloudflare Full (strict)](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/full-strict/)

Cache rõ ràng cho `/_next/static/*` và static public có tên version/hash. HTML/RSC, API, NextAuth, admin, WebSocket, phản hồi theo user, request có Authorization và response Set-Cookie không được đưa vào cache public. `/_next/image` giữ hành vi bảo thủ tới khi kiểm thử optimizer/cache key. Cache của service worker phải cùng ranh giới, không lưu session hoặc API cá nhân hóa. Cloudflare không mặc định cache HTML/JSON; tài nguyên third-party không tự đi qua CDN của domain này. [Cache mặc định](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/)

NextAuth `/api/auth/*` cần tới frontend, trừ các route backend auth hiện hữu được allowlist chính xác. `/api/*` còn lại và `/socket.io/*` tới backend. Không bỏ tiền tố `/api` khi proxy. Endpoint chẩn đoán nội bộ bị chặn công khai.

Caddy chỉ chấp nhận header client IP từ dải proxy Cloudflare tin cậy. Cập nhật dải IPv4/IPv6 bằng quy trình validate rồi đổi cấu hình; lỗi tải danh sách giữ cấu hình cũ và cảnh báo. Web hostname có kiểm soát nguồn truy cập origin ở lớp host/proxy, có ngoại lệ ACME phù hợp. [Caddy trusted proxies](https://caddyserver.com/docs/caddyfile/options#trusted-proxies)

### Video

Direct playback từ nguồn tương thích vẫn là ưu tiên. Media backend cần thiết đi qua `media.cineon.me` **DNS-only**, TLS trực tiếp bằng Caddy, không qua Cloudflare CDN thông thường. Đây là đường origin, không phải CDN video và không tăng băng thông quốc tế. Do cùng IP, media hostname làm lộ IP origin; không mô tả cấu hình này như đã giấu hoặc bảo vệ toàn bộ máy bằng Cloudflare.

Biến mới `PUBLIC_MEDIA_BASE_URL` là URL HTTPS đã validate. Backend chỉ tạo URL public từ cấu hình tin cậy; không lấy hostname tùy ý từ request. Resolver/control API vẫn cùng origin web. Chỉ các route bytes hiện có đi qua media host:

- `/api/playback/hls/:sessionId/:asset`;
- `/api/playback/hls/r/:renditionId/:asset`;
- `/api/playback/subtitles/vtt/:token`.

Mọi manifest và URL segment/subtitle tuyệt đối phải được kiểm tra sau khi tách host. Chặn mọi API/admin khác trên media host. CORS allowlist `https://cineon.me`, xử lý preflight và Range/Content-Range, hls.js và native Safari; không mở wildcard với credentials.

Giữ kiểm tra auth/ownership và cơ chế media token hiện có trong lần tách host; không chuyển JWT sang cookie dùng chung domain. Query token và capability subtitle không được ghi vào access log, Sentry, metrics hay Referrer. Mặc định media trả `private/no-store` ở ranh giới proxy để chặn chia sẻ cache trái quyền. Chú thích khuyên bỏ query token khỏi cache key phải được thay bằng hướng dẫn chính xác.

**Bypass cache vẫn đi qua Cloudflare proxy.** Bởi vậy chỉ đặt cache bypass cho `/api/playback/*` trên domain web không thay thế việc tách đường bytes. Không bỏ query token khỏi cache key để chia sẻ video được bảo vệ nếu edge chưa kiểm tra quyền trước mỗi lần trả cả cache HIT.

Một CDN video trả phí là phần mở rộng riêng cần chọn nhà cung cấp, cơ chế xác thực edge và ngân sách. Không biến CDN web thông thường thành dịch vụ truyền phim không giới hạn. [Cloudflare video](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/)

## 8. CI và chuỗi phát hành

CI chạy trên pull request và là điều kiện của production. Không gửi secrets production cho code PR chưa được tin cậy.

1. Cài dependency theo lockfile trên Node 24; lint/typecheck đúng framework mới; unit/integration tests backend/frontend.
2. FFmpeg và ffprobe thật phải có; media tests bị skip phải hiện thành gate chưa đạt. Thu kết quả một lượt thay vì chạy lại toàn bộ chỉ để grep.
3. Production build, kiểm tra Dockerfile/Compose/Caddy/shell, rà secrets và dependency/image vulnerabilities. Findings có mức xử lý và thời hạn ngoại lệ, không tự `audit fix --force`.
4. Build hai image, kiểm tra image không chứa `.env`, credential CI, source map public không cần thiết, cache dev hay video fixture lớn.
5. Push image, ghi digest; tạo release manifest và bundle bất biến kèm checksum. Tag commit dùng để tìm, digest dùng để deploy. CI actions pin commit đã kiểm chứng, có cơ chế cập nhật có review.
6. Production job chỉ chạy theo trigger đã chọn, dùng environment và quyền tối thiểu; concurrency một deployment, không hủy lượt đang đổi release. Khóa trên VPS bảo vệ thêm khi chạy thủ công.

Giữ registry hiện hữu nếu người dùng đã dùng Docker Hub; không buộc di chuyển registry. VPS dùng credential pull-only. Build dùng commit đã checkout; không gắn SHA của HEAD lên image được build từ working tree bẩn.

Release manifest chứa: release ID, commit SHA, image digest frontend/backend, checksum cấu hình, thời điểm build, yêu cầu schema/config, kết quả kiểm thử và mức tương thích rollback. Không chứa secrets. Worker/scheduler lấy digest backend cùng manifest.

## 9. Deploy và rollback như một giao dịch

Giữ đường gốc `/opt/movieweb` đang dùng, tổ chức `releases/<release-id>`, `shared` và con trỏ `current/previous`. Compose project/volume name ổn định qua các release. Không dùng `git reset --hard` hoặc thay tag `latest` trên VPS để đổi bản.

Quy trình:

1. Lấy khóa deploy; xác minh manifest, digest, disk/RAM, phiên bản công cụ, secrets bắt buộc, backup gần nhất và tính tương thích rollback.
2. Pull image trước khi thay stack; lưu release đang chạy và export cấu hình proxy hiện tại. Download thất bại không đụng bản đang phục vụ.
3. Validate Compose/Caddy; nếu đổi schema, chỉ migration tương thích ngược trong release tự động. Thay đổi phá vỡ tương thích có cửa sổ bảo trì và phương án dữ liệu riêng.
4. Bật bảo trì khi cần; chuyển đồng bộ frontend, backend, worker, scheduler, kiểm tra liveness/readiness, auth routing, queue và luồng web.
5. Kiểm tra public HTTPS/CDN cùng release marker để tránh nhận cache cũ là deploy thành công. Theo dõi lỗi trong cửa sổ sau deploy.
6. Chỉ đánh dấu `current` thành công sau các gate; giữ bản trước và image rollback. Cleanup theo release đang được tham chiếu, không prune bừa bãi.

Bất kỳ lỗi sau khi bắt đầu chuyển bản — kể cả frontend hoặc FFmpeg thiếu — đều đi vào cùng luồng rollback. Khôi phục manifest/config tương thích của toàn bộ nhóm app, kiểm tra lại và vẫn trả exit nonzero cho deployment đã thất bại. Nếu rollback cũng lỗi: giữ trang bảo trì, gửi cảnh báo riêng, không báo xanh.

Không rollback MongoDB bằng cách ghi đè dump tự động; không phục hồi secret đã bị thu hồi. Redis engine upgrade và Cloudflare rule change được xử lý thành thay đổi hạ tầng riêng với snapshot/diff, không trộn với đổi image ứng dụng.

## 10. Quan sát: Sentry, metrics, log và uptime

### Sentry Cloud

Tích hợp frontend, backend, worker và scheduler theo release/environment. Ban đầu thu lỗi; tracing, profiling và Session Replay tắt. DSN browser là public configuration; token upload source map chỉ ở CI qua secret mount, không nằm trong Docker ARG/layer/runtime.

Lọc Authorization, Cookie, JWT, URI database, API keys, body đăng nhập, query media, đường subtitle capability và dữ liệu cá nhân trước khi gửi. `sendDefaultPii=false` chưa đủ nếu ứng dụng tự đính kèm dữ liệu. Dedupe lỗi và đặt quota. Thiếu hoặc hỏng dịch vụ Sentry không làm request ứng dụng thất bại. Test lỗi giả chỉ ở môi trường thử, chứng minh stack trace đúng release và redaction đúng.

### Grafana Cloud + Alloy

Thu CPU/steal, available memory, swap, disk/inode, network, service restart/OOM, API latency/error, Redis memory/queue age và backup age. Scrape ban đầu 60 giây; dashboard và alert rules được quản lý trong repo. Chỉ log lỗi và sự kiện vận hành đã lọc; không chuyển mọi request segment video lên cloud.

Alloy có giới hạn lưu đệm/disk và quyền tối thiểu; tránh cho agent quyền Docker socket ghi. Gián đoạn cloud phải có hành vi retry/backoff và bounded buffer. Ngân sách RAM phải được đo lại sau khi bật integration. [Grafana integrations](https://grafana.com/docs/grafana-cloud/observe-and-act/monitor-infrastructure/integrations/)

Probe uptime chạy ngoài VPS; mặc định chọn synthetic monitoring của Grafana Cloud nếu tài khoản có quota phù hợp. Probe website và readiness riêng, xác minh chứng chỉ và response mong đợi, không chỉ status 200 của trang lỗi.

| Cảnh báo ban đầu | Điều kiện mục tiêu |
| --- | --- |
| Web/API không sẵn sàng | 3 lần probe liên tiếp thất bại; mục tiêu báo trong khoảng 5 phút |
| API 5xx | Tỷ lệ >5% trong 5 phút, có ngưỡng số request để tránh mẫu quá nhỏ |
| Disk/inode | Cảnh báo disk >80% hoặc inode >85%; chặn deploy khi không đủ dự phòng tính toán |
| RAM/OOM | MemAvailable <15% kéo dài 5 phút hoặc có OOM mới |
| Redis/queue | Redis >80% maxmemory kéo dài; enqueue lỗi; job chờ >5 phút |
| Backup | Lượt backup lỗi hoặc snapshot thành công mới nhất quá 26 giờ |
| Deploy/rollback | Deploy lỗi, rollback lỗi hoặc release marker không đúng |

Email là kênh mặc định; gửi thử cảnh báo và thông báo phục hồi. Ngưỡng cần điều chỉnh từ baseline, không coi mọi tăng CPU ngắn là sự cố. Có maintenance silence hết hạn và heartbeat/dead-man alert để phân biệt không có dữ liệu với hệ thống khỏe.

## 11. Backup ngoài VPS và diễn tập phục hồi

Chọn restic mã hóa sang bucket S3-compatible nằm ngoài VPS; bucket/private credentials và mật khẩu restic được lưu riêng, có bản phục hồi ngoài máy. Không đặt bản duy nhất của khóa giải mã trong chính backup cần khóa đó để mở. [Restic repositories](https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html)

Nội dung: MongoDB `movieweb`, Redis snapshot nhất quán, release manifest/config, Caddy và bộ secrets cần khôi phục. Bỏ cache video/renditions và image layers có thể tải lại; bổ sung upload người dùng nếu thực tế có dữ liệu không tái tạo được. Snapshot tuần của nhà cung cấp là lớp phụ, không bao gồm database bên ngoài.

### Nhất quán dữ liệu

Chế độ mặc định tiết kiệm chi phí là backup trong cửa sổ bảo trì ngắn: chặn lượt mới, drain và dừng các app writer gồm API/worker/scheduler/frontend; giữ Redis để tạo snapshot; dump database khi không có writer ứng dụng. Backup runner tách khỏi app container, có khóa tránh trùng deploy và timeout. Mọi đường lỗi đều phải khôi phục các service đã chạy trước đó và báo trạng thái; không để website mắc ở maintenance vì script lỗi.

Điều kiện của chế độ này là ứng dụng kiểm soát toàn bộ writer trên database đó. Nếu có writer bên ngoài hoặc thời gian gián đoạn vượt ngân sách, phải dùng backup nhất quán do dịch vụ DB hỗ trợ trước khi nhận production đạt nghiệm thu. Không ghép `--db movieweb` với `--oplog`; dump trong khi có ghi không tự tạo snapshot tại một thời điểm. [MongoDB mongodump](https://www.mongodb.com/docs/database-tools/mongodump/)

Lịch đề xuất: hằng ngày 03:15 Asia/Ho_Chi_Minh, mỗi lần trước thay đổi dữ liệu quan trọng; giữ 7 bản ngày, 4 bản tuần, 3 bản tháng trong quota đã duyệt. Timer ghi timezone rõ ràng, chạy lại sau reboot phù hợp và giới hạn tác vụ song song. Retention/prune chạy riêng sau snapshot thành công; không xóa bản cuối cùng còn tốt. Kiểm tra dung lượng tạm trước dump, xóa file tạm đúng thư mục sau khi đã xác minh backup.

Job queue có thể được xử lý lại sau restore; job cần idempotency/deduplication hoặc quy trình reconciliation. Không hứa exactly-once từ Redis snapshot.

### Diễn tập

Restore vào database riêng `movieweb_restore_<id>` và stack biệt lập trên runner/máy thử, không ghi đè production. Vì code hiện cố định tên database, thêm `MONGODB_DB_NAME` mặc định `movieweb` và bảo vệ chế độ diễn tập chống chọn nhầm production. Không mở thêm stack nặng trên VPS đang phục vụ.

Kiểm tra số lượng và mẫu user/history/favorite, index, đăng nhập bằng tài khoản thử, giải mã token bằng đúng keyring, queue/job thử và website. Chặn email/webhook/tác dụng phụ production trong restore drill. Ghi snapshot ID, thời gian thực tế, checksum và kết quả. Chạy trước go-live, sau đổi schema/backup và hằng tháng. Backup thành công nhưng chưa thử restore vẫn chưa đạt nghiệm thu phục hồi.

## 12. Kiểm thử và tiêu chí nghiệm thu

Baseline lấy từ working tree hiện tại trước sửa. Các test cũ lỗi hoặc phụ thuộc dịch vụ thiếu phải được ghi rõ, không đổi expected chỉ để có màu xanh. Các lệnh bắt buộc giữ theo AGENTS.md:

```bash
npm test --prefix backend-node
npm test --prefix frontend
npm run build --prefix frontend
```

Thêm lint/typecheck, route/integration/media tests, kiểm tra cấu hình và image theo kế hoạch triển khai. Test cần network/FFmpeg/DB phải ghi dependency và chứng minh thực sự chạy. Kiểm tra UI dùng browser tích hợp của Codex; media test tự động ở CI là phần riêng.

| ID | Bài nghiệm thu | Bằng chứng đạt |
| --- | --- | --- |
| A01 | Baseline và regression | Lệnh, runtime, input, exit code, passed/failed/skipped trước và sau; mọi regression được xử lý |
| A02 | Build và secrets | Hai image chạy trên Linux; kiểm tra không có env/key/bí mật trong image hoặc log |
| A03 | Provision lần hai | Không thay dữ liệu/secrets hoặc phá cấu hình đang hoạt động |
| A04 | Auth/TLS/routing | NextAuth và backend auth đúng upstream; HTTPS/renewal; diagnostic và metrics không public |
| A05 | Client IP và giới hạn | IP thực qua CDN đúng; spoof header trực tiếp thất bại; hai người dùng không chia nhầm hạn mức |
| A06 | Readiness và queue | DB/Redis lỗi làm readiness 503; phục hồi 200; job thử và heartbeat worker/scheduler hoạt động |
| A07 | Cache web | Static versioned có HIT sau warm; API/session/RSC/user data không bị public cache |
| A08 | Video | Direct, HLS, seek, audio, subtitle, Range và native Safari/hls.js qua đúng hostname; không lộ token |
| A09 | Phân quyền media | Token hết hạn/sai/user khác bị từ chối; response trước đó không làm cache bỏ qua auth |
| A10 | Rollback ứng dụng | Gây lỗi frontend, backend và post-check riêng; toàn bộ app trở về đúng manifest; deploy trả nonzero |
| A11 | Lỗi hạ tầng khi deploy | Pull/disk/config lỗi trước switch không làm hỏng bản hiện tại; deploy đồng thời bị serialize |
| A12 | Observability | Lỗi thử vào đúng Sentry release; metrics/dashboard có dữ liệu; cảnh báo và resolved tới email |
| A13 | Redaction | Token/cookie/password/URL nhạy cảm giả không xuất hiện trong log, Sentry hoặc metrics |
| A14 | Backup/restore | Snapshot ngoài VPS được đọc/restore trong môi trường riêng; số liệu và keyring đúng; đo RPO/RTO |
| A15 | Fault recovery | Redis restart, worker chết, backup timeout, disk thấp, mất kết nối cloud có hành vi hữu hạn và cảnh báo |
| A16 | Capacity | Báo cáo tải tách web và video, CPU/RAM/network/disk, latency và lỗi; không chỉ đếm VU |
| A17 | Tài liệu đồng bộ | Markdown/Word/ZIP cùng release; lệnh được thử; link và checksum kiểm tra lại |

Load test web: tăng 5 → 10 → 20 người dùng đồng thời, think time 2–5 giây, giữ 20 phút ở mỗi mức trên môi trường được phép kiểm thử. Đo endpoint nội bộ đã warm riêng với resolve/upstream và SSR lạnh. Mục tiêu ban đầu cho API nội bộ đã warm: p95 <1 giây, 5xx <1%, không OOM hoặc swap kéo dài. Đây là điều kiện thử với workload xác định, không áp chung cho thời gian lấy nguồn video bên thứ ba.

Load test video: fixture kiểm soát được và nguồn được phép, đo direct riêng với remux/proxy; ghi bitrate, buffering và đường nội địa/quốc tế. Nếu vượt 10 Mbps quốc tế hoặc CPU remux thì quyết định giảm bitrate/đổi luồng/nâng hạ tầng, không tăng timeout để che lỗi. Khi Sentry/Grafana/CDN chưa có tài khoản kết nối, các hàng liên quan giữ trạng thái chưa kiểm chứng.

## 13. Các đầu vào cần có khi nối production

Đây là hợp đồng cấu hình, không phải giá trị mẫu được dùng như secrets thật. Preflight liệt kê tên trường thiếu mà không in giá trị.

| Nhóm | Đầu vào | Nơi dùng |
| --- | --- | --- |
| VPS | IP, SSH user/port, key riêng, host fingerprint, console phục hồi | CI/provision |
| Git/registry | Repo, nhánh release, registry namespace, push token CI và pull token VPS | CI/CD |
| Database | URI, `MONGODB_DB_NAME`, quyền backup, allowlist egress VPS/runner | App/backup |
| Auth/provider | JWT/NextAuth secrets, keyring, Google nếu bật, TMDB và provider hiện dùng | App |
| Cloudflare | Zone, DNS A/AAAA đúng, quyền DNS/rules tối thiểu nếu tự động hóa | Web CDN |
| Media | `PUBLIC_MEDIA_BASE_URL=https://media.cineon.me`, DNS-only, chứng chỉ | Playback |
| Sentry | Org/project, DSN, token source map CI, quota | Errors |
| Grafana | Endpoint/credential ghi metrics/log, stack, synthetic probe và contact point | Metrics/uptime |
| Backup | S3 endpoint/bucket/region, credential hạn chế, restic password, retention/quota | Backup |
| Cảnh báo | Email nhận thông báo đã xác thực | Vận hành |

Secrets được nhập qua kho secret hoặc file cục bộ phù hợp, không đưa vào tài liệu/commit/chat. Các tích hợp cloud có cờ bật rõ ràng để chạy test local; go-live chỉ đạt đủ tiêu chí khi các tích hợp đã chọn được bật và kiểm chứng thực tế.

## 14. Bản đồ thay đổi và bộ bàn giao

Các đường dẫn dưới đây tính từ root repo; những mục mới là vị trí thiết kế, chưa phải file đã được tạo ở giai đoạn đặc tả.

| Khu vực | Công việc dự kiến |
| --- | --- |
| `backend-node/`, `frontend/` | Runtime, auth/bootstrap, readiness, metrics/Sentry, media host, test regression |
| `docker-compose.prod.yml`, Dockerfiles, `.dockerignore` | Một cấu hình production chuẩn, resource limits, secrets exclusion, digest release |
| `.github/workflows/` | CI và production deploy đồng bộ, concurrency, artifact/digest, scan và kiểm thử |
| `deploy/Caddyfile`, `deploy/` | Web/media routing, provision, preflight, deploy, rollback, smoke, backup và restore drill |
| `deploy/observability/` | Alloy, dashboard, alert rules và hướng dẫn contact point |
| `deploy/cloudflare/` | DNS/cache rule specification có kiểm tra và rollback; áp dụng sau khi có zone thực |
| `.env.prod.example` và tài liệu biến môi trường | Đủ biến mới, validator, phân biệt public/build/runtime secret |
| `docs/cineon-deployment/` | Cập nhật Markdown, Word, ZIP, checksum và hướng dẫn vận hành sau khi code được kiểm chứng |

Mỗi nhóm thay đổi có test, cách bật/tắt và rollback riêng. Đặc biệt nâng framework, tách media host và thay release pipeline không gộp thành một lần đổi production lớn.

Runbook cuối phải có: chuẩn bị tài khoản; cấu hình DNS/TLS; provision; nhập secret; build/deploy lần đầu; chuyển từ cấu hình cũ; kiểm tra auth/video/CDN; dashboard/alert; backup/restore; phát hành và rollback; lịch bảo trì; xử lý đầy ổ/OOM/502/DB lỗi/nguồn phim lỗi; giới hạn và tín hiệu nâng VPS.

## 15. Trình tự và trạng thái công việc

- [x] Xác nhận người dùng chọn repo + tài liệu.
- [x] Khảo sát working tree và tái sử dụng bộ tài liệu/kit hiện có.
- [x] Viết thiết kế, lựa chọn kiến trúc, ranh giới CDN và tiêu chí nghiệm thu.
- [x] Tự rà soát tính nhất quán, điều kiện backup, giới hạn VPS, đầu vào và trạng thái chưa triển khai.
- [ ] Người dùng duyệt bản thiết kế này.
- [ ] Viết kế hoạch thực thi theo file/test/dependency và chọn cách thực thi.
- [ ] Triển khai nền tảng/runtime và sửa P0, chạy baseline/regression.
- [ ] Hoàn thiện pipeline deploy/rollback và resource/network controls.
- [ ] Tách media/CDN, tích hợp Sentry/metrics và backup/restore.
- [ ] Kiểm chứng local/staging, nối dịch vụ thực, nghiệm thu production.
- [ ] Cập nhật và render/kiểm tra Word, đóng gói ZIP, bàn giao bằng chứng.

Các checkbox sau bước duyệt là công việc còn lại, không phải kết quả đã đạt. Bản thiết kế là đầu vào cho kế hoạch thực thi; hướng dẫn A–Z cuối cùng sẽ mô tả các lệnh/cấu hình đã được triển khai và kiểm thử, không trình bày thiết kế như trạng thái production.
