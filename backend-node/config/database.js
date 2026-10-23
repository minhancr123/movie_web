import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { readAppConfig } from './runtime.js';

dotenv.config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db;

export const connectDB = async () => {
  try {
    await client.connect();
    const config = readAppConfig(process.env);
    db = client.db(config.databaseName);
    console.log('✅ MongoDB Atlas Connected Successfully!');
    
    // Create indexes
    await createIndexes();
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

// Retention for append-only event collections nobody reads after a few days.
const EVENT_TTL_DAYS = 60;
const EVENT_TTL_SECONDS = EVENT_TTL_DAYS * 24 * 60 * 60;

const createIndexes = async () => {
  try {
    // Every createIndex is idempotent and independent; sequential awaits made
    // boot latency scale with the number of indexes (one RTT each).
    const specs = [
      // Users collection indexes
      ['users', { email: 1 }, { unique: true }],
      ['users', { username: 1 }, { unique: true }],

      // Comments collection indexes
      ['comments', { movieSlug: 1, createdAt: -1 }],
      ['comments', { userId: 1 }],
      ['comments', { contentRef: 1, createdAt: -1 }],

      // Favorites collection indexes
      ['favorites', { userId: 1, movieSlug: 1 }, { unique: true }],
      // TMDB identity: partial so rows predating the cutover (no contentRef) are exempt.
      ['favorites',
        { userId: 1, contentRef: 1 },
        { unique: true, partialFilterExpression: { contentRef: { $type: 'string' } } }],
      // Sorted favorites reads (getFavorites sorts addedAt desc) without an
      // in-memory sort over every row of the user.
      ['favorites', { userId: 1, addedAt: -1 }],

      // Watch history collection indexes
      ['watch_history', { userId: 1, watchedAt: -1 }],
      ['watch_history', { userId: 1, contentRef: 1 }],
      // addWatchHistory upserts on (userId, movieSlug): without this the write
      // path scans the user's whole history prefix on every progress save.
      ['watch_history', { userId: 1, movieSlug: 1 }],

      // Premiere events collection indexes
      ['premiere_events', { startTime: 1, status: 1 }],
      ['premiere_events', { movieSlug: 1 }],
      // Premiere rooms load the last 100 messages per join.
      ['premiere_messages', { premiereId: 1, timestamp: -1 }],

      // Async/analytics/search support indexes
      ['movie_stats', { movieSlug: 1 }, { unique: true }],
      ['analytics_events', { type: 1, occurredAt: -1 }],
      ['analytics_events', { movieSlug: 1, occurredAt: -1 }],
      ['notifications', { userId: 1, createdAt: -1 }],
      ['favorite_sync_events', { userId: 1, occurredAt: -1 }],
      ['watch_history_sync_events', { userId: 1, occurredAt: -1 }],
      // Sync/analytics rows are write-only breadcrumbs: cap them instead of
      // growing forever (one row per progress save while watching).
      ['favorite_sync_events', { occurredAt: 1 }, { expireAfterSeconds: EVENT_TTL_SECONDS }],
      ['watch_history_sync_events', { occurredAt: 1 }, { expireAfterSeconds: EVENT_TTL_SECONDS }],
      ['analytics_events', { occurredAt: 1 }, { expireAfterSeconds: EVENT_TTL_SECONDS }],
      ['catalog_snapshots', { createdAt: -1 }],

      // Movie requests admin/user lists
      ['movie_requests', { userId: 1, status: 1 }],
      ['movie_requests', { createdAt: -1 }],

      // Phase 2 playback: per-user encrypted provider tokens + playback sessions.
      // Ciphertext rows are looked up by (userId, provider) on every resolve.
      ['provider_connections', { userId: 1, provider: 1 }, { unique: true }],
      ['provider_connections', { userIdStr: 1, provider: 1 }],
      // Session ids are unguessable randoms; ownership is checked per request.
      ['playback_sessions', { sessionId: 1 }, { unique: true }],
      ['playback_sessions', { userId: 1, createdAt: -1 }],
      ['playback_sessions',
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }],
      // The hot session queries filter on the STRING userId (userIdStr), which
      // the ObjectId index above cannot serve: remux reuse, pre-flight checks
      // and the per-poll expiry renewal were collection scans.
      ['playback_sessions', { userIdStr: 1, infoHash: 1, mode: 1, expiresAt: 1 }],
      ['playback_sessions', { userIdStr: 1, updatedAt: -1 }],
      // Rendition asset serving resolves by either handle without a session id.
      ['playback_sessions', { publishedRenditionId: 1 }, { sparse: true }],
      ['playback_sessions', { renditionKey: 1 }, { sparse: true }],
      // Budget enforcement looks renditions up by id; publish re-reads them all.
      ['published_renditions', { renditionId: 1 }, { unique: true }],
      ['published_renditions', { renditionKey: 1 }],
      // User subtitle listing per episode.
      ['user_subtitles', { userIdStr: 1, tmdbId: 1, season: 1, episode: 1 }],
    ];
    const results = await Promise.allSettled(
      specs.map(([name, keys, options]) => db.collection(name).createIndex(keys, options)),
    );
    const failed = results.filter((r) => r.status === 'rejected');
    for (const failure of failed) {
      console.log('⚠️ Index creation warning:', failure.reason?.message);
    }

    console.log('✅ Database indexes created');
  } catch (error) {
    console.log('⚠️ Index creation warning:', error.message);
  }
};

export const getDB = () => {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return db;
};

export default client;
