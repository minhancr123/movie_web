import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'api-base-'));
execFileSync(process.execPath,
    [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), 'src/lib/apiBase.ts',
        '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020',
        '--moduleResolution', 'node', '--skipLibCheck'],
    { cwd: root, stdio: 'pipe' });
const { resolveApiBase } = await import(pathToFileURL(path.join(outDir, 'apiBase.js')).href);
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));

const PUB = 'https://phim.example.com/api';
const INT = 'http://backend-node:5001/api';

test('the browser only ever uses the public address', () => {
    assert.equal(resolveApiBase({ isServer: false, internal: INT, publicUrl: PUB }), PUB);
    // A private hostname in a browser is unreachable, so it must never win.
    assert.equal(resolveApiBase({ isServer: false, internal: INT, publicUrl: null }),
        'http://localhost:5001/api', 'falls back rather than handing out a private host');
});

test('the server prefers the private address when there is one', () => {
    assert.equal(resolveApiBase({ isServer: true, internal: INT, publicUrl: PUB }), INT,
        'avoids looping back through the proxy');
    assert.equal(resolveApiBase({ isServer: true, internal: null, publicUrl: PUB }), PUB,
        'optional: a deployment that sets neither still works');
    assert.equal(resolveApiBase({ isServer: true, internal: '', publicUrl: PUB }), PUB,
        'blank is not a configuration');
    assert.equal(resolveApiBase({ isServer: true, internal: '   ', publicUrl: PUB }), PUB);
});

test('trailing slashes never double up in a built URL', () => {
    assert.equal(resolveApiBase({ isServer: false, publicUrl: 'https://x.test/api/' }), 'https://x.test/api');
    assert.equal(resolveApiBase({ isServer: true, internal: 'http://b:5001/api//' }), 'http://b:5001/api');
});

test('nothing configured falls back to local development', () => {
    assert.equal(resolveApiBase({ isServer: true }), 'http://localhost:5001/api');
    assert.equal(resolveApiBase({ isServer: false }), 'http://localhost:5001/api');
});
