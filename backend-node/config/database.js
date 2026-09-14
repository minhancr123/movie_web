import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

let db;

export const connectDB = async () => {
  try {
    await client.connect();
    db = client.db('movieweb');
    console.log('✅ MongoDB Atlas Connected Successfully!');
    
    // Create indexes
    await createIndexes();
    
    return db;
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

const createIndexes = async () => {
  try {
    // Users collection indexes
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.collection('users').createIndex({ username: 1 }, { unique: true });
    
    // Comments collection indexes
    await db.collection('comments').createIndex({ movieSlug: 1, createdAt: -1 });
    await db.collection('comments').createIndex({ userId: 1 });
    await db.collection('comments').createIndex({ contentRef: 1, createdAt: -1 });
    
    // Favorites collection indexes
    await db.collection('favorites').createIndex({ userId: 1, movieSlug: 1 }, { unique: true });
    // TMDB identity: partial so rows predating the cutover (no contentRef) are exempt.
    await db.collection('favorites').createIndex(
      { userId: 1, contentRef: 1 },
      { unique: true, partialFilterExpression: { contentRef: { $type: 'string' } } }
    );
    
    // Watch history collection indexes
    await db.collection('watch_history').createIndex({ userId: 1, watchedAt: -1 });
    await db.collection('watch_history').createIndex({ userId: 1, contentRef: 1 });
    
    // Premiere events collection indexes
    await db.collection('premiere_events').createIndex({ startTime: 1, status: 1 });
    await db.collection('premiere_events').createIndex({ movieSlug: 1 });

    // Async/analytics/search support indexes
    await db.collection('movie_stats').createIndex({ movieSlug: 1 }, { unique: true });
    await db.collection('analytics_events').createIndex({ type: 1, occurredAt: -1 });
    await db.collection('analytics_events').createIndex({ movieSlug: 1, occurredAt: -1 });
    await db.collection('notifications').createIndex({ userId: 1, createdAt: -1 });
    await db.collection('favorite_sync_events').createIndex({ userId: 1, occurredAt: -1 });
    await db.collection('watch_history_sync_events').createIndex({ userId: 1, occurredAt: -1 });
    await db.collection('catalog_snapshots').createIndex({ createdAt: -1 });

    // Phase 2 playback: per-user encrypted provider tokens + playback sessions.
    // Ciphertext rows are looked up by (userId, provider) on every resolve.
    await db.collection('provider_connections').createIndex(
      { userId: 1, provider: 1 },
      { unique: true }
    );
    await db.collection('provider_connections').createIndex({ userIdStr: 1, provider: 1 });
    // Session ids are unguessable randoms; ownership is checked per request.
    await db.collection('playback_sessions').createIndex({ sessionId: 1 }, { unique: true });
    await db.collection('playback_sessions').createIndex({ userId: 1, createdAt: -1 });
    await db.collection('playback_sessions').createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 }
    );

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
