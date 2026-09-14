/**
 * Per-user debrid provider token storage.
 *
 * Ciphertext lives in `provider_connections`; the plaintext key never touches
 * Mongo, Redis, logs, or the job queue. Reads decrypt with tokenVault using
 * AAD `userId:provider`, so a row copied between users fails authentication
 * instead of yielding a usable key.
 */

import { ObjectId } from 'mongodb';
import {
  encryptToken,
  decryptToken,
  needsRewrap,
  fingerprint,
  maskToken,
} from '../security/tokenVault.js';

export const SUPPORTED_PROVIDERS = ['torbox'];

export const isSupportedProvider = (provider) =>
  SUPPORTED_PROVIDERS.includes(String(provider || '').toLowerCase());

const toObjectIdOrRaw = (userId) => {
  try {
    if (userId instanceof ObjectId) return userId;
    return new ObjectId(String(userId));
  } catch {
    return userId;
  }
};

/** Query helper matching rows written with ObjectId or legacy string userIds. */
const userFilter = (userId, provider) => ({
  $and: [
    { provider },
    { $or: [{ userId: toObjectIdOrRaw(userId) }, { userId: String(userId) }] },
  ],
});

export const getConnectionDoc = async (db, userId, provider) => {
  const name = String(provider || '').toLowerCase();
  return db.collection('provider_connections').findOne(await userFilter(userId, name));
};

/**
 * Decrypt the caller's provider key. Throws with `status` for HTTP mapping:
 *   404 NO_CONNECTION  — never connected
 *   401 INVALID_TOKEN   — ciphertext unusable (key rotation lost / tampered)
 */
export const getDecryptedKey = async (db, userId, provider) => {
  const name = String(provider || '').toLowerCase();
  const doc = await getConnectionDoc(db, userId, name);
  if (!doc) {
    const error = new Error('Chưa kết nối TorBox');
    error.status = 409;
    error.code = 'no_connection';
    throw error;
  }

  let plaintext;
  try {
    plaintext = decryptToken(doc, {
      userId: String(userId),
      provider: name,
    });
  } catch {
    // Fallback for rows written before the userId-string normalization:
    // try the stored userId representation before giving up.
    try {
      plaintext = decryptToken(doc, { userId: String(doc.userId), provider: name });
    } catch {
      const error = new Error('Token đã lưu không còn giải mã được, vui lòng kết nối lại');
      error.status = 401;
      error.code = 'invalid_token';
      throw error;
    }
  }

  // Opportunistic re-wrap when TOKEN_ENCRYPTION_KEYS rotated.
  if (needsRewrap(doc)) {
    try {
      const rewrapped = encryptToken(plaintext, {
        userId: String(userId),
        provider: name,
      });
      await db.collection('provider_connections').updateOne(
        { _id: doc._id },
        { $set: { ...rewrapped, updatedAt: new Date() } },
      );
    } catch {
      // Re-wrap is best-effort; the current read already succeeded.
    }
  }

  return { key: plaintext, doc };
};

export const saveConnection = async (db, userId, provider, { plaintextKey, profile = {} }) => {
  const name = String(provider || '').toLowerCase();
  const userIdStr = String(userId);
  const sealed = encryptToken(plaintextKey, { userId: userIdStr, provider: name });
  const now = new Date();

  const update = {
    $set: {
      userId: toObjectIdOrRaw(userId),
      userIdStr,
      provider: name,
      ...sealed,
      fingerprint: fingerprint(plaintextKey),
      masked: maskToken(plaintextKey),
      providerUserId: String(profile.providerUserId || ''),
      providerEmail: String(profile.email || ''),
      plan: String(profile.plan || ''),
      status: 'connected',
      lastVerifiedAt: now,
      updatedAt: now,
    },
    $setOnInsert: { createdAt: now },
  };

  await db.collection('provider_connections').updateOne(
    { userId: toObjectIdOrRaw(userId), provider: name },
    update,
    { upsert: true },
  );

  return { masked: maskToken(plaintextKey), fingerprint: fingerprint(plaintextKey) };
};

export const removeConnection = async (db, userId, provider) => {
  const name = String(provider || '').toLowerCase();
  const result = await db
    .collection('provider_connections')
    .deleteOne({ userId: toObjectIdOrRaw(userId), provider: name });
  if (result.deletedCount === 0) {
    // Legacy string-userId rows: one retry before reporting "not found".
    await db
      .collection('provider_connections')
      .deleteOne({ userId: String(userId), provider: name });
  }
  return true;
};

/** Public status shape: never includes ciphertext, plaintext, or URLs. */
export const toPublicStatus = (doc) => {
  if (!doc) return { connected: false, provider: 'torbox' };
  return {
    connected: true,
    provider: doc.provider,
    masked: doc.masked || '••••',
    fingerprint: doc.fingerprint || null,
    plan: doc.plan || '',
    providerUserId: doc.providerUserId || '',
    lastVerifiedAt: doc.lastVerifiedAt || null,
    updatedAt: doc.updatedAt || null,
  };
};

export default {
  SUPPORTED_PROVIDERS,
  isSupportedProvider,
  getConnectionDoc,
  getDecryptedKey,
  saveConnection,
  removeConnection,
  toPublicStatus,
};
