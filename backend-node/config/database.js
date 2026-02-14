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
    
    // Favorites collection indexes
    await db.collection('favorites').createIndex({ userId: 1, movieSlug: 1 }, { unique: true });
    
    // Watch history collection indexes
    await db.collection('watch_history').createIndex({ userId: 1, watchedAt: -1 });
    
    // Premiere events collection indexes
    await db.collection('premiere_events').createIndex({ startTime: 1, status: 1 });
    await db.collection('premiere_events').createIndex({ movieSlug: 1 });
    
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
