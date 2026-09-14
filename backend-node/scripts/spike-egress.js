#!/usr/bin/env node
/**
 * Task 0 — egress spike.
 *
 * Answers one question that decides the whole cost model of Phase 2:
 * is a TorBox download link usable from a machine other than the one that
 * asked for it?
 *
 *   Link works elsewhere  -> the browser pulls bytes straight from TorBox.
 *                            Our server only serves manifests. Egress ~ 0.
 *   Link is IP-locked     -> every byte must pass through our gateway.
 *                            One 4K stream is roughly 9 GB/hour.
 *
 * Run it in two steps, from two different networks:
 *
 *   1. On the dev box (has TORBOX_API_KEY):
 *        node scripts/spike-egress.js issue
 *      It prints a probe command. It never prints the API key.
 *
 *   2. On another machine / phone hotspot / VPS:
 *        node scripts/spike-egress.js probe "<url>"
 *      or the curl equivalent it prints.
 *
 * `probe` needs no credentials, so the link can be carried to any network.
 */

import 'dotenv/config';

const TORBOX_API = (process.env.TORBOX_BASE_URL || 'https://api.torbox.app/v1/api').replace(/\/+$/, '');
const RANGE_BYTES = 1048576; // 1 MiB is enough to prove a Range read works.

const die = (message) => {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
};

/** Never let the key reach stdout/stderr, even inside an error message. */
const scrub = (text, secret) =>
  secret ? String(text).split(secret).join('<TORBOX_API_KEY>') : String(text);

const api = async (path, key, params = {}) => {
  const url = new URL(`${TORBOX_API}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: controller.signal,
    });
    const body = await res.text();
    let json = null;
    try {
      json = JSON.parse(body);
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      die(`TorBox ${path} trả về ${res.status}: ${scrub(body.slice(0, 300), key)}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
};

/* --------------------------------------------------------------- issue step */

const issue = async () => {
  const key = (process.env.TORBOX_API_KEY || '').trim();
  if (!key || /your_|_here|placeholder/i.test(key)) {
    die(
      'TORBOX_API_KEY chưa được đặt trong backend-node/.env.\n' +
        '    Lấy key ở https://torbox.app/settings rồi chạy lại.'
    );
  }

  console.log('→ Đang lấy danh sách torrent trong tài khoản TorBox…');
  const list = await api('/torrents/mylist', key, { bypass_cache: 'true' });
  const torrents = (list?.data || []).filter((t) => t.download_finished && t.download_present);

  if (!torrents.length) {
    die(
      'Tài khoản TorBox không có torrent nào đã tải xong.\n' +
        '    Thêm một torrent bất kỳ (phim nhỏ cũng được) rồi chạy lại.'
    );
  }

  // Biggest finished file: closest to a real 4K read pattern.
  let best = null;
  for (const torrent of torrents) {
    for (const file of torrent.files || []) {
      if (!best || (file.size || 0) > best.file.size) best = { torrent, file };
    }
  }
  if (!best) die('Không tìm thấy file nào trong các torrent đã tải xong.');

  const gib = (best.file.size / 1024 ** 3).toFixed(2);
  console.log(`→ Chọn: ${best.file.short_name || best.file.name} (${gib} GiB)`);
  console.log(`  torrent_id=${best.torrent.id} file_id=${best.file.id}`);

  console.log('→ Đang xin download link…');
  const link = await api('/torrents/requestdl', key, {
    token: key,
    torrent_id: best.torrent.id,
    file_id: best.file.id,
    redirect: 'false',
  });

  const url = link?.data;
  if (!url || typeof url !== 'string') {
    die(`TorBox không trả về link: ${scrub(JSON.stringify(link).slice(0, 300), key)}`);
  }

  // The link itself is the credential for these bytes. It is short-lived and
  // carries no account token, so it is safe to move to another machine.
  console.log('\n── Link đã lấy được ────────────────────────────────────────────');
  console.log(url);
  console.log('────────────────────────────────────────────────────────────────');
  console.log('\nBước 2 — chạy TỪ MÁY/MẠNG KHÁC (4G hotspot, VPS, máy bạn bè):\n');
  console.log(`  node scripts/spike-egress.js probe "${url}"\n`);
  console.log('hoặc bằng curl:\n');
  console.log(`  curl -sS -o NUL -D - -r 0-${RANGE_BYTES - 1} "${url}"\n`);
  console.log('Đọc kết quả:');
  console.log('  206 Partial Content  → link dùng được ở mạng khác.');
  console.log('                         Browser kéo trực tiếp, egress server ≈ 0.');
  console.log('  403 / 401 / 0 byte   → link bị khoá theo IP.');
  console.log('                         Mọi byte phải đi qua gateway (~9 GB/giờ cho 4K).');
};

/* --------------------------------------------------------------- probe step */

const probe = async (url) => {
  if (!url) die('Thiếu URL. Dùng: node scripts/spike-egress.js probe "<url>"');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    die('URL không hợp lệ.');
  }

  console.log(`→ Host: ${parsed.host}`);
  console.log(`→ Đang đọc ${RANGE_BYTES} byte đầu bằng HTTP Range…`);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, {
      headers: { range: `bytes=0-${RANGE_BYTES - 1}` },
      signal: controller.signal,
    });

    const buffer = Buffer.from(await res.arrayBuffer());
    const elapsed = (Date.now() - started) / 1000;
    const mbps = elapsed > 0 ? (buffer.length * 8) / elapsed / 1e6 : 0;

    console.log(`\n  HTTP ${res.status} ${res.statusText}`);
    console.log(`  content-range : ${res.headers.get('content-range') || '(không có)'}`);
    console.log(`  content-type  : ${res.headers.get('content-type') || '(không có)'}`);
    console.log(`  nhận được     : ${buffer.length} byte trong ${elapsed.toFixed(2)}s (~${mbps.toFixed(1)} Mbps)`);

    const rangeHonoured = res.status === 206 && buffer.length > 0;
    const fullBody = res.status === 200 && buffer.length > 0;

    console.log('\n── KẾT LUẬN ────────────────────────────────────────────────────');
    if (rangeHonoured) {
      console.log('  EGRESS_MODE=direct');
      console.log('  Link dùng được từ mạng khác VÀ tôn trọng HTTP Range.');
      console.log('  → Browser kéo thẳng từ TorBox. Server chỉ phục vụ manifest.');
      console.log('  → Direct-play không tốn egress; chỉ nhánh remux mới tốn.');
    } else if (fullBody) {
      console.log('  EGRESS_MODE=gateway  (lý do: không hỗ trợ Range)');
      console.log('  Link tải được nhưng trả 200 thay vì 206 — seek sẽ phải tải lại từ đầu.');
      console.log('  → Cho mọi byte đi qua gateway để tự cắt Range.');
    } else {
      console.log('  EGRESS_MODE=gateway  (lý do: bị chặn ngoài IP gốc)');
      console.log('  → Mọi byte phải đi qua gateway. Tính ~9 GB/giờ cho mỗi session 4K.');
      console.log('  → Giới hạn session đồng thời = (upload Mbps × 0.7) / bitrate nguồn.');
    }
    console.log('────────────────────────────────────────────────────────────────');
    console.log('\nGhi giá trị EGRESS_MODE ở trên vào backend-node/.env rồi chạy Phase 2.');
  } catch (error) {
    const reason = error.name === 'AbortError' ? 'quá 60s không phản hồi' : error.message;
    console.log(`\n  ✗ Không đọc được: ${reason}`);
    console.log('\n── KẾT LUẬN ────────────────────────────────────────────────────');
    console.log('  EGRESS_MODE=gateway  (không kết nối được từ mạng này)');
    console.log('────────────────────────────────────────────────────────────────');
  } finally {
    clearTimeout(timer);
  }
};

/* -------------------------------------------------------------------- entry */

const [command, arg] = process.argv.slice(2);

if (command === 'issue') await issue();
else if (command === 'probe') await probe(arg);
else {
  console.log('Task 0 — spike egress TorBox\n');
  console.log('  node scripts/spike-egress.js issue          # trên máy có TORBOX_API_KEY');
  console.log('  node scripts/spike-egress.js probe "<url>"  # từ máy/mạng KHÁC\n');
  process.exit(1);
}
