import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

// Wiping .next on every `dev` start made every restart a full cold start:
// recompiling all routes, re-downloading 4 Google Font families, dropping the
// ISR cache. First visit then sat on a black page slot (header streamed, page
// pending on compile + cold backend fetch) long enough to read as broken.
// Default dev keeps the cache; the wipe lives behind dev:clean for the stale
// vendor-chunk case it was originally added for.
test('default dev keeps the Next.js cache for fast restarts', () => {
  assert.equal(packageJson.scripts.dev, 'next dev', 'scripts.dev must not wipe .next');
});

test('dev:clean removes a stale Next.js build before startup', () => {
  const command = packageJson.scripts['dev:clean'];
  const match = String(command || '').match(/^node -e "(.+)" && next dev$/);

  assert.ok(match, 'scripts.dev:clean must clean .next before running next dev');

  const fixture = mkdtempSync(join(tmpdir(), 'movie-web-next-cache-'));
  const staleChunk = join(fixture, '.next', 'server', 'vendor-chunks', 'axios.js');
  mkdirSync(dirname(staleChunk), { recursive: true });
  writeFileSync(staleChunk, 'stale');

  try {
    const result = spawnSync(process.execPath, ['-e', match[1]], {
      cwd: fixture,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(fixture, '.next')), false, 'stale .next cache should be removed');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
