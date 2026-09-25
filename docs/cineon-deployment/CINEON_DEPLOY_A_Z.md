# Hướng dẫn triển khai và vận hành Cineon
Domain cineon.me · Ubuntu 24.04 LTS · 1 vCPU · RAM 4 GB · SSD 30 GB
Ngày rà soát 20 tháng 9 năm 2026

## 1 Kết luận và cách dùng tài liệu

Chọn Docker Compose cho ứng dụng, Caddy chạy trên host để cấp HTTPS, MongoDB ở dịch vụ bên ngoài, Redis trong VPS. Build image trên máy cá nhân hoặc CI, không build trên VPS đang phục vụ người xem. Bắt đầu bằng uptime monitor bên ngoài, log có giới hạn dung lượng và Sentry Cloud cho lỗi ứng dụng. Chưa triển khai Sentry tự host hoặc cả bộ Prometheus Grafana Loki trên VPS này.

Điểm giới hạn quan trọng nhất là một lõi CPU và mạng quốc tế 10 Mbps, không phải RAM. Ưu tiên video đi trực tiếp từ nguồn tới trình duyệt. Thông số cổng 10 Gbps không có nghĩa ứng dụng được sử dụng 10 Gbps; nhà cung cấp công bố tốc độ dịch vụ 300 Mbps và quốc tế 10 Mbps. Cần xác nhận giới hạn quốc tế áp dụng riêng từng chiều hay dùng chung và thử đúng nguồn phim thực tế.

Tài liệu dành cho chủ website tự triển khai. Thực hiện lần lượt từ mục 2 đến mục 11, sau đó thiết lập giám sát và backup. Các lệnh gắn nhãn VPS chạy trong Bash qua SSH; các lệnh gắn nhãn máy cá nhân chạy tại repo trên Windows PowerShell. Giá trị VPS_IP, DB_USER, CLUSTER và REGISTRY_USER là chỗ điền thông tin thật, không phải dữ liệu đã xác minh.

## Lộ trình thực hiện
| Giai đoạn | Việc chính | Điều kiện đi tiếp |
|---|---|---|
| Chuẩn bị | Chốt nguồn video, tài khoản dịch vụ, bản phát hành | Có đủ thông tin và quyền truy cập |
| Tối ưu | Sửa các mục P0, kiểm thử trên môi trường thử nghiệm | Test và build đạt |
| Hạ tầng | SSH, Docker, firewall, DNS, MongoDB | Chỉ mở cổng cần thiết, DB kết nối được |
| Triển khai | Pull image, chạy Compose, cấu hình Caddy | Container ổn định và HTTPS hợp lệ |
| Nghiệm thu | Auth, video, socket, tải, backup restore | Checklist đạt trên dữ liệu và thiết bị thực |
| Vận hành | Theo dõi lỗi, dung lượng, cập nhật và rollback | Có cảnh báo và có bản phục hồi đã thử |

## 2 Kiến trúc và ngân sách tài nguyên

Luồng giao diện: trình duyệt → https://cineon.me → Caddy → Next.js ở 127.0.0.1:3000.
Luồng API nghiệp vụ: trình duyệt → https://cineon.me/api → Caddy → Node.js ở 127.0.0.1:5001. Backend, worker và scheduler dùng Redis nội bộ Docker và kết nối MongoDB bên ngoài. NextAuth nằm ở frontend.

Luồng video ưu tiên: nguồn hoặc CDN → trình duyệt. VPS chỉ tìm nguồn và quản lý phiên. Luồng remux: nguồn → VPS và FFmpeg (đã tích hợp trong image backend) → người xem; luồng này tiêu tốn cả CPU, dung lượng lẫn mạng. Tắt chuyển mã video không đồng nghĩa tắt xử lý âm thanh hay remux.

Ví dụ tính tải, không phải số đo: 12 người xem video 5 Mbps qua VPS cần khoảng 60 Mbps đầu ra, chưa tính overhead. Nếu nguồn đi qua đường quốc tế 10 Mbps, chỉ hai luồng đầu vào độc lập 5 Mbps đã chạm mức danh nghĩa. Dùng chung một rendition giảm số writer nhưng mỗi người xem vẫn cần băng thông đầu ra. Thêm RAM hoặc bật Cloudflare không tự giải quyết điểm nghẽn này.

| Thành phần | Giới hạn | Ghi chú |
|---|---|---|
| Backend và FFmpeg | 1280m | Node heap 512 MiB, một writer remux, tích hợp sẵn FFmpeg |
| Frontend | 768m | Node heap 512 MiB, một instance |
| Redis | 512m | noeviction policy, Dataset maxmemory 256 MB, dùng cho queue và cache |
| Worker | 256m | Không nhân nhiều worker lúc đầu |
| Scheduler | 192m | Chỉ một scheduler |
| Tổng container | 3008 MiB | Phần còn lại cho OS, Caddy và page cache |

Đây là mức khởi đầu để đo, không phải bảo đảm ứng dụng vừa bộ nhớ. Theo dõi OOMKilled và đỉnh RSS khi phát phim. Không ép tổng CPU quota của từng container khiến tác vụ nhàn rỗi không nhường được CPU cho tác vụ cần thiết. CPU vẫn chỉ có một lõi dùng chung.

Với SSD 30 GB, đặt ngân sách cache transcode 3 GB và rendition 3 GB, giới hạn log khoảng 30 MB mỗi container và giữ ít nhất 6 GB trống. Image mới và image rollback cũng cần chỗ. Các biến cache là chính sách dọn dữ liệu, không phải disk quota: phiên đang được xem có thể giữ dung lượng vượt ngân sách. Giảm tiếp hoặc chuyển luồng video ra ngoài nếu dung lượng tăng liên tục. Không lưu thư viện phim trên ổ này.

## 3 Danh sách tối ưu trước khi triển khai

**P0 Các mục phải xử lý trước khi mở website công khai**

1. **Xử lý tài khoản quản trị:** Hàm `createDefaultAdmin` cũ đã bị thay thế. Sử dụng script `node scripts/bootstrap-admin.mjs` với biến môi trường `ADMIN_EMAIL` và `ADMIN_PASSWORD`. Backend dùng hàm `bootstrapAdmin()` với `$setOnInsert` để khởi tạo an toàn và idempotent, tránh tạo mật khẩu cố định như trước.
2. **Nâng Node và Next:** Hiện tại hệ thống dùng Node 24, Next 16, và React 19. Các file `backend-node/Dockerfile` và `frontend/Dockerfile` đã cấu hình dùng Node 24 slim, user không phải root (`cineon`), `tini` làm PID 1 và đã có sẵn FFmpeg.
3. **Redis noeviction:** Đảm bảo chính sách maxmemory của Redis là `noeviction` (không dùng allkeys-lru). Repo dùng một Redis cho queue và cache, do đó cần noeviction để bảo vệ job.
4. **Cấu hình môi trường:** Dùng file `.env` từ `.env.prod.example` thay cho các file rời rạc trước đây. Không còn sử dụng thư mục `kit/`. Các service được định cấu hình bằng `docker-compose.prod.yml`.
5. **Cổng kiểm thử trên máy phát triển hoặc CI:** Chạy npm test và build bình thường bằng Node 24. CI đã có sẵn workflow typecheck và unit test.

**P1 Hiệu năng và chất lượng bản phát hành**
- Giữ output standalone của Next.js.
- Rate limit hợp lý.
- Đảm bảo Graceful shutdown: sử dụng deadline 40s và có heartbeat cho workers theo đúng file triển khai mới.

## 4 Chuẩn bị tài khoản và thông tin

| Mục | Giá trị hoặc việc cần chuẩn bị |
|---|---|
| Domain | cineon.me và media.cineon.me, quyền chỉnh DNS |
| VPS | Ubuntu 24.04 LTS đã được cài, IPv4 thật |
| Registry | Tài khoản Docker Hub hoặc registry riêng |
| MongoDB | Cluster ngoài VPS, user database, IP allowlist |
| Catalog | TMDB read token hoặc API key hợp lệ |
| Nguồn phát | Tài khoản nguồn đang dùng |
| Backup | Nơi lưu ngoài VPS, người giữ khóa |

## 5 Chuẩn bị Ubuntu và SSH

Máy cá nhân trong PowerShell:
```powershell
ssh-keygen -t ed25519 -C "cineon-deploy"
ssh root@VPS_IP
```

VPS với tài khoản có sudo:
```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y ca-certificates curl gnupg git unzip ufw htop sysstat dnsutils openssl python3
sudo adduser deploy
sudo usermod -aG sudo deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
sudo nano /home/deploy/.ssh/authorized_keys
sudo chown deploy:deploy /home/deploy/.ssh/authorized_keys
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Bật firewall UFW:
```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

## 6 Cài Docker Engine và Compose

Cài Docker bản chính thức trên Ubuntu 24.04:
```bash
sudo install -d -m 0755 /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
ARCH=$(dpkg --print-architecture)
echo "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker deploy
```
Đăng xuất rồi đăng nhập lại để quyền docker có hiệu lực.
Tạo thư mục dự án: `sudo install -d -m 750 -o deploy -g deploy /opt/cineon`

## 7 DNS cho cineon me và MongoDB

Tạo A record cho `@`, `www`, `media` trỏ về IP VPS.
Tạo database user cho MongoDB, cho phép IP VPS trong Network Access. Đưa URI vào `.env`.

## 8 Build và đưa bộ cấu hình lên VPS

Workflow CI/CD hiện tại sử dụng `.github/workflows/ci.yml` và `.github/workflows/deploy.yml` với SHA-pinned actions và digest-locked images. Build Docker image từ `backend-node/Dockerfile` và `frontend/Dockerfile` (không nằm trong `kit/`).

Chuẩn bị file môi trường trên VPS tại `/opt/cineon`:
Sao chép `.env.prod.example` thành `.env` và điền thông tin thật.
Đảm bảo định nghĩa rõ `${BACKEND_IMAGE:?}` và `${FRONTEND_IMAGE:?}` cho compose file.

## 9 Chạy ứng dụng trong mạng nội bộ trước

Sử dụng tool deploy chuẩn bằng Python thay vì shell script:
```bash
python3 deploy/ops.py provision
python3 deploy/ops.py deploy
python3 deploy/ops.py status
```

Thay vì file health check liveness đơn giản, kiểm tra readiness qua:
```bash
curl -fsS http://127.0.0.1:5001/healthz
curl -fsS http://127.0.0.1:3000/api/health
```
`/healthz` sẽ probe MongoDB và Redis với 1.5s timeout.

Bootstrap admin an toàn bằng script:
```bash
ADMIN_EMAIL="admin@cineon.me" ADMIN_PASSWORD="your-strong-password" docker compose -f docker-compose.prod.yml exec backend-node node scripts/bootstrap-admin.mjs
```

## 10 Cài Caddy và bật HTTPS

Caddy được định nghĩa tại `deploy/caddy/Caddyfile`, xử lý cả `cineon.me` và `media.cineon.me` với các security headers.
Cài Caddy:
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt update
sudo apt install -y caddy
```
Copy Caddyfile và reload:
```bash
sudo cp /opt/cineon/deploy/caddy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 11 Nghiệm thu trước khi mời người dùng

Kiểm tra:
- Trang chủ và HTTPS (không mixed content)
- /api/health và /healthz phản hồi OK
- Đăng nhập admin vừa bootstrap thành công
- Các endpoint NextAuth và API riêng tư chặn truy cập trái phép.
- Chạy thử video.
- Chặn cổng mạng 3000, 5001, 6379 không được phép gọi từ ngoài.

## 12 Sentry Grafana và bộ DevOps nên dùng

- Sentry được cấu hình qua `backend-node/services/observability/sentry.js` (redaction-first) và `frontend/src/lib/sentry.ts`.
- Thu thập metrics sử dụng prom-client tại endpoint `/metrics`.
- Dùng Uptime monitor bên ngoài, Sentry Cloud và GitHub Actions (đã có sẵn `ci.yml`, `deploy.yml`).

## 13 Backup và thử phục hồi

Sử dụng công cụ backup Python tích hợp:
```bash
python3 deploy/ops.py backup
python3 deploy/ops.py restore <backup-file>
```
Hoặc bash script trực tiếp `bash deploy/backup.sh`. Dữ liệu sẽ dùng cấu hình `io.database_name` từ config file chứ không hardcode movieweb.
Backup môi trường, file `.env`, Caddyfile và MongoDB ra ngoài VPS.

## 14 Cập nhật và rollback một bản phát hành

Cập nhật qua GitHub Actions tự động (`deploy.yml`) hoặc bằng tay với lệnh:
```bash
python3 deploy/ops.py deploy
```
Công cụ ops tự xử lý graceful shutdown 40s và đảm bảo heartbeat worker không bị ngắt ngang mà được đợi đến khi xong task hoặc timeout. Rollback đơn giản bằng cách đổi version image trong `.env` và chạy lại lệnh deploy.

## 15 Xử lý sự cố và lịch vận hành

| Triệu chứng | Kiểm tra trước | Hướng xử lý |
|---|---|---|
| Domain chưa mở | DNS A/AAAA, firewall UFW | Mở đúng 80/443 |
| 502 / 503 | `python3 deploy/ops.py status`, healthz | Kiểm tra trạng thái container và logs |
| Job tồn đọng | /metrics hoặc Redis ping | Kiểm tra worker |
| OOM | Xem giới hạn mem | Giảm tải, kiểm tra rò rỉ RAM |

Lệnh kiểm tra:
```bash
docker compose -f docker-compose.prod.yml logs --tail 100 backend-node
sudo journalctl -u caddy -n 100 --no-pager
```

## 16 Checklist bàn giao

- [ ] Ubuntu 24.04 đã cập nhật và SSH key hoạt động.
- [ ] 80/443 và đúng cổng SSH được mở; cổng ứng dụng chỉ ở localhost.
- [ ] DNS cineon.me và media.cineon.me trỏ đúng.
- [ ] Admin seed được tạo bằng `bootstrap-admin.mjs`, an toàn và idempotent.
- [ ] Node 24/Next 16/React 19 đang chạy.
- [ ] Image digest-locked từ CI, .env tách riêng, không lộ secret.
- [ ] Redis cấu hình `noeviction`, giới hạn bộ nhớ đúng định mức.
- [ ] Caddy load đúng Caddyfile từ `deploy/caddy/Caddyfile` với security headers.
- [ ] Endpoint `/healthz` và `/api/health` được config đúng.
- [ ] Uptime alert và Sentry Cloud sẵn sàng, redaction-first an toàn.
- [ ] Backup được thử chạy bằng `deploy/ops.py backup` và restore.
- [ ] Shutdown gracefully (40s deadline) hoạt động tốt.

## 17 Đối chiếu mã nguồn và tài liệu chính thức

- **Dockerfile**: `backend-node/Dockerfile` và `frontend/Dockerfile` sử dụng Node 24 slim, user `cineon`, tini PID 1, tích hợp sẵn FFmpeg.
- **Compose**: `docker-compose.prod.yml` sử dụng `${BACKEND_IMAGE:?}` và limit mem.
- **Script**: Không dùng `kit/` hay `deploy.sh`. Dùng `deploy/ops.py`.
- **Database**: `io.database_name` từ config, không hardcode.
- **Sentry**: File `backend-node/services/observability/sentry.js` và `frontend/src/lib/sentry.ts`.
- **Metrics**: Endpoints `/metrics`.
- **Admin**: `scripts/bootstrap-admin.mjs` với `bootstrapAdmin()` idempotent.
