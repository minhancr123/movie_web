# CineVN — audit streaming, hardening và performance (27/10/2026)

## 1. Phạm vi, baseline và kết luận

- Repository `minhancr123/movie_web`; fetch trước sửa. HEAD ban đầu worktree `40c729e`; remote `optimize/perf-20261024` là **24f7a662d706751e48c75e7d749ccfb2eef0816b**, descendant trực tiếp. Nhánh riêng `codex/streaming-audit-hardening` đã fast-forward tới baseline đó trước khi sửa.
- Worktree sạch trước sửa. Không force push, không thay nhánh chung, không sửa secret/account/provider configuration.
- **Không deploy, không restart server, không cài app, không thử media production trong audit này.** Current production SHA chưa xác minh lại. Không được dùng báo cáo này như xác nhận production đã sửa.
- Graft CLI/index và Serena không có trong môi trường; tra cứu source có phạm vi, vị trí dưới đây là source sau sửa.
- Hai P0 đã sửa, có regression tests. **Chưa đủ điều kiện nghiệm thu toàn bộ**: physical iPhone acceptance pending; suite backend có một lỗi A/V tái hiện cả trên baseline, chưa được làm xanh bằng thay tolerance.

## 2. Findings có đối chiếu source

| ID | Mức | Phân loại chứng cứ | Vị trí sau sửa | Nguyên nhân / xử lý |
|---|---|---|---|---|
| A01 | P0 | confirmed bug | `backend-node/services/playback/remuxService.js:1775`, `:1871`, `:2090` | Respawn dùng cùng directory trong khi start xóa directory. Chặn append tại chỗ, reject resume trước side effects, fresh mkdir nguyên tử không xóa output tồn tại. Hai poll route không refresh URL/respawn nữa. |
| A02 | P0 | confirmed bug | `frontend/src/lib/playback-progress.ts:368` | `Number(null)===0` làm failover về đầu. Guard nullish, giữ explicit zero. |
| A03 | P1 | measurable performance issue (fixture) | `backend-node/controllers/playbackController.js:1925`, `:2143`; `opensubtitlesHash.js` | Await optional subtitle hash trên đường trả playback. Deferred publication gắn owner/session/file, singleflight tối đa 64 in-flight; inventory v8 phân biệt hash-ready/IMDb. |
| A04 | P1 | confirmed untrusted network path; không phải exploit đã xác nhận | `backend-node/services/playback/vimoClient.js:53`, `security/safeFetch.js:40` | fetch redirect follow và status-only. Dùng resolve/pin/revalidate từng redirect, chặn IPv4-mapped IPv6 và dải reserved, deadline tổng + max bytes, kiểm tra `#EXTM3U`. |
| A05 | P1 | confirmed authorization bypass in source | `backend-node/routes/playback.js`, `middleware/auth.js`, `controllers/playbackController.js:4827` | Published segments bỏ qua middleware và controller auth; raw manifest không gắn grant. Tất cả published assets nay đi qua session/grant checks; manifest rewrite grant; browser-private immutable segments. Không suy diễn thành vụ xâm nhập. |
| A06 | P1 | confirmed code path; latency thiết bị chưa đo | `frontend/src/components/PlaybackSection.tsx:1305`, `lib/prepared-window.ts:27`; `VideoPlayer.tsx:2427` | Foreground có thể đợi toàn vòng 25×1s prewarm. Giới hạn đợi adoption 1s, kiểm tra latest serial/epoch; pointer-up commit bỏ 650ms, input tần suất cao vẫn debounce. Không xóa admission/coalescing backend. |
| A07 | P1 | confirmed unreachable behavior | `frontend/src/components/VideoPlayer.tsx:1233`, `lib/subtitle-alignment.ts` | Guard loại external/external mâu thuẫn mô tả. Cho primary làm reference, chỉ chỉnh secondary khi confidence đủ; mở offset search ±15s với test ±10s. Embedded/embedded vẫn không tự dịch; manual timing guard giữ nguyên. |
| A08 | P1 | confirmed resource fan-out | `backend-node/services/addonClient.js`, `playback/bounded-settled.js` | Tối đa 24 sidecars/provider chạy cùng lúc. Bounded 4/provider, giữ thứ tự VI/EN và xử lý lỗi riêng. Trade-off: tổng inventory có thể lâu hơn; chưa tuyên bố tối ưu latency progressive. |
| A09 | P1 | confirmed shared budget | `backend-node/middleware/rateLimit.js:62`, `routes/playback.js:78` | Listing + subtitles dùng chung 30/min với resolve/prewarm. Tách source 15/min, subtitles 20/min; resolve vẫn 30/min, không bỏ rate limit. Test bucket độc lập và vẫn chặn khi vượt. Chưa khẳng định đây là nguyên nhân của từng 429 production trước đó. |
| A10 | P2 | confirmed UX inconsistency | `frontend/src/components/VideoPlayer.tsx` | Thông báo cố định 20 giây khác recovery timer. Thay bằng mô tả đúng trạng thái đã thử khôi phục, không đổi timeout. |
| A11 | P1 | existing correct behavior | capabilities/sourceRanker/sourcePicker/directPlayVerdict + golden suites | Phone Auto maxHeight, direct tie-break, cached readiness, manual/pinned source, probe/Range guards đã có. Không thay ranking defaults vì không có benchmark cùng source/network/device. `maxBitrateMbps=0` là không có thông tin; vẫn có bitrate quality/risk scoring, không phải cam kết mạng vô hạn. |
| A12 | P1 | existing correct behavior | `VideoPlayer.tsx:1199`, playback-restore, prepared-window, startupPolicy | PointerUp, native Apple HLS preference, decoded-frame protection, absolute subtitle clock, 45s prewarm có sẵn. Không sửa lại thành nearestCue ±2s; không xóa restore protection, không đổi window/segment/readrate mặc định. |
| A13 | P1 | confirmed test failure on baseline and after | `backend-node/tests/playback-sync-real.test.mjs:56` | Synthetic B-frame/DTS fixture lệch subtitle/source -61ms, vượt ngưỡng 60ms trên bộ công cụ local. Baseline module tái hiện cùng lỗi. Chưa kết luận decoder iPhone hoặc nguyên nhân định lượng; không đổi media clock/tolerance. Merge gate còn mở. |

## 3. P0 recovery: phương án an toàn được chọn

Không triển khai append + discontinuity khi chưa chứng minh init/timestamp continuity. `respawnSessionWriter()` trả `new-session-required` vô điều kiện, không spawn, không refresh TorBox URL, không mutate playlist, không giữ respawnCounts/respawnGate. Tham số resume ở entry `startRemuxSession()` bị reject với `UNSAFE_REMUX_RESUME`; fresh directory đã tồn tại bị `EEXIST` thay vì bị xóa. Entry này dành cho fresh namespace; callers recovery phải tạo session ID mới.

Đây là **vô hiệu hóa đường nguy hiểm**, không phải tự nhận đã thực hiện append an toàn. Vì không có writer recovery tại chỗ nên simultaneous recovery, ENDLIST, disk-full/upstream error/invalid owner không thể gây crash-loop qua đường này. Ownership ở poll route vẫn chạy trước khi đọc session. Disk/admission/lease protections của đường fresh được giữ và suite riêng đã chạy. Failure UI/recovery vào session mới vẫn cần E2E thật.

Media integration bắt buộc dùng FFmpeg/ffprobe (thiếu binary => fail): tạo H.264/AAC synthetic; writer EVENT bị SIGKILL sau hai segment; so hash tất cả file; GET từng file trả 200; ffprobe kiểm tra stream video/audio; FFmpeg decode prefix retained; fresh namespace bắt đầu từ đoạn kế tiếp decode được. Hai calls recovery đồng thời tạo 0 writer. Không có tuyên bố nối timeline cũ, hoặc đã kiểm chứng gapless qua hai player sessions.

## 4. Các thay đổi và giới hạn

### Playback và đo seek

`SeekTrace` giữ tối đa chín phase cho intent hiện tại; intent mới reset trace, phase không quan sát được để trống. Pointer-release ghi commit ngay; resolve start/end, session-ready ở bước restore, MSE manifest/target-containing fragment, decode-ready và rVFC frame được ghi khi quan sát được. Native HLS không có network hooks: không gán manifest/segment time giả. Không có rVFC thì không gán first-target-frame-rendered. `seek_trace` gửi qua endpoint telemetry có ownership, parser whitelist phase/engine/giới hạn 300s; logs chỉ bounded event + random eventId, không session/user/title/token và không thêm histogram labels.

`session_ready` nghĩa là client bắt đầu restore source sau manifest/coverage, **không phải thời điểm writer phía server vừa ready**. Resolve end ghi khi callback foreground hoàn tất; response không tạo frame thì trace chưa được gửi. Muốn đo failure/cancel đầy đủ hoặc server correlation phải bổ sung staging instrumentation; không suy diễn phase còn thiếu là zero.

`pickFailoverStartAt` không backoff, explicit pending 0 có hiệu lực. `pickRecoveryTarget` có recovery backoff; `computeResumeAt` xử lý lịch sử và chừa phần EOF; `audioSwitchStartAt` dùng max(playhead, session origin) và audio backoff. Không hợp nhất bốn semantics.

### Hash / phụ đề

Range hash chỉ nhận 206 đúng Content-Range và đúng 64KiB mỗi đầu; response 200, thiếu bytes, oversized body bị cancel/reject. Timeout 15s giữ nguyên, nhưng không nằm trên đường video-ready. In-flight work singleflight theo identity + size; completed cache giữ phạm vi file. Deferred DB update chỉ khớp owner/session/infoHash/fileId còn hạn; không persist URL. Hash tới sau sẽ có inventory-key khác tránh giữ mãi inventory IMDb-only.

Song ngữ external/external chỉ timing/cue boundaries, không so nội dung dịch. Ambiguity, sparse/missing cues, drift và manual delay protections vẫn có. ±15s là mở rộng bounded search, chưa phải thuật toán căn mọi theatrical/director cut. Không tự tạo bản dịch Việt.

Bounded sidecars là cải thiện tài nguyên, **không phải progressive inventory đã hoàn tất**. Listing SubDL 20s và vòng inventory tổng vẫn có thể chậm. Chưa đổi response contract/job protocol vì chưa có benchmark và test progressive kết hợp embedded/external cache để đảm bảo không regress.

### Provider/source discovery

Đã review AIOStreams/native addon/TorBox/Vimo/YaStream paths và chạy source-ranker/picker/direct-discovery/file-selection/aiostreams/torbox-timeout suites hiện có. Provider malformed/5xx circuit-breaker có sẵn; không nâng quyền gói hay đổi tài khoản. Không thay các defaults ranking khi chưa có golden benchmark live. Trước audit có hai phép đọc TorBox thành công (`user/me` ~784ms; `torrents/mylist` ~1615ms, HTTP200/success true); đó không chứng minh throughput video, không phải benchmark outage/live trong audit này.

## 5. Regression tests và kết quả

Môi trường local macOS arm64, Node v24.21.0. Dependencies hiện có đã được dùng; không chạy npm ci để phá node_modules đang chia sẻ worktree. CI vẫn cài clean bằng npm ci.

- `npm run typecheck --prefix frontend`: PASS.
- `npm test --prefix frontend`: **188 passed, 0 fail, 0 skip**.
- `npm run build --prefix frontend`: PASS, production webpack build. Không dùng production env/secret mới để build audit.
- `PATH=<isolated-ffmpeg-bin> npm test --prefix backend-node`: **FAIL** tại `playback-sync-real`, -61ms. Hai node:test groups trước đó 83/83 và 18/18 PASS; các standalone trước điểm dừng PASS.
- 20 package commands sau điểm fail được chạy riêng: tất cả exit0; file evidence liệt kê từng command. Không gọi đây là full suite xanh.
- `npm run test:audit --prefix backend-node`: **4/4 PASS**, hash/identity/concurrency/rate limits/SSRF.
- `node --test tests/playback-observability.test.mjs tests/playback-extras.test.mjs tests/audit-hardening.test.mjs`: nhóm focused trước test rate-limit cuối là 11/11 PASS; test rate-limit có lần chạy riêng 4/4 ở trên.
- `node tests/media-grant.test.mjs`: PASS, gồm published segment URL không credential phải 401 và existing grants/scope/expiry/manifest rewrite tests.
- `npm run test:media-audit --prefix backend-node`: PASS, **không skip khi thiếu FFmpeg**; FFmpeg6.0/ffprobe binary isolated. Attempt đầu với FFmpeg4.4 fail vì không hỗ trợ `fps_mode:v`; đã thay công cụ test, không sửa args production cho qua.
- `python3 -m unittest discover -s deploy/tests -v`: **64/64 PASS**.
- Chạy baseline remux module trong fixture A/V giống hệt: **FAIL -61ms**, cùng after. File tạm baseline đã xóa sau so sánh.

Test mới ngăn tái phát: failover null/undefined/zero; foreground preparation deadline; trace latest-intent/reset/unknown phases; ±10s external/external timing; same-file hash singleflight; exact range/oversize; stale publication selector; max4 sidecars; source/subtitle budget không ăn resolve; private/mapped-IP redirects; HTML200 giả HLS; oversized/drip deadline; published-segment auth; real interrupted-prefix safety.

CI: thêm PR base optimize, push đúng nhánh audit và workflow_dispatch, cài FFmpeg, chạy audit + mandatory media integration. **Không sửa production deploy triggers**. CI trên GitHub chưa được tính là PASS cho tới khi run thực tế hoàn tất.

## 6. Performance: kết quả được phép kết luận

Benchmark 30 mẫu, local HTTP server trì hoãn body mỗi Range 80ms, hai Range song song; chạy compute hash thật. Trước: optional hash nằm trên critical path; sau: schedule rồi trả video path không await hash. Hash vẫn chạy đủ và được đợi cuối mỗi mẫu để không chồng tải.

| Kịch bản | n | Before p50/p95 | After p50/p95 | Failure |
|---|---:|---:|---:|---:|
| Optional-hash gate, Node loopback fixture | 30 | 83.64 / 84.69ms | 0.01 / 0.05ms | 0 |

**Không phải TTFF, seek latency hay kết quả iPhone.** Không cộng/trừ các số này trực tiếp vào trải nghiệm thật. Sidecar peak concurrency đo được 4 thay vì fanout24 trong fixture; đây là resource bound, chưa phải inventory latency improvement.

Direct/warm HLS/cold HLS/handoff/inventory/extraction: chưa có p50/p95 cùng source/thiết bị/mạng. Chỉ mới bổ sung instrumentation, regression và synthetic decode. Không tuyên bố 1–2s hoặc “như Stremio”.

## 7. Ma trận acceptance

| Nhóm yêu cầu | Bằng chứng có | Còn cần kiểm thử |
|---|---|---|
| Direct Range 0/giữa/cuối/đầu | Range policy + source golden + hash fixture | iPhone/Brave frame latency 30 mẫu |
| Warm/cold HLS, prewarm đang chạy | restore unit, bounded wait, real fresh HLS decode | foreground adoption race/WAN/actual native frame |
| A→B→C / 10 seek; paused/playing | existing progress/intent/cancel tests + latest trace | physical iPhone rapid seeks |
| Audio/source switch và URL hết hạn | source/refresh/media-grant ownership suites | A/V transitions trên thiết bị |
| Segment 401/403/404/5xx/timeout | access/grant/range/SSRF/provider timeout tests | player failure UI/E2E |
| Writer chết, ENDLIST, concurrent recovery | mandatory synthetic kill/hash/HTTP/decode/no-spawn | gapless session handoff |
| Hai viewer, leases/adoption/TTL | existing lease/admission/rendition tests | concurrent WAN load staging |
| Window boundary 4K bitrate cao | startup/window/disk rules tests giữ nguyên | actual remux high-bitrate benchmark |
| Pause5min, background/foreground, EOF/next episode/fullscreen | regression helpers hiện có | physical browser/device acceptance |
| H.264 AAC; HEVC/Main10; B-frame/DTS | real remux/audio test suites; A/V fixture open -61ms | HDR/VFR/route changes/audio drift trên Apple |
| VI/EN external/embedded/song ngữ/manual | alignment/cue/coverage/window tests | real film cut/reference validation |
| Quota/pending extraction/atomic VTT | existing subtitle tests + bounded sidecar error isolation | progressive inventory staging |
| Ownership/grant/SSRF/disk/writer limits | grant, auth, admission, janitor, SSRF tests | CDN edge auth + cache/purge staging |

## 8. Security/resource review và compatibility

Không gỡ authentication, ownership, disk admission, writer limit4, viewer leases, media grants. Không đổi -ss, readrate, segment duration, codec defaults hoặc timestamp mapping. Không log signed URLs/secrets/subtitle body. Scope-limited seek events không có user/title/session labels.

Published segment auth là thay đổi compatibility có chủ ý: client hợp lệ cần manifest mới với child grant. Browser cache vẫn được dùng (`private, immutable`), shared CDN cache không còn được phép dựa vào việc bỏ query grant. **Nếu có CDN đã cache public segments trước đây, cần kế hoạch purge và edge authorization trước triển khai; audit không tự purge.** Grant hết hạn cần manifest refresh flow có sẵn; pause5min/long movie cần acceptance cụ thể trước release.

Không DB migration; chỉ cache namespace inventory v8, tự hết hạn theo TTL. Không có config mới bắt buộc. FFmpeg/ffprobe bắt buộc cho media CI; production không bị thay binary. Không tăng writer/window/cache defaults. Per-account metadata buckets thay đổi số yêu cầu được phép từng loại; phải theo dõi 429 và quota shared TorBox trên staging, không coi account budget là provider-global quota.

## 9. iOS native

Source thật có tại `~/Documents/CineVN-IOS`; đã rà các đường `NativePlayer`, `PlayerScreen`, seek callback generation, queued far seek, current item/time observer và buffer/preview coordination. Nhánh repo chứa patch lịch sử, **không chứa project Swift đầy đủ**. Các bản iOS cài ở lượt trước không tự nhận các thay đổi web/backend trong PR này.

Trong audit này không sửa/build/install native, không dùng thiết bị thật làm benchmark. Rủi ro còn cần acceptance: completion/observer tới muộn khi item replace, manual pause trong resolve, play intent qua local/far seek, cancel task/unmount, volume gesture/audio-route interruption, ongoing loading overlay và multiple rapid seeks. **physical iPhone acceptance pending**.

## 10. Production và rollback

Production hiện tại: **SHA chưa xác minh trong audit**; số SHA đã thấy ở lượt trước không được coi là trạng thái live hiện tại. Không cần downtime/migration ngay bây giờ vì chưa deploy.

Trước rollout: resolve baseline A/V failure; CI xanh hoặc có quyết định test/toolchain được review; staging E2E với iframe/device/client thực; xác nhận CDN/cache/grant compatibility. Sau đó mới xin quyền triển khai cụ thể.

Rollback code bằng revert commit audit trên nhánh/PR, không reset dữ liệu. Nếu được triển khai sau này, quay frontend/backend cùng release tương thích; không phục hồi cơ chế unsafe append chỉ để hết spinner. Giữ security guard published assets; có thể rollback riêng performance changes nếu cần. Cache v8 không cần xóa dữ liệu cũ, chỉ để TTL hết hạn.

## 11. Những việc chưa xác minh / chưa triển khai

- E2E iPhone và benchmark 30 mẫu cho direct/warm/cold/handoff/inventory/extraction; actual live production/providers.
- -61ms A/V fixture baseline failure: cần toolchain matching và phân tích timestamp trước sửa.
- Progressive/lazy subtitle inventory, ưu tiên queue background→foreground thực tế và promotion không duplicate writer: chưa có benchmark/race integration đủ để đổi protocol mặc định.
- Source provider coverage/live ranking, 4K WAN throughput, mixed HDR/VFR + nhiều người xem; không dùng metadata addon để tuyên bố Direct Play thật.
- Client native installed version đối chiếu source + test UI thực, audio silence và long-pause grants.
- Shared CDN edge auth/purge; rate-limiter distributed provider-global quota; đây là phần ngoài phạm vi sửa cấu hình được phép.

## 12. Files changed / commit và evidence

Danh sách file chính xác được tạo bên dưới trước commit. Commit/PR là nhánh `codex/streaming-audit-hardening`, không merge. Evidence có cấu trúc nằm tại `docs/reviews/evidence/2026-10-27-streaming-audit/`; không đưa credentials hoặc production payload vào evidence.

- `.github/workflows/ci.yml`
- `backend-node/controllers/playbackController.js`
- `backend-node/controllers/playbackExtrasController.js`
- `backend-node/controllers/playbackTelemetryController.js`
- `backend-node/middleware/auth.js`
- `backend-node/middleware/rateLimit.js`
- `backend-node/package.json`
- `backend-node/routes/playback.js`
- `backend-node/services/addonClient.js`
- `backend-node/services/playback/bounded-settled.js`
- `backend-node/services/playback/opensubtitlesHash.js`
- `backend-node/services/playback/remuxService.js`
- `backend-node/services/playback/vimoClient.js`
- `backend-node/services/security/safeFetch.js`
- `backend-node/tests/audit-hardening.test.mjs`
- `backend-node/tests/hash-critical-path-benchmark.mjs`
- `backend-node/tests/media-grant.test.mjs`
- `backend-node/tests/playback-observability.test.mjs`
- `backend-node/tests/remux-recovery-safety-real.test.mjs`
- `backend-node/tests/vimo-verify.test.mjs`
- `docs/reviews/2026-10-27-streaming-audit.md`
- `docs/reviews/evidence/2026-10-27-streaming-audit/backend-remainder.json`
- `docs/reviews/evidence/2026-10-27-streaming-audit/hash-critical-path.json`
- `docs/reviews/evidence/2026-10-27-streaming-audit/validation.json`
- `frontend/src/components/PlaybackSection.tsx`
- `frontend/src/components/VideoPlayer.tsx`
- `frontend/src/lib/playback-progress.ts`
- `frontend/src/lib/playback-telemetry.ts`
- `frontend/src/lib/prepared-window.ts`
- `frontend/src/lib/seek-trace.ts`
- `frontend/src/lib/subtitle-alignment.ts`
- `frontend/tests/playback-progress.test.mjs`
- `frontend/tests/playback-telemetry.test.mjs`
- `frontend/tests/prepared-window.test.mjs`
- `frontend/tests/subtitle-alignment.test.mjs`


### Trạng thái bàn giao

Code audit commit `76c1b35` đã push nhánh riêng. GitHub connector từ chối tạo draft PR với HTTP403 `Resource not accessible by integration`; không có PR được tạo, không merge. CI được bật bằng push chỉ cho nhánh audit, không thêm trigger deploy. Có thể mở compare/create PR từ nhánh này sau khi quyền GitHub phù hợp. CI remote chưa được xác nhận PASS trong báo cáo.
