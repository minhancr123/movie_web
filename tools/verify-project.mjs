import { execFileSync } from 'node:child_process';
import path from 'node:path';

/**
 * Run npm via the Node binary directly, avoiding shell:false EINVAL on Windows.
 * P2 fix: `spawn('npm', ...)` with shell:false throws EINVAL on Windows Node 24
 * because npm is a .cmd shim. Using process.execPath + npm-cli.js is portable.
 */
function npmRun(args, cwd) {
    const npmCli = path.join(
        path.dirname(process.execPath),
        'node_modules', 'npm', 'bin', 'npm-cli.js'
    );
    execFileSync(process.execPath, [npmCli, ...args], {
        cwd,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: undefined },
    });
}

export function verifyProject(rootDir) {
    const root = rootDir || process.cwd();
    console.log('Verifying project...');

    const frontendDir = path.join(root, 'frontend');
    npmRun(['run', 'build'], frontendDir);
    npmRun(['test'], frontendDir);

    const backendDir = path.join(root, 'backend-node');
    npmRun(['test'], backendDir);

    console.log('Project verified successfully.');
}

// ESM entry‑point guard (works on both POSIX and Windows)
const entry = new URL(import.meta.url).pathname
    .replace(/^\/([A-Z]:)/i, '$1'); // strip leading / before drive letter on Windows
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(entry)) {
    verifyProject();
}
