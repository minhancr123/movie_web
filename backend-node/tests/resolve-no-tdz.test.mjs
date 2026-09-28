/**
 * The resolve path must not read a binding before its declaration.
 *
 * Shipped exactly that: the disk-fit fallback read `fullDurationSeconds`
 * several hundred lines above its `const`, so every fresh remux resolve
 * threw `ReferenceError: Cannot access before initialization` and the film
 * failed instead of falling back to direct play. The log line that gave it
 * away: "resolvePlayback error tmdb=1413: Cannot access
 * 'fullDurationSeconds' before initialization".
 *
 * A whole-controller run needs DB and providers, so this pins the property
 * statically instead: no code reference to the binding may appear above its
 * declaration. Comments are stripped first — prose is allowed to name it.
 *
 * Run: node tests/resolve-no-tdz.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
// Split on \r?\n, not \n: this file uses CRLF, and a trailing \r defeats the
// comment strip below — `.` never matches `\r`, so `//.*$` cannot match and
// every comment would read as code.
const src = readFileSync(
  path.join(root, 'controllers', 'playbackController.js'),
  'utf8',
).split(/\r?\n/);

const codeOf = (line) => line.replace(/\/\/.*$/, '');

const declarationIdx = src.findIndex((line) =>
  /^\s*const fullDurationSeconds\s*=/.test(line),
);
assert.ok(declarationIdx > 0, 'fullDurationSeconds is declared once with const');

const earlyUses = [];
src.forEach((line, idx) => {
  if (idx >= declarationIdx) return;
  if (codeOf(line).includes('fullDurationSeconds')) earlyUses.push(idx + 1);
});
assert.deepEqual(
  earlyUses,
  [],
  `fullDurationSeconds read before its declaration at line(s): ${earlyUses.join(', ')}`,
);
console.log('ok - resolve never reads fullDurationSeconds before its declaration');
