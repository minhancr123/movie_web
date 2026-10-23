# Kiểm thử bản sửa dc0ab38 — 2026-10-23

Code đã push lên nhánh `codex/lan-server-readiness`.

- Backend: toàn bộ suite qua, gồm 6 ca mới về Range GET, ffprobe concurrent/cache/TTL, stage timing, adapter dispatch/unsupported codecs, telemetry validation/dedup và endpoint metrics nội bộ.
- Frontend: 110 ca qua (108 cũ + 2 mới); production build qua trên macOS và Linux.
- Chạy lại 16 kịch bản regression của báo cáo e60848c: **16/16 đạt**. File kết quả đi kèm. Chỉ điều chỉnh phép đọc dashboard để chấp nhận JSON import trực tiếp, thay cho wrapper API cũ.
- Promtool: cấu hình scrape hợp lệ, 4 alert rules hợp lệ.
- Không đổi mặc định HLS 4 giây; chưa có thử nghiệm A/B trên người xem thật để kết luận 2 giây tốt hơn.
- Discovery/ranking hiện đi qua orchestrator. Ownership, Mongo sessions và delivery vẫn giữ trong controller; chưa chuyển toàn bộ controller 4.000 dòng.
- Prometheus chạy nội bộ; kết nối Grafana Cloud và gửi email cần remote_write/alert routing riêng. Không tuyên bố cảnh báo email đã hoạt động.

Không dùng API key hay URL phim thật trong bài regression. Chưa có xác nhận hình ảnh trực tiếp từ phiên Brave của người dùng.

## Phát hiện khi kiểm tra sau triển khai

Backend 5001 từng do tiến trình chạy thủ công PID 624182 giữ, ngoài cgroup systemd.
Dịch vụ chính gặp EADDRINUSE nhưng handler uncaughtException chỉ log, khiến systemd
báo active dù tiến trình đó không phục vụ HTTP. Đã dừng đúng tiến trình thừa.
Bổ sung listenHttpServer để lỗi bind reject startup và thoát 1, health trả release,
đồng thời giới hạn vòng lặp restart ở 6 lần/5 phút. Có test giữ cổng thật rồi thử
bind trùng; startup phải reject EADDRINUSE.

Acceptance trên server với phiên kiểm thử ngắn hạn (đã xóa): chưa đăng nhập 401,
phiên khác chủ 404, payload âm 400, chủ phiên 204, gửi lại event 204 không đếm lại.
Metrics nội bộ 200, public 404. Prometheus target `cinevn` báo `up`, lastError rỗng.
Không gửi first-frame hoặc giây xem giả vào thống kê; bài acceptance dùng summary 0.

Prometheus lúc kiểm tra dùng khoảng 25 MiB RAM, giới hạn 384 MiB và 0,5 CPU.
Không cần restart cả máy.
