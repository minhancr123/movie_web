import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SHARED_TORBOX_OWNER, canManageProvider, publicProviderStatus } from '../services/providers/keyPolicy.js';
import { saveConnection, getDecryptedKey, removeConnection, getConnectionDoc, toPublicStatus } from '../services/providers/connectionStore.js';
import { resetKeyCache } from '../services/security/tokenVault.js';

test('shared credentials are encrypted once, reusable by viewers, and isolated from personal credentials', async () => {
  const previousMode = process.env.TORBOX_KEY_MODE;
  const previousVault = process.env.TOKEN_ENCRYPTION_KEYS;
  process.env.TOKEN_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString('base64')}`;
  resetKeyCache();
  const rows = new Map();
  const db = { collection: () => ({
    updateOne: async (filter, update) => rows.set(String(filter.userId), { ...update.$set }),
    findOne: async filter => rows.get(String(filter.$and[1].$or[0].userId)) || null,
    deleteOne: async filter => ({ deletedCount: rows.delete(String(filter.userId)) ? 1 : 0 }),
  }) };
  try {
    process.env.TORBOX_KEY_MODE = 'personal';
    await saveConnection(db, 'viewer-a', 'torbox', { plaintextKey: 'personal-test-key' });
    process.env.TORBOX_KEY_MODE = 'shared';
    await assert.rejects(getDecryptedKey(db, 'viewer-a', 'torbox'), { code: 'no_connection' }, 'missing shared key never falls back to a personal account');
    await saveConnection(db, 'admin', 'torbox', { plaintextKey: 'shared-test-secret', profile: { plan: 'test' } });
    assert.ok(rows.has(SHARED_TORBOX_OWNER));
    assert.equal(JSON.stringify([...rows.values()]).includes('shared-test-secret'), false);
    for (const viewer of ['viewer-a', 'viewer-b']) {
      assert.equal((await getDecryptedKey(db, viewer, 'torbox')).key, 'shared-test-secret');
    }
    assert.equal(canManageProvider({ role: 'user' }), false);
    assert.equal(canManageProvider({ role: 'admin' }), true);
    const status = toPublicStatus(await getConnectionDoc(db, 'viewer-b', 'torbox'));
    assert.deepEqual(publicProviderStatus(status, { role: 'user' }), {
      connected: true, provider: 'torbox', mode: 'shared', canManage: false,
    });
    assert.equal(publicProviderStatus(status, { role: 'admin' }).masked, status.masked);
    await saveConnection(db, 'admin', 'torbox', { plaintextKey: 'rotated-test-secret' });
    assert.equal((await getDecryptedKey(db, 'viewer-b', 'torbox')).key, 'rotated-test-secret');
    await removeConnection(db, 'admin', 'torbox');
    await assert.rejects(getDecryptedKey(db, 'viewer-b', 'torbox'), { code: 'no_connection' });
    process.env.TORBOX_KEY_MODE = 'personal';
    assert.equal((await getDecryptedKey(db, 'viewer-a', 'torbox')).key, 'personal-test-key');
    await assert.rejects(getDecryptedKey(db, 'viewer-b', 'torbox'), { code: 'no_connection' });
    process.env.TORBOX_KEY_MODE = 'typo';
    assert.throws(() => canManageProvider({ role: 'admin' }), /TORBOX_KEY_MODE/);

    process.env.TORBOX_KEY_MODE = 'shared';
    process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/test';
    process.env.REDIS_CACHE_URL = 'redis://127.0.0.1:1';
    const { connectProvider, disconnectProvider } = await import('../controllers/providerController.js');
    for (const handler of [connectProvider, disconnectProvider]) {
      const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      // No database connection and no provider fetch: deny before either side effect.
      await handler({ params: { provider: 'torbox' }, user: { userId: 'viewer-b', role: 'user' }, body: { apiKey: 'never-forward-this-key' } }, res);
      assert.equal(res.code, 403);
      assert.equal(JSON.stringify(res.body).includes('never-forward-this-key'), false);
    }
  } finally {
    const { cacheClient } = await import('../config/redis.js');
    cacheClient.disconnect();
    if (previousMode === undefined) delete process.env.TORBOX_KEY_MODE; else process.env.TORBOX_KEY_MODE = previousMode;
    if (previousVault === undefined) delete process.env.TOKEN_ENCRYPTION_KEYS; else process.env.TOKEN_ENCRYPTION_KEYS = previousVault;
    resetKeyCache();
  }
});
