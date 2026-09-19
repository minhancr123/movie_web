/**
 * Which browser origins the API answers.
 *
 * docker-compose.prod.yml passes CORS_ORIGIN and FRONTEND_URL, and server.js
 * ignored both in favour of a list hardcoded during an earlier deployment. A
 * new domain therefore fails every request with a CORS error while the compose
 * file says, plainly, that the domain is configured — about the least
 * debuggable shape a deployment problem can take.
 *
 * Run: node tests/cors-origins.test.mjs
 */
import assert from 'node:assert/strict';
import { parseAllowedOrigins, DEV_ORIGINS } from '../config/cors.js';

/* ----------------------------------------------------------- configured */

assert.deepEqual(
  parseAllowedOrigins({ CORS_ORIGIN: 'https://phim.example.com', NODE_ENV: 'production' }),
  ['https://phim.example.com'],
  'production answers exactly what it was told to',
);
assert.deepEqual(
  parseAllowedOrigins({ CORS_ORIGIN: 'https://a.test, https://b.test', NODE_ENV: 'production' }),
  ['https://a.test', 'https://b.test'],
  'comma separated, whitespace tolerated',
);
// FRONTEND_URL is the same thing under another name; both are in the compose.
assert.deepEqual(
  parseAllowedOrigins({ FRONTEND_URL: 'https://phim.example.com', NODE_ENV: 'production' }),
  ['https://phim.example.com'],
);
assert.deepEqual(
  parseAllowedOrigins({
    CORS_ORIGIN: 'https://a.test', FRONTEND_URL: 'https://a.test/', NODE_ENV: 'production',
  }),
  ['https://a.test'],
  'trailing slash is the same origin, listed once',
);

/* --------------------------------------------------------------- safety */

// Nothing configured in production is a misconfiguration, not an invitation:
// never widen to "*", and never silently keep a previous deployment's domain.
assert.deepEqual(parseAllowedOrigins({ NODE_ENV: 'production' }), [],
  'unconfigured production allows nothing rather than everything');
assert.ok(!parseAllowedOrigins({ CORS_ORIGIN: '*', NODE_ENV: 'production' }).includes('*'),
  'a literal * is refused');

// Development keeps the local origins without anyone configuring them.
const dev = parseAllowedOrigins({ NODE_ENV: 'development' });
for (const o of DEV_ORIGINS) assert.ok(dev.includes(o), `dev keeps ${o}`);
assert.ok(
  parseAllowedOrigins({ CORS_ORIGIN: 'https://a.test', NODE_ENV: 'development' })
    .includes('http://localhost:3000'),
  'and keeps them alongside a configured one',
);

// Junk entries are dropped, not passed to the cors middleware.
assert.deepEqual(
  parseAllowedOrigins({ CORS_ORIGIN: 'https://a.test,,  ,not a url', NODE_ENV: 'production' }),
  ['https://a.test'],
);
console.log('ok - allowed origins come from the environment the deployment sets');
