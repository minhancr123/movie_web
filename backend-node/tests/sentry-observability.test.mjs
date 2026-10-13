import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as Sentry from '@sentry/node';
import { initSentry, observeHttpFailures } from '../services/observability/sentry.js';

process.env.SENTRY_DSN = 'https://public@o0.ingest.sentry.io/1';
initSentry();
const options = Sentry.getClient().getOptions();
const redacted = options.beforeSend({
  request: { url: 'https://example.test?token=secret', headers: { Authorization: 'secret', Cookie: 'secret' }, data: { password: 'secret' }, cookies: 'secret' },
  user: { email: 'person@example.test' }, extra: { password: 'secret' },
  exception: { values: [{ value: 'person@example.test Bearer abc https://example.test?key=secret' }] },
});
assert.deepEqual(redacted.request.headers, {});
assert.equal(redacted.request.url, '[REDACTED]');
assert.equal(redacted.user, undefined);
assert.equal(redacted.extra, undefined);
assert.ok(!JSON.stringify(redacted).includes('secret'));

const events = [];
Sentry.init({ dsn: process.env.SENTRY_DSN, defaultIntegrations: false,
  beforeSend(event) { events.push(event); return null; } });
function finish(status, sentry) {
  const res = new EventEmitter(); res.statusCode = status; res.sentry = sentry;
  observeHttpFailures({ method: 'POST', route: { path: '/sources' }, body: { password: 'secret' } }, res, () => {});
  res.emit('finish');
}
finish(404); finish(503); finish(500, 'already-captured');
await Sentry.flush(1000);
assert.equal(events.length, 1, 'capture handled 5xx, skip expected 4xx and already-captured exceptions');
assert.equal(events[0].tags.status, '503');
assert.ok(!JSON.stringify(events).includes('secret'));
await Sentry.close(1000);
delete process.env.SENTRY_DSN;
console.log('OK Sentry captures handled server failures with privacy filtering');
