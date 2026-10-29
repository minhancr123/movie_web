# Audit follow-up: timestamp và media grants — 29/10/2026

## Phạm vi và trạng thái

Nhánh `codex/streaming-audit-hardening`, bắt đầu tại `4d0e94b82f2676823d1d6a8618586b443c7c8d31`. Baseline `24f7a662d706751e48c75e7d749ccfb2eef0816b`. Không merge, không deploy, không restart production, không cài iOS. Không truy cập TorBox/DB/CDN production trong lượt này.

Báo cáo 27/10 đã bỏ sót lỗi HEVC của [run 40463307787](https://github.com/minhancr123/movie_web/actions/runs/40463307787). Backend dừng tại `remux-hevc-roundtrip`, nên frontend/typecheck/build chưa chạy trong run đó. Không thể dùng kết quả local macOS để kết luận Ubuntu xanh.

**Local và [CI GitHub run 40819463916](https://github.com/minhancr123/movie_web/actions/runs/40819463916) đã PASS toàn bộ tại commit `1115b62ba4571a2bbe38cb69e2b4a50f3e822070`.** Progressive subtitle inventory và benchmark iPhone vật lý vẫn **pending**, không dùng fixture thay nghiệm thu trên thiết bị.

## Tái hiện độc lập và cùng fixture

`backend-node/scripts/audit-timestamp-matrix.mjs` dùng `git archive` để lấy **toàn bộ backend lịch sử** của baseline và `4d0e94b`, chạy riêng hai test gốc bằng Node, không để lỗi thứ nhất che lỗi thứ hai. Sau đó import remux của từng revision, remux **cùng file MKV** cho baseline, audit trước sửa và after, cùng FFmpeg/ffprobe trong mỗi môi trường. Không sửa test lịch sử; exit lỗi được lưu làm bằng chứng, test after vẫn bắt buộc qua.

Hai file fixture được copy nguyên byte từ macOS sang Ubuntu; SHA256 giống nhau:

- Fractional Main10: `7d336dc82746269bdbe66a87a91b3aca55a56724937a1cbfe9e3075d6198f962`.
- H.264 B-frame + DTS audio + SRT: `0cf982619f9c8edb6246a8db5593d5da4d1f17f4a451c83c88d5c7078593b55d`.

| Môi trường | Node | FFmpeg | ffprobe |
|---|---|---|---|
| macOS arm64 | 24.21.0 | 6.0 static | n4.4.1 static |
| Ubuntu 24.04 amd64 (Docker, cùng gói với CI lỗi) | 24.21.0 | 6.1.1-3ubuntu5 | 6.1.1-3ubuntu5 |

Cặp macOS không đồng phiên bản, được ghi rõ thay vì che giấu. Tuy nhiên lỗi −61ms cũng tái hiện trên Ubuntu với FFmpeg/ffprobe cùng 6.1.1: **không thể quy lỗi đó cho mismatch của cặp macOS**. Khác biệt HEVC xuất hiện trên đường FFmpeg 6.1.1, có ở baseline lẫn audit; không phải regression mới do hardening. CI đã pin runner Ubuntu 24.04 và Node 24.21.0; artifact ghi phiên bản media thực tế.

Lệnh tái hiện (PATH trỏ đúng cặp binary trong bảng; CI cài gói Ubuntu):

```sh
node backend-node/tests/remux-hevc-roundtrip.test.mjs
node backend-node/tests/playback-sync-real.test.mjs
TIMESTAMP_AUDIT_DIR=/tmp/cinevn-timestamp-evidence npm run test:timestamp-matrix --prefix backend-node
```

Muốn so cùng byte giữa máy, copy thư mục `fixtures/` của matrix trước khi chạy máy thứ hai. Nếu không có, script tạo fixture mới một lần rồi dùng chung cho ba revision trên máy đó. Artifact CI giữ MKV, output HLS, raw packets và `matrix.json`; evidence commit giữ summaries/packet boundaries/args của hai máy.

## Baseline vs audit trước sửa vs after

| Phép đo | Baseline 24f7a662 | Audit 4d0e94b | After |
|---|---:|---:|---:|
| Ubuntu fractional HEVC, max relative PTS error | 41.542ms — FAIL | 41.542ms — FAIL | <0.000001ms — PASS |
| macOS fractional HEVC, cùng fixture | 0.708ms — PASS | 0.708ms — PASS | <0.000001ms — PASS |
| Phép đo subtitle gốc ở đầu phim, cả hai OS | −61ms — FAIL | −61ms — FAIL | phép đo được sửa: 0ms — PASS |
| Subtitle sau seek 197s → keyframe 194s, cả hai OS | 18ms khi đo đúng | 18ms khi đo đúng | 18ms — PASS |
| A/V content marker sau đo đúng | macOS 10/8ms; Ubuntu 10/9ms | không đổi | không đổi — PASS |

−61ms là assertion **subtitle/source clock**, không phải lệch audio với video −61ms. A/V thật nằm trong 8–10ms. Cột baseline/audit của phép đo đúng là quan sát chẩn đoán, không đổi kết quả FAIL của test gốc. Giữ nguyên ngưỡng HEVC `<2ms` và A/V/subtitle `<=60ms`.

### HEVC: lỗi remux thật, phụ thuộc toolchain

Nguồn Matroska có time base `1/1000`, 24000/1001 fps, không B-frame. FFmpeg 6.1.1 mặc định có thể đưa packet qua time base danh nghĩa trước `setts=duration=0`. Trong mẫu Ubuntu: DTS đầu output `0.041000, 0.082708, 0.082750, 0.166125`; packet thứ ba chỉ cách packet trước khoảng 42µs. Giữa segment, MOV lại phải đoán duration. Relative PTS lệch 41.542ms, dù đếm đủ packet và DTS vẫn tăng.

Chỉ `-copytb 1` chữa mẫu fractional nhưng **chưa chữa VFR**: fixture bỏ mỗi frame thứ 7 vẫn sai khoảng 41.313ms ở boundary. Bỏ `setts` cũng sai khoảng 42ms. Vì vậy bản cuối dùng riêng cho **HEVC copy, hasBFrames=0**:

```text
-copytb 1 -bsf:v setts=duration='if(isnan(NEXT_DTS),DURATION,NEXT_DTS-DTS)'
```

Dùng demuxer time base; duration lấy từ DTS thật của packet kế tiếp, packet cuối giữ duration gốc. Không đổi payload NAL hoặc PTS/DTS bằng cadence tự tạo. Regression mới kiểm tra fractional + VFR qua ba segment: PTS nguồn trong <2ms, DTS tăng, số packet giữ nguyên, audio offset trong <2ms và **framemd5 của mọi frame Main10 giống nguồn**. Đường HEVC có B-frame và H.264 không nhận filter mới. `REMUX_BUILD=10` và rendition identity riêng HEVC được đổi để không dùng lại bytes sai từ cache cũ.

### −61ms: lỗi phép đo, không bù trừ audio production

Lệnh `blackdetect/silencedetect` cũ không có `-copyts`, nên FFmpeg tự trừ `format.start_time` trước khi detector thấy timestamp. Test sau đó lại trừ presentation shift để quy về clock nguồn. Trong fixture: format start `0.061000`, video TB `1/12288`; detector chuẩn hóa 61ms theo video tick. Flash đọc được `2.02197` thay vì timestamp HLS `2.08301`. Trừ tiếp 83ms cho B-frame tạo ra −61ms giả.

Sửa **lệnh detector trong test** bằng `-copyts`. Giữ nguyên phép tính mapping production và cả hai tolerance. Matrix chạy detector cả có/không copyts trên cùng HLS, kiểm chứng chênh lệch đúng bằng format start đã làm tròn về video time base; đo flash/tone thật, không mock clock. Fixture SRT 2s và 199s, seek origin 194s, extraction tuyệt đối và reuse HLS đều được kiểm tra. Không thêm audio delay để che lỗi test.

## Kiểm thử đầy đủ

- macOS và Ubuntu: `npm test --prefix backend-node` PASS, không chỉ chạy phần còn lại sau lỗi.
- Cả hai: `npm run test:audit --prefix backend-node` PASS; `npm run test:media-audit --prefix backend-node` PASS (media thực + staging grants).
- Matrix ba revision PASS ở cả hai môi trường; test lịch sử giữ nguyên kết quả lỗi được tái hiện.
- Frontend: typecheck PASS; tests 188/188 PASS; production build PASS.
- Deploy manifests: 64/64 PASS. Đây là **test deploy**, không thực hiện deployment.
- Test HEVC/sync hiện fail rõ khi thiếu FFmpeg/x265 thay vì skip. CI cài dependency trước test; không bỏ test hoặc tăng tolerance.
- CI chạy clean `npm ci`; chạy media integration/matrix riêng, upload evidence bằng action pin SHA. Run GitHub đã hoàn tất `success`; mọi bước backend/media/frontend/typecheck/build/manifest đều `success`. Artifact `timestamp-baseline-vs-after` id `12873584067`, digest `sha256:bfa659fcb1faa49db7e5d636b071fc1ef0aabff2a68e20329a3c59387fc24d75`.

## Staging compatibility của media grants

`media-grant-staging.test.mjs`: HTTP loopback thật, production middleware + `serveRenditionAsset`, file fMP4 được encode thật. Chỉ DB được thay bằng store cô lập; không dùng fake HTTP response hoặc DB production. 7 nhóm kiểm tra PASS:

1. Native legacy manifest `?access_token=` trả 200, rewrite map/init/segment sang grant scoped, không đưa login JWT vào child URL.
2. Child không cần Authorization header: GET/HEAD 200, Range 206 và 32 byte khớp file thật.
3. Segment trần cũ trả 401; MSE Bearer có ownership vẫn 200; Bearer người khác 403.
4. Grant hết hạn 401; manifest có Bearer hợp lệ được cấp grant mới, child mới 200.
5. Grant cũ chỉ có renditionId trả 403 `GRANT_REFRESH_REQUIRED`, cần manifest/resolve mới có login. **Không tuyên bố client cũ không có khả năng refresh vẫn tương thích.**
6. Sai rendition scope 403; session hết hạn 410 dù JWT grant chưa hết hạn.
7. Proxy cache tuân thủ header không cache authorized response để phát lại cho client trần: manifest `private,no-store`; segments `private,immutable`; request trần vẫn 401.

Rà cấu hình trong repo: `deploy/lan/nginx-routes.conf` và `deploy/Caddyfile` không cấu hình shared cache cho playback; tài liệu `deploy/cloudflare/README.md` yêu cầu bypass `/api/*`. Đây là cấu hình/tài liệu trong Git, không phải xác nhận rule đang chạy trên Cloudflare.

**Giới hạn trước release:** chưa kiểm tra CDN đang triển khai hoặc ứng dụng iPhone cũ. CDN rule ép cache bất chấp `private`/bỏ query có thể vượt qua origin auth. Phải kiểm tra cấu hình và purge các object public từ bản cũ trước release; local proxy không chứng minh điều đó. Không thực hiện purge/deploy theo yêu cầu lượt này. Native client giữ manifest cũ phải refresh/re-resolve; raw segment public URL không được giữ tương thích bằng cách nới auth.

## Vẫn pending

- Progressive subtitle inventory: chưa có dữ liệu staging latency/cancellation/partial publication đầy đủ.
- Physical iPhone seek benchmark và app cài trên máy: chưa chạy; không thay bằng kết quả synthetic hoặc simulator.
- CDN edge thực tế/old-app acceptance: cần kiểm tra trước release, không tuyên bố hoàn thành từ local staging.

## Evidence

- [macOS matrix](evidence/2026-10-29-timestamps/macos.json), [Ubuntu matrix](evidence/2026-10-29-timestamps/ubuntu.json): versions, SHA256 fixtures, original-test exits, first timestamps, time bases, PTS/DTS ở boundary, FFmpeg args, marker clocks.
- [validation.json](evidence/2026-10-29-timestamps/validation.json) lưu kết quả local, từng step CI và log timestamp liên quan. Log đầy đủ backend, audit/media, frontend typecheck/tests/build và deploy tests có trong run GitHub. Raw toàn bộ packet và media synthetic nằm trong artifact CI, không chứa signed media URL hoặc credentials production.

## Cập nhật triển khai LAN sau audit

Sau khi người dùng cho phép triển khai, cả backend/frontend đã chuyển sang `8cc4ac8` và được xác minh source + health + media HTTP qua production. Xem [báo cáo LAN](2026-10-29-lan-deployment.md). Các câu “không deploy” phía trên mô tả phạm vi lượt audit trước đó. Benchmark iPhone và progressive subtitle inventory vẫn pending.
