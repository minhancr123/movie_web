# 🏛️ Kiến Trúc Hệ Thống MovieWeb

Tài liệu này giải thích chi tiết **nơi Redis được gọi** và **cách HLS hoạt động** trong dự án, cùng với các luồng dữ liệu đầy đủ của cả hai.

---

## Mục Lục

1. [Tổng Quan Kiến Trúc](#1-tổng-quan-kiến-trúc)
2. [Luồng Redis — Gọi Ở Đâu & Làm Gì](#2-luồng-redis--gọi-ở-đâu--làm-gì)
3. [Luồng HLS — Cách Streaming Hoạt Động](#3-luồng-hls--cách-streaming-hoạt-động)

---

## 1. Tổng Quan Kiến Trúc

```
┌─────────────────────────────────────────────────────────────────┐
│                          NGƯỜI DÙNG                             │
│                       (Trình duyệt)                             │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP / WebSocket
          ┌─────────────────▼────────────────────┐
          │        Frontend (Next.js 14)          │
          │  - Render giao diện                   │
          │  - Phát video qua HLS.js              │
          │  - Kết nối Socket.io cho chat         │
          └─────┬────────────────────┬────────────┘
                │ REST API           │ REST API / Socket.io
    ┌───────────▼──────────┐  ┌──────▼─────────────────────┐
    │  .NET Backend (C#)   │  │   Node.js Backend          │
    │  :5291               │  │   :5001                    │
    │  - Metadata phim     │  │   - Xác thực (JWT)         │
    │  - Cache với Redis   │  │   - Bình luận, yêu thích   │
    │  - Rate Limiting     │  │   - Lịch sử xem            │
    └───────────┬──────────┘  │   - Socket.io realtime     │
                │             └────────────────────────────┘
    ┌───────────▼──────────┐         │
    │       Redis          │         │ MongoDB
    │    :6379             │  ┌──────▼──────────┐
    │  - Cache dữ liệu     │  │   MongoDB       │
    │  - Rate limiting     │  │   - Users       │
    │  - Đếm lượt xem      │  │   - Comments    │
    └──────────────────────┘  │   - Favorites   │
                              └─────────────────┘
    ┌──────────────────────┐
    │   phimapi.com        │  ← Nguồn dữ liệu phim bên ngoài
    │  (External API)      │
    └──────────────────────┘
```

> **Quan trọng:** Redis **chỉ được dùng trong .NET Backend (C#)**. Node.js Backend **không dùng Redis**.

---

## 2. Luồng Redis — Gọi Ở Đâu & Làm Gì

### 2.1 Cấu Hình Redis

**File:** `backend/appsettings.json`
```json
{
  "ConnectionStrings": {
    "Redis": "localhost:6379"
  }
}
```

**File:** `backend/Program.cs` (dòng 32–49)

```csharp
var redisConnectionString = builder.Configuration.GetConnectionString("Redis");

if (!string.IsNullOrEmpty(redisConnectionString))
{
    // Dùng Redis nếu có connection string
    builder.Services.AddStackExchangeRedisCache(options =>
    {
        options.Configuration = redisConnectionString;
        options.InstanceName = "MovieWeb_"; // Tất cả key đều có prefix "MovieWeb_"
    });
}
else
{
    // Fallback sang In-Memory Cache nếu không có Redis
    builder.Services.AddDistributedMemoryCache();
}
```

> **Mọi lệnh gọi Redis đều thông qua interface `IDistributedCache`**, không gọi Redis SDK trực tiếp (ngoại trừ khi xóa toàn bộ cache).

---

### 2.2 Bảng Tổng Hợp Tất Cả Chỗ Gọi Redis

| STT | File | Chức năng | Lệnh Redis | Key mẫu | TTL |
|-----|------|-----------|------------|---------|-----|
| 1 | `Program.cs` | Rate limiting – đọc giới hạn | GET | `sys:rate_limit` | Không TTL |
| 2 | `Program.cs` | Rate limiting – đọc số request của IP | GET | `rate:127.0.0.1:202403191430` | - |
| 3 | `Program.cs` | Rate limiting – ghi số request của IP | SET + EXPIRE | `rate:{ip}:{yyyyMMddHHmm}` | 1 phút |
| 4 | `Program.cs` | Thống kê – tổng số request | GET + SET | `stats:req_total` | 30 ngày (sliding) |
| 5 | `Program.cs` | Thống kê – request theo phút | GET + SET | `stats:req_bucket:{yyyyMMddHHmm}` | 2 phút |
| 6 | `Program.cs` | Health check | SET + GET | `health-check-test` | 5 giây |
| 7 | `MovieService.cs` | Cache danh sách phim mới | GET + SET | `latest_movies_page_{page}` | 10 phút |
| 8 | `MovieService.cs` | Cache chi tiết phim | GET + SET | `movie_detail_{slug}` | 30 phút |
| 9 | `MovieService.cs` | Cache tìm kiếm | GET + SET | `search_{keyword}_{limit}` | 5 phút |
| 10 | `MovieService.cs` | Cache phim theo danh mục | GET + SET | `category_{category}_page_{page}` | 30 phút |
| 11 | `MovieService.cs` | Cache phim theo thể loại | GET + SET | `genre_{genre}_page_{page}` | 30 phút |
| 12 | `MovieService.cs` | Cache phim theo quốc gia | GET + SET | `country_{country}_page_{page}` | 30 phút |
| 13 | `MovieService.cs` | Xóa cache theo key | DEL | _(key bất kỳ)_ | - |
| 14 | `MovieService.cs` | Xóa toàn bộ cache | FLUSHDB | _(tất cả)_ | - |
| 15 | `MovieService.cs` | Đếm lượt xem phim | GET + SET | `view_count:{slug}` | 30 ngày (sliding) |
| 16 | `MovieService.cs` | Tổng lượt xem toàn hệ thống | GET + SET | `stats:total_views` | Không TTL |
| 17 | `MovieService.cs` | Cấu hình rate limit động | SET | `sys:rate_limit` | Không TTL |
| 18 | `MovieService.cs` | Đọc giới hạn rate limit | GET | `sys:rate_limit` | - |
| 19 | `MovieService.cs` | Ước tính người dùng hoạt động | GET | `stats:req_bucket:{yyyyMMddHHmm}` | - |

---

### 2.3 Luồng Request API Đầy Đủ (Có Redis)

```
Người dùng gửi GET /api/movies/latest?page=1
          │
          ▼
┌─────────────────────────────────────────────────────┐
│                 RATE LIMIT MIDDLEWARE                │
│  (Program.cs – áp dụng cho mọi endpoint /api/*)     │
│                                                     │
│  1. Lấy IP từ X-Forwarded-For hoặc RemoteIpAddress  │
│  2. Redis GET "sys:rate_limit"                      │
│     → Nếu không có, dùng giới hạn mặc định: 200    │
│  3. Redis GET "rate:{ip}:{yyyyMMddHHmm}"            │
│     → Đọc số request của IP trong phút hiện tại    │
│  4. Nếu count >= limit → trả 429 Too Many Requests │
│  5. Redis SET "rate:{ip}:{...}" = count+1 (TTL 1m) │
│  6. Redis GET/SET "stats:req_total" (tổng cộng dồn)│
│  7. Redis GET/SET "stats:req_bucket:{...}" (theo phút)│
└─────────────────────┬───────────────────────────────┘
                      │ (Không bị chặn, tiếp tục)
                      ▼
┌─────────────────────────────────────────────────────┐
│              MOVIE CONTROLLER                       │
│  → Gọi MovieService.GetLatestMovies(page: 1)       │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│              MOVIE SERVICE                          │
│                                                     │
│  1. Redis GET "latest_movies_page_1"               │
│     ┌── Cache HIT ──────────────────────────────┐  │
│     │   → Trả ngay JSON đã cache (nhanh ~1ms)  │  │
│     └───────────────────────────────────────────┘  │
│     ┌── Cache MISS ─────────────────────────────┐  │
│     │   → HTTP GET phimapi.com/danh-sach/...   │  │
│     │   → Nhận JSON từ API bên ngoài           │  │
│     │   → Redis SET "latest_movies_page_1"     │  │
│     │     (TTL = 10 phút)                      │  │
│     │   → Trả JSON cho controller              │  │
│     └───────────────────────────────────────────┘  │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
               Trả JSON về Frontend
```

---

### 2.4 Luồng Đếm Lượt Xem

```
Người dùng mở trang xem phim /xem-phim/{slug}
          │
          ▼
Frontend gọi POST /api/movies/{slug}/view
          │
          ▼
MovieService.IncrementViewCount(slug)
  1. Redis GET "view_count:{slug}"            → lấy số cũ
  2. count = count + 1
  3. Redis SET "view_count:{slug}" = count    (TTL sliding 30 ngày)
  4. Redis GET "stats:total_views"            → lấy tổng cũ
  5. Redis SET "stats:total_views" = total+1  (không TTL)
  6. Trả về số lượt xem mới
```

---

### 2.5 Luồng Health Check

```
Docker gọi GET /health (mỗi 30 giây)
          │
          ▼
  1. Redis SET "health-check-test" = "ok"  (TTL 5s)
  2. Redis GET "health-check-test"
  3. Nếu giá trị = "ok" → trả { status: "healthy", redis: "connected" }
  4. Nếu khác           → trả { status: "degraded",  redis: "disconnected" } HTTP 503
  5. Nếu exception      → trả { status: "unhealthy",  redis: "error" }       HTTP 503
```

---

### 2.6 Xóa Cache

```csharp
// Xóa một key cụ thể
await _cache.RemoveAsync("movie_detail_avengers");  // Redis DEL

// Xóa toàn bộ cache (chỉ Redis)
using var redis = ConnectionMultiplexer.Connect(redisConnString);
var server = redis.GetServer(redis.GetEndPoints().First());
await server.FlushDatabaseAsync();  // Redis FLUSHDB
```

> **Lưu ý:** `FlushDatabaseAsync()` là thao tác duy nhất **không dùng `IDistributedCache`** mà gọi Redis SDK trực tiếp qua `ConnectionMultiplexer`, vì interface `IDistributedCache` không hỗ trợ flush toàn bộ.

---

## 3. Luồng HLS — Cách Streaming Hoạt Động

### 3.1 HLS Là Gì?

**HLS (HTTP Live Streaming)** là giao thức phát video được Apple phát triển. Thay vì tải cả file video, HLS:

1. Chia video thành các **đoạn nhỏ** (.ts segments, thường 2–10 giây/đoạn)
2. Tạo file **playlist** (`.m3u8`) liệt kê các đoạn đó
3. Hỗ trợ nhiều mức chất lượng (360p / 720p / 1080p) — gọi là **Adaptive Bitrate (ABR)**

```
master.m3u8 (playlist chính)
  ├── 360p/index.m3u8
  │     ├── seg001.ts
  │     ├── seg002.ts
  │     └── ...
  ├── 720p/index.m3u8
  │     ├── seg001.ts
  │     └── ...
  └── 1080p/index.m3u8
        ├── seg001.ts
        └── ...
```

---

### 3.2 Các File Liên Quan Đến HLS

| File | Vai trò |
|------|---------|
| `frontend/src/components/VideoPlayer.tsx` | Component chính – khởi tạo và điều khiển HLS.js |
| `frontend/src/components/WatchSection.tsx` | Wrapper – chọn player embed hay HLS, truyền `m3u8Url` |
| `frontend/src/components/LiveVideoPlayer.tsx` | Player cho phim chiếu rạp / live stream |
| `frontend/src/components/MovieCard.tsx` | Preview thumbnail dùng HLS |
| `frontend/src/components/EmbedPlayer.tsx` | Player nhúng dự phòng (HTML5 video với src m3u8) |
| `frontend/src/app/xem-phim/[slug]/page.tsx` | Server Component – fetch dữ liệu, lấy `link_m3u8` |
| `frontend/src/lib/api.ts` | Kiểu dữ liệu: `link_m3u8: string` trong `EpisodeData` |

---

### 3.3 Luồng Từ Khi Người Dùng Mở Trang Xem Phim

```
1. Người dùng truy cập: /xem-phim/avengers?tap=tap-1
            │
            ▼
2. Next.js Server Component (xem-phim/[slug]/page.tsx)
   - Gọi .NET backend: GET /api/movies/avengers
   - Nhận MovieDetail gồm mảng episodes[]
   - Mỗi episode có: { name, slug, link_embed, link_m3u8 }
   - Tìm episode "tap-1", lấy link_m3u8 = "https://...master.m3u8"
            │
            ▼
3. Render <WatchSection>
   - Props: embedUrl, m3u8Url="https://...master.m3u8", movie, episode
   - Mặc định dùng playerType='direct' nếu có m3u8Url (HLS)
            │
            ▼
4. WatchSection render <VideoPlayer src={m3u8Url} />
            │
            ▼
5. VideoPlayer – useEffect khởi tạo HLS.js
   (xem chi tiết ở mục 3.4)
```

---

### 3.4 Luồng Khởi Tạo HLS.js Trong VideoPlayer

```
useEffect chạy khi src thay đổi
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│  Kiểm tra: Hls.isSupported()?                          │
│  (Trình duyệt có hỗ trợ Media Source Extensions?)      │
└──────────┬───────────────────────────┬──────────────────┘
           │ CÓ (Chrome, Firefox...)    │ KHÔNG
           ▼                           ▼
┌──────────────────────┐   ┌─────────────────────────────┐
│  Khởi tạo HLS.js     │   │  Thử native HLS (Safari)    │
│                      │   │  video.canPlayType(          │
│  const hls = new Hls │   │    'application/vnd.apple.  │
│  ({                  │   │     mpegurl')                │
│    enableWorker: true│   │                             │
│    lowLatencyMode:   │   │  CÓ (Safari iOS/macOS)      │
│      true            │   │  → video.src = m3u8Url      │
│  });                 │   │  → video.play() khi loaded  │
│                      │   │                             │
│  hls.loadSource(src) │   │  KHÔNG                      │
│  hls.attachMedia(    │   │  → setError("Trình duyệt    │
│    videoElement)     │   │    không hỗ trợ HLS")       │
└──────────┬───────────┘   └─────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│  Sự kiện MANIFEST_PARSED                                │
│  (HLS.js đã tải và phân tích xong file .m3u8)           │
│                                                         │
│  1. hls.levels = [                                      │
│       { height:1080, width:1920, bitrate:4000000 },     │
│       { height:720,  width:1280, bitrate:2000000 },     │
│       { height:360,  width:640,  bitrate:800000  }      │
│     ]                                                   │
│  2. Map sang qualityOptions với label "1080p"/"720p"... │
│  3. Sort theo resolution giảm dần                       │
│  4. setCurrentQuality(-1) → chế độ Auto                │
│  5. Khôi phục vị trí xem dang dở từ lịch sử           │
│  6. video.play()                                        │
└──────────────────────────────────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────────┐
│  HLS.js tự động chọn chất lượng (ABR):                  │
│  - Đo băng thông mạng liên tục                          │
│  - Tự nâng/hạ chất lượng để tránh buffering            │
│  - Người dùng có thể chọn thủ công qua Settings        │
└──────────────────────────────────────────────────────────┘
```

---

### 3.5 Xử Lý Lỗi HLS

```
hls.on(Hls.Events.ERROR, (event, data) => {
    if (data.fatal) {
        switch (data.type) {
            case NETWORK_ERROR:
                hls.startLoad();        // Thử tải lại segment
                break;
            case MEDIA_ERROR:
                hls.recoverMediaError();// Khôi phục decoder
                break;
            default:
                hls.destroy();          // Lỗi không phục hồi được
                setError("Không thể phát video này.");
        }
    }
    // Lỗi không fatal: HLS.js tự xử lý
});
```

---

### 3.6 Luồng Chuyển Đổi Chất Lượng

```
Người dùng click Settings → chọn "720p"
          │
          ▼
changeQuality(qualityIndex = 1)  // index trong hls.levels[]
          │
          ▼
hlsRef.current.currentLevel = 1
// HLS.js dừng tải segment chất lượng hiện tại
// Bắt đầu tải segment 720p tiếp theo
// Video tiếp tục phát liền mạch (không reset)
          │
          ▼
setCurrentQuality(1)  // Cập nhật UI hiển thị "720p"
```

**Chọn Auto (index = -1):** HLS.js tự quyết định chất lượng dựa trên băng thông đo được.

---

### 3.7 Luồng Lưu Lịch Sử Xem

```
setInterval mỗi 10 giây:
          │
          ▼
saveProgress()
  1. Đọc video.currentTime (vị trí hiện tại, giây)
  2. Nếu > 5 giây (tránh lưu khi mới vào):
     a. addToHistory() → lưu vào LocalStorage (offline)
        { slug, currentEpisode, progress, duration, timeSaved }
     b. watchHistoryAPI.add() → sync lên Node.js backend (online)
        { movieSlug, episode, currentTime }
          │
          ▼
Lần sau người dùng mở lại phim:
  - Trong MANIFEST_PARSED: đọc history từ localStorage
  - Nếu tìm thấy slug + episode khớp → video.currentTime = saved.progress
  - Video tiếp tục từ điểm đã xem
```

---

### 3.8 Luồng Preview Thumbnail Trong MovieCard

```
Người dùng hover vào MovieCard
          │
          ▼
useEffect chạy (MovieCard.tsx)
  1. Lấy link_m3u8 của tập đầu tiên
  2. Kiểm tra Hls.isSupported()
  3. const hls = new Hls()
  4. hls.loadSource(m3u8Url)
  5. hls.attachMedia(videoElement – muted, autoplay, loop)
  6. Video preview phát im lặng khi hover

Người dùng rời hover:
  → hls.destroy() – giải phóng tài nguyên
```

---

### 3.9 Sơ Đồ Tổng Hợp Luồng HLS

```
phimapi.com
  └─ link_m3u8: "https://cdn.example.com/avengers/master.m3u8"
        │
        │ (lưu trong .NET cache Redis 30 phút)
        │
        ▼
.NET Backend /api/movies/avengers
        │
        │ JSON { episodes: [{ link_m3u8: "..." }] }
        │
        ▼
Next.js Server Component (page.tsx)
        │
        │ props: m3u8Url
        │
        ▼
WatchSection.tsx
        │ (chọn HLS player nếu có m3u8Url)
        │
        ▼
VideoPlayer.tsx
  ├── new Hls({ enableWorker: true, lowLatencyMode: true })
  ├── hls.loadSource("https://cdn.example.com/avengers/master.m3u8")
  ├── hls.attachMedia(<video>)
  │
  │ [MANIFEST_PARSED]
  ├── Đọc hls.levels → [1080p, 720p, 360p]
  ├── Render Quality Selector UI
  ├── Khôi phục vị trí xem dang dở
  └── video.play()
        │
        │ [Đang phát]
        ├── ABR: tự chọn chất lượng theo băng thông
        ├── Lưu lịch sử mỗi 10 giây
        └── Xử lý lỗi & tự phục hồi
```

---

## Tóm Tắt Nhanh

### Redis

- **Dùng ở đâu:** Chỉ trong **.NET Backend (C#)**
- **Gọi như thế nào:** Qua interface `IDistributedCache` (ẩn chi tiết Redis)
- **Mục đích chính:** Cache kết quả API, rate limiting theo IP, đếm lượt xem, thống kê

### HLS

- **Dùng ở đâu:** Chỉ trong **Frontend (Next.js)**
- **Thư viện:** `hls.js` (cho Chrome/Firefox), native HLS (cho Safari)
- **Mục đích chính:** Phát video chất lượng cao với tự động điều chỉnh theo băng thông, hỗ trợ chọn chất lượng thủ công và lưu tiến trình xem
