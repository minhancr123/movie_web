import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { signAccountToken } from '../services/security/accountToken.js';

test('missing or blank lifetime yields a valid 30-day account token', () => {
  for (const JWT_EXPIRE of [undefined, '', '  ']) {
    const env = { JWT_SECRET: 'synthetic-test-secret', JWT_EXPIRE };
    const claims = jwt.verify(signAccountToken({ userId: 'test', role: 'admin' }, env), env.JWT_SECRET);
    assert.equal(claims.exp - claims.iat, 30 * 86400);
    assert.equal(claims.userId, 'test');
    assert.equal(claims.role, 'admin');
  }
});

test('explicit lifetime is honored and invalid configuration fails before persistence', () => {
  const env = { JWT_SECRET: 'synthetic-test-secret', JWT_EXPIRE: ' 15m ' };
  const claims = jwt.verify(signAccountToken({ userId: 'test' }, env), env.JWT_SECRET);
  assert.equal(claims.exp - claims.iat, 900);
  assert.throws(() => signAccountToken({}, { ...env, JWT_EXPIRE: 'invalid' }), /expiresIn/);
});
