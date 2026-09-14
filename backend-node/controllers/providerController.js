/**
 * Provider connect / disconnect / status.
 *
 * Conventions follow the existing controllers:
 *   - `authMiddleware` supplies `req.user.userId`
 *   - `{ success, message/data }` JSON envelope, Vietnamese messages
 *   - provider API keys and download URLs never reach logs or the job queue
 */

import { getDB } from '../config/database.js';
import { verifyKey, DebridError } from '../services/debrid/torbox.js';
import {
  isSupportedProvider,
  getConnectionDoc,
  saveConnection,
  removeConnection,
  toPublicStatus,
} from '../services/providers/connectionStore.js';
import { isVaultConfigured } from '../services/security/tokenVault.js';

const fail = (res, status, message, extra = {}) =>
  res.status(status).json({ success: false, message, ...extra });

const normalizeProvider = (value) => String(value || '').toLowerCase();

export const connectProvider = async (req, res) => {
  try {
    const provider = normalizeProvider(req.params.provider);
    if (!isSupportedProvider(provider)) {
      return fail(res, 400, 'Provider chưa được hỗ trợ (chỉ có torbox)');
    }
    if (!isVaultConfigured()) {
      return fail(res, 503, 'Máy chủ chưa cấu hình TOKEN_ENCRYPTION_KEYS nên chưa thể lưu token');
    }

    const rawKey = req.body?.apiKey ?? req.body?.token ?? '';
    const apiKey = String(rawKey).trim();
    if (!apiKey || apiKey.length < 8) {
      return fail(res, 400, 'apiKey không hợp lệ');
    }

    // Validate before persisting so a typo fails fast without writing anything.
    let profile;
    try {
      profile = await verifyKey(apiKey);
    } catch (error) {
      if (error instanceof DebridError) {
        return fail(res, error.status || 401, error.message, { code: error.code });
      }
      throw error;
    }

    const db = getDB();
    const { masked, fingerprint } = await saveConnection(db, req.user.userId, provider, {
      plaintextKey: apiKey,
      profile,
    });

    return res.status(201).json({
      success: true,
      message: 'Đã kết nối TorBox',
      data: { provider, masked, fingerprint, plan: profile.plan || '' },
    });
  } catch (error) {
    // Never echo the key: validation messages above carry no secret.
    console.error('connectProvider error:', error.code || error.message);
    return fail(res, error.status || 500, error.message || 'Lỗi server');
  }
};

export const disconnectProvider = async (req, res) => {
  try {
    const provider = normalizeProvider(req.params.provider);
    if (!isSupportedProvider(provider)) {
      return fail(res, 400, 'Provider chưa được hỗ trợ (chỉ có torbox)');
    }

    const db = getDB();
    await removeConnection(db, req.user.userId, provider);
    return res.json({ success: true, message: 'Đã ngắt kết nối', data: { provider } });
  } catch (error) {
    console.error('disconnectProvider error:', error.message);
    return fail(res, 500, 'Lỗi server');
  }
};

export const getProviderStatus = async (req, res) => {
  try {
    const db = getDB();

    // `/status` (all) when no provider param is present.
    if (!req.params.provider) {
      const doc = await getConnectionDoc(db, req.user.userId, 'torbox');
      return res.json({ success: true, data: { torbox: toPublicStatus(doc) } });
    }

    const provider = normalizeProvider(req.params.provider);
    if (!isSupportedProvider(provider)) {
      return fail(res, 400, 'Provider chưa được hỗ trợ (chỉ có torbox)');
    }
    const doc = await getConnectionDoc(db, req.user.userId, provider);
    return res.json({ success: true, data: toPublicStatus(doc) });
  } catch (error) {
    console.error('getProviderStatus error:', error.message);
    return fail(res, 500, 'Lỗi server');
  }
};

export default { connectProvider, disconnectProvider, getProviderStatus };
