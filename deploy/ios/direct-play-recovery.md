# iOS: phục hồi khi Direct Play lỗi

Source app nằm ngoài Git tại `Documents/CineVN-IOS`. Patch đi kèm lưu thay đổi so với bản trước sửa; áp dụng từ thư mục source con `CineVN-IOS` bằng `patch -p1 < direct-play-recovery.patch`.

- Khi AVPlayer báo lỗi Direct, app xin link mới một lần qua POST `/api/playback/session/:id/refresh` (8 giây).
- Backend bỏ qua cache URL cho endpoint này; vẫn kiểm tra đăng nhập và chủ phiên.
- Nếu cấp link thất bại hoặc link mới tiếp tục lỗi, tự chuyển remux một lần khi chế độ tự phục hồi được bật. Nút Thử lại bắt đầu lượt phục hồi mới.
- Giữ đích đang xem kể cả khi item mới chưa ready; giữ cùng nguồn/tập/âm thanh khi remux.
- Không hiện thẻ lỗi đè lên tiến trình phục hồi. Hủy tác vụ khi đóng player.
- Resolve remux giới hạn 30 giây, không xoay vòng tự động vô hạn.

Kiểm tra: archive Release có ký; test backend `link-expiry.test.mjs` xác nhận cache cũ không được trả lại khi refresh. Cần thử thêm trên iPhone với chính nguồn từng lỗi để xác nhận đường mạng thiết bị; đọc prefix từ server không thay thế kiểm tra đó.
