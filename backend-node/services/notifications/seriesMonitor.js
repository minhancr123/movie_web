import cron from 'node-cron';
import { getDB } from '../../config/database.js';
import * as tmdb from '../tmdb.js';

/**
 * New-episode monitor for followed series.
 *
 * "Followed" = the series sits in the viewer's favourites with a tmdb:tv:
 * contentRef — the SaveButton already writes exactly that, so following needs
 * no new toggle or schema. Every 2h (and once shortly after boot) each
 * favourite series' latest season episode count is compared against a
 * snapshot; an increase inserts one notification for the viewer. First
 * sighting only creates the snapshot, so a brand-new follow never storms the
 * bell with the whole back catalogue.
 *
 * Knobs: SERIES_MONITOR_ENABLED=1, SERIES_MONITOR_CRON (mỗi 2 giờ, ví dụ 0-23/2),
 * SERIES_MONITOR_STARTUP_DELAY_MS (default 5 min).
 */

const ENABLED = (process.env.SERIES_MONITOR_ENABLED ?? '1') !== '0';
const CRON = process.env.SERIES_MONITOR_CRON || '0 */2 * * *';
const STARTUP_DELAY_MS = Math.max(60_000, Number(process.env.SERIES_MONITOR_STARTUP_DELAY_MS) || 5 * 60_000);
const BETWEEN_TITLES_MS = 1500;
let running = false;

const log = (...args) => console.log('[series-monitor]', ...args);

const latestSeasonEpisodeCount = (detail) => {
  const seasons = (detail?.seasons || []).filter((s) => Number(s.seasonNumber) > 0);
  if (!seasons.length) return null;
  const latest = seasons.reduce((a, b) => (b.seasonNumber > a.seasonNumber ? b : a));
  return Number.isInteger(latest.episodeCount) && latest.episodeCount > 0 ? latest.episodeCount : null;
};

async function runOnce(reason) {
  if (running) return;
  running = true;
  try {
    const db = getDB();
    // tv favourites only; contentRef carries the identity, so no dependency
    // on a mediaType field on the row itself.
    const rows = await db.collection('favorites')
      .find({ movieSlug: /^tmdb:tv:/ })
      .project({ userId: 1, movieSlug: 1 })
      .limit(500)
      .toArray();
    if (!rows.length) return;
    log(`kiểm tra ${rows.length} bộ theo dõi (${reason})`);
    let notified = 0;
    for (const row of rows) {
      const contentRef = String(row.movieSlug);
      const tmdbId = Number(contentRef.split(':')[2]);
      const userIdStr = String(row.userId);
      if (!Number.isInteger(tmdbId) || tmdbId <= 0) continue;
      try {
        const detail = await tmdb.getDetail('tv', tmdbId);
        const episodeCount = latestSeasonEpisodeCount(detail);
        const snapshotId = `${userIdStr}:${tmdbId}`;
        const snapshot = await db.collection('series_snapshots').findOne({ _id: snapshotId });
        if (episodeCount !== null) {
          if (!snapshot) {
            await db.collection('series_snapshots').insertOne({
              _id: snapshotId,
              userIdStr,
              tmdbId,
              contentRef,
              episodeCount,
              checkedAt: new Date(),
            });
          } else if (episodeCount > snapshot.episodeCount) {
            await db.collection('notifications').insertOne({
              userId: row.userId,
              type: 'new_episode',
              title: 'Tập mới lên sóng',
              message: `${detail.title || 'Bộ phim bạn theo dõi'} vừa cập nhật thêm ${episodeCount - snapshot.episodeCount} tập`,
              movieSlug: contentRef,
              tmdbId,
              isRead: false,
              createdAt: new Date(),
            });
            await db.collection('series_snapshots').updateOne(
              { _id: snapshotId },
              { $set: { episodeCount, checkedAt: new Date() } },
            );
            notified += 1;
          } else {
            await db.collection('series_snapshots').updateOne(
              { _id: snapshotId },
              { $set: { checkedAt: new Date() } },
            );
          }
        }
      } catch (error) {
        // One rotten title never stops the sweep.
        log(`tmdb=${tmdbId} bỏ qua: ${error?.message || error}`);
      }
      await new Promise((r) => setTimeout(r, BETWEEN_TITLES_MS));
    }
    if (notified) log(`đã tạo ${notified} thông báo tập mới`);
  } catch (error) {
    log('lỗi:', error?.message || error);
  } finally {
    running = false;
  }
}

export const startSeriesMonitor = () => {
  if (!ENABLED) {
    log('tắt qua SERIES_MONITOR_ENABLED');
    return;
  }
  const boot = setTimeout(() => { void runOnce('khởi động'); }, STARTUP_DELAY_MS);
  boot.unref?.();
  const task = cron.schedule(CRON, () => { void runOnce('lịch'); });
  task.start?.();
  log(`đã bật: cron "${CRON}", lần đầu sau ${Math.round(STARTUP_DELAY_MS / 60000)} phút`);
};
