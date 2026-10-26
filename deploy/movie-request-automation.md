# Tự xử lý yêu cầu phim

Bật `MOVIE_REQUEST_AUTOMATION_ENABLED=true` trong môi trường backend rồi khởi động lại dịch vụ. Worker chạy mỗi 15 giây, dùng khóa MongoDB để tránh hai tiến trình cùng xử lý.

Trong **Admin → Yêu cầu phim**, yêu cầu đang chờ được xác định đúng phim bằng TMDB, tìm qua các addon đã cấu hình và các cầu nối Vietsub hiện có. Ưu tiên nguồn TorBox đã cache, tiếp đến Vietsub, cuối cùng nguồn chưa cache có dung lượng xác định không quá 20 GiB. Download mới diễn ra trên TorBox, không tải cả phim xuống máy chủ CineVN.

- Mỗi lần chỉ một tác vụ tải nền do worker quản lý; tối đa ba lần gửi tải mới trong 24 giờ. Không giới hạn các lượt phát hay thao tác thủ công trên TorBox.
- Không có nguồn: tìm lại sau 6 giờ. Lỗi dịch vụ: thử lại sau 5 phút. Tải đang chạy: kiểm tra sau 30 giây; không tiến triển 30 phút thì thử nguồn khác ở lượt sau.
- Nút **Tìm lại ngay** đưa yêu cầu về hàng đợi; **Tạm dừng tự xử lý** dừng worker xử lý yêu cầu, không xóa/dừng torrent dùng chung trên TorBox.
- Phim bộ cần xác định mùa/tập. Trùng tên hoặc không xác định được đúng phim thì cần quản trị viên chọn kết quả TMDB.
- Chỉ hoàn tất sau khi chọn đúng file theo tên/năm, đọc được dữ liệu và ffprobe xác nhận video, âm thanh, thời lượng hợp lý. Đây không phải kiểm tra toàn bộ phim hoặc chứng nhận mọi thiết bị phát được.
- Nguồn đã kiểm tra được lưu trong thư viện riêng theo tài khoản TorBox và tham gia luồng tìm nguồn thật. Không lưu link phát tạm thời hay API key vào tác vụ.
- Thông báo trong CineVN được gửi một lần cho mỗi người tham gia yêu cầu, có thử lại nếu ghi thông báo thất bại.

Các collection: `movie_requests`, `movie_request_jobs`, `movie_request_downloads`, `request_worker_locks`, `requested_sources`, `notifications`. Không xóa yêu cầu khi chưa tìm ra nguồn. Hệ thống không thể tạo nguồn cho phim chưa có trong các dịch vụ đang kết nối.

Kiểm tra: `npm test --prefix backend-node`, `npm test --prefix frontend`, `npm run build --prefix frontend`. Theo dõi log có tiền tố `[movie-requests]`; chỉ ghi mã lỗi, không ghi key hoặc link phát.
