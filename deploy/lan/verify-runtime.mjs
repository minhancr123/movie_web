/** Verify archived source against Git, plus the release IDs actually served.
 * Usage: node verify-runtime.mjs RUNTIME_ROOT GIT_REPO FULL_SHA [--health]
 * Reads only whitelisted env fields; never prints runtime secrets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const [root, repo, sha, health] = process.argv.slice(2);
if (!root || !repo || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Expected runtime root, Git repository and full SHA');
const tree = execFileSync('git', ['ls-tree', '-rz', sha, 'frontend', 'backend-node'], { cwd: repo }).toString();
const failures = []; let checked = 0;
for (const entry of tree.split('\0').filter(Boolean)) {
  const [metadata, file] = entry.split('\t');
  const [, type, expected] = metadata.split(' ');
  if (type !== 'blob') continue;
  try {
    const bytes = await fs.readFile(path.join(root, file));
    const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
    if (actual !== expected) failures.push(`source differs: ${file}`);
    checked++;
  } catch { failures.push(`source missing: ${file}`); }
}
for (const file of ['backend-node/.env', 'frontend/.env.production', 'frontend/.next/standalone/.env.production']) {
  const text = await fs.readFile(path.join(root, file), 'utf8');
  const release = /^RELEASE_ID=(.*)$/m.exec(text)?.[1]?.trim();
  if (release !== sha) failures.push(`release ID differs: ${file}`);
}
if (health === '--health') {
  for (const [name, url] of [['backend', 'http://127.0.0.1:5001/healthz'], ['frontend', 'http://127.0.0.1:3000/api/health']]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      if (!response.ok || data.release !== sha) failures.push(`${name} served release differs`);
    } catch { failures.push(`${name} health unavailable`); }
  }
}
console.log(JSON.stringify({ release: sha, checked, failures }, null, 2));
if (failures.length) process.exitCode = 1;
