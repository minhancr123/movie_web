# Cineon Production DevOps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hoàn thiện repo và tài liệu triển khai production cho cineon.me, với kiểm chứng deploy, CDN, observability và phục hồi dữ liệu.

**Architecture:** Một VPS chạy Caddy và Compose; MongoDB, Sentry/Grafana, uptime và backup ở ngoài VPS. Web qua Cloudflare; video direct hoặc media hostname DNS-only. Release theo digest, có transaction rollback cho mọi service ứng dụng.

**Tech Stack:** Ubuntu 24.04, Node 24, Next.js 16, Express, MongoDB, Redis/BullMQ, Docker Compose, Caddy, GitHub Actions, Python 3 standard library cho công cụ host, Sentry, Alloy/Grafana, restic.

**Spec:** [Thiết kế đã duyệt](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/specs/2026-09-24-cineon-production-devops-design.md).

**Trạng thái:** Kế hoạch chờ duyệt và chọn cách thực thi. Code trong các khối bên dưới là nội dung dự kiến triển khai, không phải code đã được áp dụng hoặc kết quả test đã chạy.

## Global Constraints

- “Ubuntu 24.04 LTS, 1 vCPU, RAM 4 GB, NVMe 30 GB.”
- “Đích là Node 24 LTS và Next.js 16 stable đã vá, cùng React/thư viện tương thích”.
- “`VIDEO_TRANSCODE_FALLBACK=never`, `REMUX_MAX_WRITERS=1` ban đầu.”
- “Giữ tối thiểu 6 GB disk trống.” Cache dự trù 3 GB mỗi nhóm, tối đa 6 GB trước khi đo chồng lấp.
- RAM app: backend 1280, frontend 768, Redis 512, worker 256, scheduler 192 MiB; Alloy có ngân sách 256 MiB.
- “RPO dữ liệu tối đa 24 giờ; RTO mục tiêu tối đa 2 giờ khi đã có VPS thay thế, quyền truy cập và khóa giải mã.”
- “Không rollback MongoDB bằng cách ghi đè dump tự động; không phục hồi secret đã bị thu hồi.”
- “Bypass cache vẫn đi qua Cloudflare proxy.” Media DNS-only không phải CDN video.
- Giữ thay đổi working tree đã có; không stash/reset/commit chung các thay đổi của người dùng. Chỉ commit đúng hunk và file của task.
- Graft lấy span/callers trước sửa; Serena sửa tại span đó; không tìm cùng symbol ở cả hai công cụ. Refresh graph sau nhóm thay đổi lớn.
- Trên Windows dùng PowerShell nhất quán cho thao tác file và kiểm tra absolute path trước xóa/di chuyển. Linux scripts chạy trong Linux, không coi Git Bash syntax pass là VPS integration pass.
- Repo root hiện tại: `C:\Users\ADMIN\Downloads\movie_web`. Đường dẫn source bên dưới tính từ root; đường dẫn `/opt/movieweb` là trên VPS.

## Review Focus

1. RF1 — Input chứa path traversal/symlink hoặc secret: preflight/backup phải từ chối trước side effect, log chỉ tên trường. Test ở D1, O1, B2.
2. RF2 — Redis/MongoDB treo chứ không trả lỗi ngay: readiness và queue producer phải timeout hữu hạn; worker phục hồi. Test ở F3, V1.
3. RF3 — Frontend trả 200 nhưng sai release, hoặc post-check FFmpeg lỗi sau khi API đã xanh: rollback cả app, giữ exit nonzero. Test ở D3, D4.
4. RF4 — Header IP giả và URL media có token bị cache/log: auth vẫn kiểm tra mọi lượt, client IP không do người xem tự chọn. Test ở C1, C2, O1.
5. RF5 — Backup bị ngắt sau khi dừng writer hoặc restore chọn nhầm DB production: resume đúng service ban đầu; restore từ chối target nguy hiểm trước ghi. Test ở B1, B2.

## 1. Chia kế hoạch theo hệ thống

Spec rộng nên chia thành năm kế hoạch có đầu ra kiểm thử riêng; master này khóa thứ tự và giao diện chung.

| Thứ tự | Kế hoạch | Tasks | Đầu ra |
| --- | --- | --- | --- |
| 1 | [Nền tảng](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/plans/2026-09-24-cineon-01-foundation.md) | F1–F4 | App production baseline, auth/bootstrap, readiness/queue, image/Compose |
| 2 | [Release](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/plans/2026-09-24-cineon-02-release.md) | D1–D4 | Provision, release manifest, deploy/rollback, CI/CD |
| 3 | [Media/CDN](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/plans/2026-09-24-cineon-03-media-cdn.md) | C1–C3 | Media host, Caddy/proxy trust, Cloudflare rules và verification |
| 4 | [Vận hành](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/plans/2026-09-24-cineon-04-operations.md) | O1–O2, B1–B2 | Sentry, metrics/alerts, backup và restore drill |
| 5 | [Nghiệm thu](C:/Users/ADMIN/Downloads/movie_web/docs/superpowers/plans/2026-09-24-cineon-05-acceptance.md) | V1–V2 | Báo cáo A01–A17 và bộ hướng dẫn Word/Markdown/ZIP |

Thực hiện theo thứ tự trên. D4 thêm cloud secret references nhưng chưa bật production rollout khi các gate C/O/B chưa đạt. Không deploy một nửa hệ thống chỉ vì một kế hoạch con đã xanh.

### Working tree hiện có và baseline phát hành

F1 tạo inventory/hash của các thay đổi ứng dụng hiện có trước khi sửa. Khi bắt đầu thực thi, dùng skill using-git-worktrees để tạo checkout quản lý riêng trên nhánh `codex/cineon-production-devops`; copy đúng allowlist source/test/config hiện tại vào đó, kể cả helper/test untracked cần cho ứng dụng. Loại secrets, cache, binary QA và nội dung không liên quan. Kiểm tra path đích thuộc worktree trước mọi thao tác file. Repo gốc giữ nguyên.

Baseline snapshot của các thay đổi đã có được commit riêng trong worktree, ghi rõ nguồn working tree của người dùng, sau khi inventory được review; không gộp với implementation commit. Nếu chưa chốt allowlist hoặc phát hiện file đang bị sửa đồng thời thì dừng việc snapshot để làm rõ, vẫn làm được các task độc lập không đụng file đó. CI cuối phải build commit chứa baseline này, không chỉ HEAD cũ thiếu các sửa đổi người dùng. Native hay Subagent-driven đều tuân thủ quy tắc này và bàn giao branch/diff để tích hợp vào repo gốc.

## 2. Hợp đồng chung

### App/config

`MONGODB_DB_NAME` mặc định `movieweb`; `RELEASE_ID` là Git SHA đầy đủ; `PUBLIC_MEDIA_BASE_URL` là HTTPS origin không có path/query/userinfo. Local dev được phép để trống media origin; production với Cloudflare bật phải cung cấp media origin.

`GET /health` giữ liveness; `GET /ready` trả `{status: 'ready'|'not_ready', release: string}`, HTTP 200/503, `Cache-Control: no-store`. `GET /api/health` của frontend trả `{status:'ready', release:string}` và không cache. `GET /metrics` là nội bộ, không public.

`getReadiness({mongoPing, redisPing, timeoutMs=1500}) -> Promise<{ready:boolean}>`; adapter chạy ping thật với timeout driver hữu hạn. `SYSTEM_HEALTHCHECK='system.healthcheck'` là job mới không sửa dữ liệu; heartbeat key `cineon:heartbeat:<worker|scheduler>` TTL 90 giây.

### Host/release

Host không cần cài Node: Python 3 điều phối subprocess Docker/Caddy/restic; Bash là wrapper. Không source file `.env`; Docker Compose đọc env, Python đọc JSON/config có validator riêng.

Manifest `schemaVersion=1` chứa `releaseId` (40 hex), `commitSha` bằng releaseId, `images.backend/frontend` dạng `registry/name@sha256:<64 hex>`, `files` là map đường dẫn tương đối sang SHA256, `configVersion=1`, `databaseCompatibility='backward-compatible'`, `createdAt` ISO UTC, `tests` là map gate sang `passed`. Không chứa env values.

Artifact gồm manifest, Compose, Caddy fragments, script host và dependency versions. Host tải manifest qua SSH đã xác minh cùng bundle do CI tin cậy phát hành; checksum chống hỏng/nhầm nội dung, không tự chứng minh nguồn gốc nếu kênh truyền bị thay thế.

Một lock `/opt/movieweb/shared/ops.lock` dùng chung deploy/rollback/backup. `shared/app.env` giữ secrets; `releases/<releaseId>` bất biến; `current`/`previous` chỉ đổi sau gate. Existing volumes được inventory/adopt, không âm thầm tạo mới.

CLI dự kiến, cài bởi D2 và có kiểm tra tham số trước side effect:

```bash
deploy/deploy.sh --root /opt/movieweb --bundle /opt/movieweb/incoming/release.tar.gz
deploy/rollback.sh --root /opt/movieweb --to previous
deploy/backup.sh --root /opt/movieweb
deploy/restore-drill.sh --root /opt/movieweb --snapshot latest --target movieweb_restore_drill
```

Các lệnh trên là giao diện sẽ xây dựng, không chạy trong lượt lập kế hoạch. Restore-drill chỉ chạy trên máy/stack diễn tập, không trên production.

### Bằng chứng

Mỗi task ghi command, cwd, input fixture/config names, runtime versions, literal output, exit status và phạm vi kiểm chứng vào `.codex-artifacts/cineon-devops/<task>/`. Thư mục này đã được ignore; dữ liệu production không đi vào fixture/report công khai. Mỗi thay đổi có snapshot/hash trước sửa; test rollback trên bản sao biệt lập, không hoàn nguyên working tree người dùng để thử.

Không đánh dấu test thành công khi tool thiếu, case bị skip, Docker daemon chưa chạy hoặc dịch vụ cloud chưa nối. Baseline/app tests chạy ở giai đoạn thực thi, chưa chạy ở bước viết kế hoạch.

## 3. Ma trận bao phủ spec

| Spec | Task sở hữu | Acceptance |
| --- | --- | --- |
| §1–4: capacity, topology, bảo toàn baseline | F1, F4, V1 | A01,A02,A16 |
| §5: provision, SSH, volumes | D2, F4 | A03,A04,A11 |
| §6: runtime/auth/secrets/lifecycle | F1,F2,F3,C2 | A01,A05,A06,A15 |
| §7: DNS/TLS/auth routing/media/CDN | C1,C2,C3 | A04,A05,A07,A08,A09 |
| §8–9: CI/release/rollback | D1,D3,D4 | A02,A10,A11 |
| §10: Sentry/metrics/alerts/redaction | O1,O2 | A12,A13,A15 |
| §11: backups/restore/data consistency | B1,B2,F2 | A14,A15 |
| §12: integration/load/fault tests | V1 và test trong từng task | A01–A16 |
| §13: account/config inputs | D1,C3,O1,O2,B1 | Preflight và activation checklist |
| §14–15: runbook/package/status | V2 | A17 |

## 4. Điều kiện go-live

- [ ] Mọi task có review, test và commit/hunk riêng; working tree người dùng được giữ.
- [ ] Các gate local/Linux đã đạt, không dùng mock để thay cho kiểm thử production.
- [ ] IP/SSH/registry/DB và keys do người dùng cấu hình, không ghi vào tài liệu.
- [ ] Cloudflare zone, media DNS, Sentry project, Grafana stack/probe và S3 backup đã nối; quota/chi phí được người dùng xác nhận trước kích hoạt.
- [ ] Một release hỏng được rollback; một snapshot được restore vào hệ thống biệt lập; cảnh báo thật đã tới email.
- [ ] A01–A17 có bằng chứng; mục chưa kiểm chứng còn để mở, không gọi toàn hệ thống đã hoàn chỉnh.

## 5. Review kế hoạch và thực thi

Tự review đã đối chiếu toàn bộ 15 mục spec với 17 tasks/A01–A17, thống nhất tên module Python và các interfaces giữa kế hoạch. Làm rõ A09 theo auth hiện có: chỉ session riêng từ chối user khác; rendition chia sẻ và VTT capability giữ đúng mô hình quyền của chúng. Đã bổ sung case proxy spoof, frontend sai release, metadata rollback, backup recovery và root/restore guards. Các code blocks được kiểm cú pháp riêng; đây không phải kết quả chạy ứng dụng hoặc deploy.

Kế hoạch này đề xuất **Native**: thực hiện lần lượt trong phiên hiện tại để giữ ngữ cảnh các thay đổi đang có; review độc lập toàn thay đổi ở cuối nếu người dùng chọn cách này. **Subagent-driven** là lựa chọn có implementer/reviewer riêng từng task, đổi lại nhiều lần truyền ngữ cảnh hơn.

- [x] Spec được duyệt.
- [x] Chia kế hoạch theo subsystem, định nghĩa giao diện và ma trận bao phủ.
- [ ] Người dùng duyệt kế hoạch và chọn Native hoặc Subagent-driven.
- [ ] Thực thi F1–V2.

### Nguồn kỹ thuật kiểm tra ngày lập kế hoạch

- [Nâng Next.js 16](https://nextjs.org/docs/app/guides/upgrading/version-16): thay script lint độc lập, kiểm tra async request APIs và chọn bundler rõ ràng.
- [Docker build secrets](https://docs.docker.com/build/building/secrets/): token CI đưa qua secret mount, không qua build ARG hoặc image layer.
- [GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency): serialize production job và giữ lượt đang chạy.
- Registry npm đã trả `next@16.3.6`, `next-auth@4.24.13` với peer range gồm Next 16/React 19, Sentry SDK `11.0.0`, `prom-client@15.1.3`. Đây là ứng viên kiểm thử, không thay thế audit/lockfile khi thực thi.
