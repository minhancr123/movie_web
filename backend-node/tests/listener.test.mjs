import test from 'node:test';
import assert from 'node:assert/strict';
import { readListenerConfig } from '../config/listener.js';

test('container default remains reachable without trusting forwarded headers', () => {
  assert.deepEqual(readListenerConfig({}), { host: '0.0.0.0', trustProxyHops: 0 });
});

test('native server can preserve its loopback listener and single Nginx hop', () => {
  assert.deepEqual(readListenerConfig({ BIND_HOST: '127.0.0.1', TRUST_PROXY_HOPS: '1' }),
    { host: '127.0.0.1', trustProxyHops: 1 });
  assert.equal(readListenerConfig({ BIND_HOST: '::1' }).host, '::1');
});

test('invalid listener and unlimited proxy trust fail before accepting traffic', () => {
  assert.throws(() => readListenerConfig({ BIND_HOST: 'public.example' }), /BIND_HOST/);
  for (const value of ['true', '-1', '5', '1.5', '']) {
    assert.throws(() => readListenerConfig({ TRUST_PROXY_HOPS: value }), /TRUST_PROXY_HOPS/);
  }
});
