import cron from 'node-cron';
import jwt from 'jsonwebtoken';
import { getDB } from '../../config/database.js';

/**
 * Trending prewarm: resolve the most popular titles once a day (and shortly
 * after boot) so their remux renditions already exist when the first viewer
 * presses play. Resolve is idempotent for published renditions (answers
 * instantly, spawns nothing) and goes through the FULL pipeline otherwise —
 * admission control, janitor accounting, TorBox budget — because it drives
 * the same API a browser does, via loopback, with a short-lived internal
 * token minted for the connected operator account.
 *
 * Knobs (env): PREWARM_ENABLED=1, PREWARM_TITLES=3, PREWARM_CRON="0 12 * * *"
 * (noon, ahead of evening viewing), PREWARM_STARTUP_DELAY_MS (default 15 min
 * so boot prioritizes janitor/indexes/viewers).
 */

const ENABLED = (process.env.PREWARM_ENABLED ?? '1') !== '0';
const TITLES = Math.max(0, Math.min(6, Number(process.env.PREWARM_TITLES) || 3));
const CRON = process.env.PREWARM_CRON || '0 12 * * *';
const STARTUP_DELAY_MS = Math.max(60_000, Number(process.env.PREWARM_STARTUP_DELAY_MS) || 15 * 60_000);
const RESOLVE_TIMEOUT_MS = 45_000;
const BETWEEN_TITLES_MS = 60_000;

let running = false;

const log = (...args) => console.log('[prewarm]', ...args);

async function operatorContext() {
  const db = getDB();
  const connection = await db.collection('provider_connections')
    .findOne({ provider: 'torbox', status: 'connected' })
    .catch(() => null);
  if (!connection) return null;
  const userId = String(connection.userIdStr || connection.userId || '');
  if (!userId) return null;
  const secret = process.env.JWT_SECRET || '';
  if (!secret) return null;
  const user = await db.collection('users').findOne({ _id: connection.userId }).catch(() => null);
  const token = jwt.sign(
    { userId, email: user?.email || '', username: user?.username || '', role: user?.role || 'user' },
    secret,
    { expiresIn: '30m' },
  );
  return { userId, token };
}

async function trendingTitleIds() {
  const res = await fetch('http://127.0.0.1:5001/api/catalog/home', {
    headers: { 'x-forwarded-for': '' },
  }).catch(() => null);
  if (!res || !res.ok) return [];
  const body = await res.json().catch(() => null);
  const trending = body?.data?.trending || [];
  // Movies only: TV needs a season/episode choice the scheduler cannot make
  // (and resolving s01e01 warms a slice most viewers never reach).
  const picks = trending.filter((item) => item && item.tmdbId && item.mediaType === 'movie');
  return picks.map((item) => ({ type: item.mediaType || 'movie', tmdbId: item.tmdbId }));
}

async function resolveOne(ctx, title) {
  const res = await fetch('http://127.0.0.1:5001/api/playback/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.token}` },
    body: JSON.stringify({
      type: title.type,
      tmdbId: title.tmdbId,
      capabilities: {
        hevc: true, hevcMain10: true, av1: true, hdr: true,
        maxHeight: 2160, preferredMaxHeight: 2160, maxBitrateMbps: 0,
        eac3: true, webm: true, decodingSmooth: true, powerEfficient: false, smoothMaxHeight: 2160,
      },
    }),
    signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS),
  }).catch((error) => ({ ok: false, status: 0, json: async () => ({ err: error.message }) }));
  const body = await res.json().catch(() => ({}));
  return { status: res.status, mode: body?.data?.mode, published: Boolean(body?.data?.published) };
}

async function runOnce(reason) {
  if (running || TITLES === 0) return;
  running = true;
  try {
    const ctx = await operatorContext();
    if (!ctx) {
      log(`bỏ qua (${reason}): chưa có tài khoản đã kết nối TorBox`);
      return;
    }
    const titles = (await trendingTitleIds()).slice(0, TITLES);
    log(`bắt đầu (${reason}): ${titles.length} phim thịnh hành`);
    let warmed = 0;
    let reused = 0;
    for (const title of titles) {
      const outcome = await resolveOne(ctx, title);
      if (outcome.status === 200) {
        if (outcome.published || outcome.mode === 'direct') reused += 1;
        else warmed += 1;
        log(`tmdb=${title.tmdbId} → ${outcome.status} ${outcome.mode || ''} ${outcome.published ? '(đã có sẵn)' : '(đã làm nóng)'}`);
      } else {
        log(`tmdb=${title.tmdbId} → ${outcome.status} (bỏ qua)`);
      }
      await new Promise((r) => setTimeout(r, BETWEEN_TITLES_MS));
    }
    log(`hoàn tất (${reason}): làm nóng ${warmed}, đã có sẵn ${reused}`);
  } catch (error) {
    log('lỗi:', error?.message || error);
  } finally {
    running = false;
  }
}

export const startPrewarmScheduler = () => {
  if (!ENABLED) {
    log('tắt qua PREWARM_ENABLED');
    return;
  }
  const boot = setTimeout(() => { void runOnce('khởi động'); }, STARTUP_DELAY_MS);
  boot.unref?.();
  const task = cron.schedule(CRON, () => { void runOnce('lịch'); });
  task.start?.();
  log(`đã bật: ${TITLES} phim/lần, cron "${CRON}", chạy lần đầu sau ${Math.round(STARTUP_DELAY_MS / 60000)} phút`);
};
