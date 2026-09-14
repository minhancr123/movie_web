import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

test('default dev command removes a stale Next.js build before startup', () => {
  const command = packageJson.scripts.dev;
  const match = command.match(/^node -e "(.+)" && next dev$/);

  assert.ok(match, 'scripts.dev must clean .next before running next dev');

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
