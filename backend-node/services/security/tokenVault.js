/**
 * Envelope encryption for per-user debrid API keys.
 *
 * AES-256-GCM with:
 *   - a fresh random IV for every record (never derived, never reused),
 *   - `keyVersion` so keys can be rotated without a migration downtime,
 *   - AAD bound to `userId:provider`, so a ciphertext lifted from one user's
 *     row and pasted into another's fails to authenticate instead of decrypting
 *     into a usable key.
 *
 * Keys come from TOKEN_ENCRYPTION_KEYS as `version:base64`, newest last:
 *   TOKEN_ENCRYPTION_KEYS=1:Base64Of32Bytes,2:Base64Of32Bytes
 * Writes always use the highest version; reads use whatever version the record
 * names, so old rows keep working until they are next written.
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV is the GCM-recommended size.
const KEY_BYTES = 32;

let keyCache = null;

const parseKeys = () => {
  const raw = (process.env.TOKEN_ENCRYPTION_KEYS || '').trim();
  const keys = new Map();

  if (raw) {
    for (const entry of raw.split(',')) {
      const trimmed = entry.trim();
      if (!trimmed) continue;

      const separator = trimmed.indexOf(':');
      if (separator <= 0) {
        throw new Error(`TOKEN_ENCRYPTION_KEYS sai định dạng, cần "version:base64": ${trimmed.slice(0, 12)}…`);
      }

      const version = Number(trimmed.slice(0, separator));
      const material = Buffer.from(trimmed.slice(separator + 1), 'base64');

      if (!Number.isInteger(version) || version <= 0) {
        throw new Error(`keyVersion phải là số nguyên dương: ${trimmed.slice(0, separator)}`);
      }
      if (material.length !== KEY_BYTES) {
        throw new Error(`Khoá version ${version} dài ${material.length} byte, cần đúng ${KEY_BYTES}`);
      }
      keys.set(version, material);
    }
  }

  if (!keys.size) {
    // Falling back to a derived key would silently produce ciphertext nobody can
    // read after a restart, so refuse instead.
    throw new Error(
      'TOKEN_ENCRYPTION_KEYS chưa được cấu hình. Sinh khoá bằng:\n' +
        '  node -e "console.log(\'1:\' + require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }

  return {
    keys,
    currentVersion: Math.max(...keys.keys()),
  };
};

const getKeys = () => {
  if (!keyCache) keyCache = parseKeys();
  return keyCache;
};

/** Test hook: forget parsed keys so a new env value takes effect. */
export const resetKeyCache = () => {
  keyCache = null;
};

export const isVaultConfigured = () => {
  try {
    getKeys();
    return true;
  } catch {
    return false;
  }
};

/**
 * Bind the ciphertext to the owner. A row moved between users or providers
 * will fail the GCM tag check rather than decrypt.
 */
const buildAad = (userId, provider) => Buffer.from(`${userId}:${provider}`, 'utf8');

export const encryptToken = (plaintext, { userId, provider }) => {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Token cần là chuỗi không rỗng');
  }
  if (!userId || !provider) {
    throw new Error('encryptToken cần cả userId và provider cho AAD');
  }

  const { keys, currentVersion } = getKeys();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, keys.get(currentVersion), iv);
  cipher.setAAD(buildAad(userId, provider));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return {
    keyVersion: currentVersion,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
};

export const decryptToken = (record, { userId, provider }) => {
  if (!record?.ciphertext || !record?.iv || !record?.authTag) {
    throw new Error('Bản ghi token không hợp lệ');
  }

  const { keys } = getKeys();
  const key = keys.get(Number(record.keyVersion));
  if (!key) {
    throw new Error(
      `Thiếu khoá version ${record.keyVersion} trong TOKEN_ENCRYPTION_KEYS — ` +
        'giữ lại khoá cũ khi xoay khoá, hoặc yêu cầu user kết nối lại.'
    );
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(record.iv, 'base64'));
  decipher.setAAD(buildAad(userId, provider));
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));

  // Throws on tag mismatch: wrong key, wrong owner, or tampered ciphertext.
  return Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

/** True when the record was written under an older key and deserves a re-wrap. */
export const needsRewrap = (record) => {
  try {
    return Number(record?.keyVersion) !== getKeys().currentVersion;
  } catch {
    return false;
  }
};

/** Safe-to-log fingerprint: identifies a key without revealing it. */
export const fingerprint = (plaintext) =>
  crypto.createHash('sha256').update(String(plaintext)).digest('hex').slice(0, 12);

/** `tb_live_abcd…wxyz` -> `tb_l…wxyz`, for UI display only. */
export const maskToken = (plaintext) => {
  const value = String(plaintext || '');
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
};
