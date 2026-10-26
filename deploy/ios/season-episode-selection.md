# Chọn mùa rồi chọn tập trên iOS

Source iOS hiện nằm ngoài Git ở `Documents/CineVN-IOS`. Patch lưu thay đổi trên
baseline sau direct-play-recovery; áp dụng từ thư mục con `CineVN-IOS` bằng
`patch -p1 < season-episode-selection.patch`. Không áp dụng lại trên source đã sửa.

- Trang chi tiết đã có danh sách mùa; chuyển mùa chỉ nạp tập, không gọi resolve.
  Chọn một tập trước khi dùng nút phát/chọn nguồn. Xóa token nguồn/âm thanh cũ.
- Panel tập trong player nay có chọn mùa. Mùa đang duyệt là state riêng của panel,
  không thay mùa của phiên đang phát. Chỉ bấm tập mới gửi resolve với mùa/tập đó.
- Đổi mùa khi phát tập mới không giữ source token hoặc audio index của mùa cũ.
  State phim/tập chỉ cập nhật sau khi resolve thành công.
- Tải danh sách có xử lý lỗi/thử lại, bỏ kết quả cũ khi chuyển mùa nhanh; cache theo
  đúng số mùa thay vì đọc selectedSeason sau khi request trả về.
- Khi mở lại panel, đọc mùa đang phát từ currentEpisodeInfo và tải đúng inventory.

Kiểm tra: archive Release có ký thành công. Frontend có kiểm thử đường chuyển mùa
không chứa e/restart; trang chọn tập không gắn PlaybackSection nên không tự resolve.
