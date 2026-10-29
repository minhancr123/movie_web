# Xác minh triển khai LAN — 29/10/2026

Người dùng đã cho phép triển khai sau audit. **Production LAN hiện chạy `8cc4ac8281c42119e755e8ed99ad6b4ecec9ef0e` ở cả backend và frontend**, kích hoạt 12:15:08 giờ Việt Nam. Không merge nhánh, không cài ứng dụng iOS. Báo cáo này là tài liệu bổ sung; không thay SHA của source đã triển khai.

## Chuẩn bị và tính toàn vẹn

- Backend cũ: `925a567ffd11c1f73794be4b3d6ef91aadebae86`; frontend cũ: `0c69b9a668233619bfad5b53507d9e1636a39024`. Đều là ancestor của bản audit.
- Checkout `~/movie_web` có thay đổi chưa commit; không reset, không ghi đè. Ba file playback trong runtime cũ khác Git cũng đã lưu diff và snapshot. Phần auto-respawn nối vào playlist cũ được thay bằng cơ chế đã audit, không chép hotpatch nguy hiểm đó trở lại.
- Archive từ đúng full SHA vào `~/cinevn-runtime/8cc4ac8281c42119e755e8ed99ad6b4ecec9ef0e/`; build trong thư mục chưa hoạt động. Giữ public assets bổ sung từ runtime frontend cũ, không ghi đè file tracked của archive.
- `verify-runtime.mjs --health`: **423 file tracked khớp Git, failures=[]**; release ID của cả ba env/runtime và hai HTTP health cùng SHA. Không chỉnh source hoặc `.next` trong release đang hoạt động.
- Cài riêng Node **24.21.0**, pin ExecStart hai service vào binary đó; không đổi Node global của các ứng dụng khác. Giữ FFmpeg/ffprobe hệ thống **n9.0.2**.
- Giữ nguyên provider keys, token encryption keys, budget/window/writer policy và cấu hình Nginx/Tunnel. Chỉ thay đường dẫn release/runtime trong service override và pin Node.

## Backup và rollback

Thư mục private trên server: `~/cinevn-deploy-backups/20261029-8cc4ac8/`.

Có env cũ, override hai service, diff checkout và các runtime hotpatch. MongoDB đã xuất BSON của **24 collections / 288 documents**, đọc-deserialize lại toàn bộ và kiểm tra số document, lưu SHA256/metadata/indexes riêng. Đây là logical backup khi DB đang hoạt động, read concern majority, **không phải point-in-time/oplog snapshot**. Không thay schema hoặc phục hồi dữ liệu production trong lượt này.

`activate.sh` có guard chống deployment song song và tự khôi phục override cũ nếu health không đạt. `rollback.sh` đã chuẩn bị và kiểm tra cú pháp; chỉ chạy khi hai service vẫn trỏ đúng release mới. **Chưa diễn tập rollback bằng cách chuyển production trở lại.** Bản cũ và dependencies vẫn được giữ nguyên.

## Kiểm thử trên chính LAN trước kích hoạt

- `npm test --prefix backend-node`: PASS toàn bộ trên Node 24.21.0 + FFmpeg 9.0.2.
- `npm run test:audit --prefix backend-node`: 4/4 PASS.
- `npm run test:media-audit --prefix backend-node`: recovery media và 7 nhóm HTTP grants PASS.
- Frontend typecheck, 188 tests, production build: PASS; standalone có đủ static/public/env.
- `/tmp` của LAN là tmpfs khoảng 8 GiB, gây test recovery trả `REMUX_NO_SPACE` trước bước EEXIST. Chạy lại bằng TMPDIR private trên SSD đang có khoảng 148 GiB trống. Không hạ disk reserve hoặc sửa assertion để qua.
- Sharp ban đầu cố dùng libvips global và build native thất bại. Cài dependencies của release mới bằng `SHARP_IGNORE_GLOBAL_LIBVIPS=1`, dùng binaries đóng gói theo [hướng dẫn chính thức của Sharp](https://sharp.pixelplumbing.com/install/). Không thay thư viện hệ thống. Endpoint tối ưu ảnh được kiểm tra HTTP 200 sau kích hoạt.

Matrix dùng lại **cùng fixture SHA256 của audit macOS/Ubuntu**, không tạo nguồn khác để so:

| FFmpeg 9.0.2 trên LAN | Baseline 24f7a662 | Audit 4d0e94b | Bản mới |
|---|---:|---:|---:|
| Max relative HEVC PTS error | 0.687ms | 0.687ms | <0.000001ms |
| A/V marker đầu / sau seek | 11 / 8ms | 11 / 8ms | 11 / 8ms |
| Subtitle sau phép đo đúng, đầu / sau seek | 0 / 18ms | 0 / 18ms | 0 / 18ms |

Lỗi HEVC 41.542ms của FFmpeg 6.1.1 và phép đo cũ −61ms **không tái hiện như vậy trên FFmpeg 9.0.2**. Kết quả này không thay thế hoặc phủ nhận matrix CI 6.1.1; nó xác nhận bản mới tương thích toolchain LAN. Log và raw matrix nằm trong backup private trên server.

## Kiểm tra sau kích hoạt

| Kiểm tra | LAN qua Nginx | HTTPS cinevn.me |
|---|---|---|
| Backend `/healthz` | 200, ready, đúng SHA | 200, ready, đúng SHA |
| Frontend `/api/health` | 200, đúng SHA | 200, đúng SHA |
| Anonymous `/api/auth/session` | 200, JSON `{}` | 200, JSON `{}` |
| Anonymous POST playback resolve | 401 | 401 |
| Trang chủ | 200 | 200, giao diện đọc được trong trình duyệt thật |
| `/_next/image` xử lý logo | 200 image/png | 200 image/png |

Logo header tải được; không có console error trên trang chủ trong lượt kiểm tra. Các thời gian quan sát qua máy client: health LAN khoảng 18–19ms, health HTTPS khoảng 292–365ms. Đây là sample readiness, **không phải TTFF/seek benchmark**.

### HLS đi qua dịch vụ production thật

Tạo fixture H.264/AAC 3 giây, một rendition và một playback session test ngắn hạn, chỉ chứa media synthetic. Không dùng account/token/key của người xem. Credential test ở memory, không log signed URL. Kiểm tra origin app, Nginx và HTTPS; sau đó xóa đúng session/rendition test đã tạo.

| Đường đi | Manifest | Init + segments | Range | Không quyền | Frame giải mã |
|---|---:|---:|---:|---:|---:|
| Backend 127.0.0.1:5001 | 200 | 4 assets, 200 | 206 | 401 | 72/72 giống nguồn |
| Nginx 127.0.0.1 | 200 | 4 assets, 200 | 206 | 401 | 72/72 giống nguồn |
| HTTPS cinevn.me | 200 | 4 assets, 200 | 206 | 401 | 72/72 giống nguồn |

- Manifest `private,no-store`; segment private. Child URL mang scoped grant, không chứa login JWT.
- Grant hết hạn trả 401; refresh với Bearer hợp lệ trả 200.
- Xóa session: grant trước đó trả 404, không tiếp tục mở được media.
- HTTPS fixture trả `CF-Cache-Status: DYNAMIC`. HEAD không credential trên **3 rendition cũ** đều trả **401, CF-Cache-Status: BYPASS**. Không phát hiện public cache bypass trong các mẫu này; không coi đây là kiểm kê mọi cache object hoặc mọi cấu hình edge.
- Không chạy TorBox speed benchmark hoặc phát trọn một phim thật trong xác minh này; kết quả là pipeline HLS thật phục vụ media synthetic qua production.

Sau khoảng 4 phút: hai service `active/running`, **NRestarts=0**, backend khoảng 94 MiB và frontend 229 MiB RAM; không thấy uncaught exception, unhandled rejection, OOM hoặc EADDRINUSE từ lúc kích hoạt. SSD còn khoảng 146 GiB trống. Không dùng số liệu idle này để kết luận năng lực 100+ người xem.

## Trạng thái còn lại

- Xác minh source và bản mới thực sự chạy trên LAN: **đã hoàn tất**.
- Physical iPhone seek benchmark / old native app acceptance: **pending**, không cài iOS trong lượt này.
- Progressive subtitle inventory: **pending**.
- Trải nghiệm phim thật với TorBox, 4K bitrate cao, nhiều người dùng và WAN: chưa được chứng nhận bằng các kiểm tra synthetic này.
