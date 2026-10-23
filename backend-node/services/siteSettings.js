import { cached } from '../config/redis.js';
import { getDB } from '../config/database.js';

/**
 * Site-wide feature settings (admin-controlled), stored in site_settings and
 * read through a short Redis cache: a hot per-card check must not hit Mongo.
 */
export const getSiteSetting = async (key, fallback = false) => {
  try {
    return await cached(`site:setting:${key}`, 60, async () => {
      const doc = await getDB().collection('site_settings').findOne({ _id: key });
      return doc ? Boolean(doc.enabled) : fallback;
    });
  } catch {
    return fallback;
  }
};

export const setSiteSetting = async (key, enabled) => {
  await getDB().collection('site_settings').updateOne(
    { _id: key },
    { $set: { enabled: Boolean(enabled), updatedAt: new Date() } },
    { upsert: true },
  );
};
