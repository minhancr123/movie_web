import * as tmdb from './tmdb.js';
import { getDB } from '../config/database.js';
import { cached } from '../config/redis.js';

/**
 * Gợi ý phim cá nhân hóa cho người dùng.
 * Chiến lược: 
 * 1. Lấy danh sách phim đã xem gần đây của User.
 * 2. Lấy gợi ý từ TMDB cho top 3 phim đó.
 * 3. Trộn kết quả, ưu tiên phim xuất hiện nhiều lần hoặc có điểm cao.
 * 4. Cache kết quả theo UserId.
 */
export const getPersonalizedRecommendations = async (userId, currentType = null, currentTmdbId = null) => {
  // Cache key thay đổi nếu có phim đang xem cụ thể
  const cacheKey = currentTmdbId ? `recs:${currentType}:${currentTmdbId}` : `user:recs:${userId}`;
  
  return cached(cacheKey, 3600, async () => {
    const db = getDB();
    let seedIds = [];
    
    if (currentType && currentTmdbId) {
      seedIds = [`${currentType}:${currentTmdbId}`];
    } else if (userId) {
      const history = await db.collection('playback_sessions')
        .find({ userIdStr: String(userId) })
        .sort({ updatedAt: -1 })
        .limit(10)
        .toArray();
      
      seedIds = [...new Set(history.map(h => `${h.mediaType}:${h.tmdbId}`))].slice(0, 3);
    }

    if (!seedIds.length) return [];
    
    const allRecs = [];
    const seenIds = new Set(); 
    const preferredLanguages = new Set();

    // Lấy thông tin ngôn ngữ từ các phim mầm để xây dựng profile
    await Promise.all(seedIds.map(async (seed) => {
      const [type, id] = seed.split(':');
      try {
        const [res, detail] = await Promise.all([
          tmdb.getRecommendations(type, id),
          tmdb.getDetail(type, id).catch(() => null)
        ]);
        
        if (detail?.originalLanguage) {
          preferredLanguages.add(detail.originalLanguage);
        }

        if (res?.results) {
          allRecs.push(...res.results.map(r => ({ ...r, media_type: type })));
        }
      } catch (e) {
        console.warn(`[recs] Failed to get recommendations for ${seed}: ${e.message}`);
      }
    }));

    // 3. Xử lý chấm điểm và trộn
    const rankedRecs = {};
    allRecs.forEach(item => {
      const key = `${item.media_type}:${item.id}`;
      if (seenIds.has(key)) return; 

      if (!rankedRecs[key]) {
        rankedRecs[key] = {
          ...item,
          tmdbId: item.id,
          type: item.media_type,
          score: item.vote_average / 10 
        };
      } else {
        rankedRecs[key].score += 1.5; 
      }

      // --- CỘNG ĐIỂM NGÔN NGỮ (LANGUAGE BOOST) ---
      // Nếu user đang xem/đã xem phim Việt (vi), ưu tiên cực cao các phim Việt khác
      if (item.original_language === 'vi' && preferredLanguages.has('vi')) {
        rankedRecs[key].score += 3.0;
      } 
      // Ưu tiên vừa phải cho các phim cùng ngôn ngữ với lịch sử xem (ví dụ: cùng là phim Hàn, phim Mỹ...)
      else if (preferredLanguages.has(item.original_language)) {
        rankedRecs[key].score += 1.0;
      }
    });

    // 4. Trả về top 20 phim có điểm cao nhất
    return Object.values(rankedRecs)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20);
  });
};
