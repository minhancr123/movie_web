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

// Execute the real ranking branches, then read the policy from the same scope
// used by codec/delivery selection. This catches branch-local bindings without
// needing a provider account or MongoDB.
const controller = src.join('\n');
const rankStart = controller.indexOf('    // 5. Rank for this client.');
const rankEnd = controller.indexOf('    const reuseAttempts =', rankStart);
assert.ok(rankStart > 0 && rankEnd > rankStart, 'locate production ranking boundary');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const runRanking = new AsyncFunction('ctx', `
  const {req,res,sourceToken,enriched,caps,runtimeMinutes,detail,SOURCE_TOKEN_PATTERN,
    matchCandidateToken,resolveVideoTranscodeCapability,rankCandidates,titleExpectation,
    fail,selectFallbackAttempts,MAX_ATTEMPTS} = ctx;
  ${controller.slice(rankStart, rankEnd)}
  return {attempts, playable, videoTranscode};
`);
for (const pinned of [false, true]) {
  for (const allowed of [false, true]) {
    const policy = { allowed };
    const first = { infoHash: 'a'.repeat(40), playable: true };
    const second = { infoHash: 'b'.repeat(40), playable: true };
    let policyCalls = 0;
    const result = await runRanking({
      req: { body: {} }, res: {}, sourceToken: pinned ? first.infoHash : null,
      enriched: [first, second], caps: {}, runtimeMinutes: 120, detail: { originalLanguage: 'en' },
      SOURCE_TOKEN_PATTERN: /^[a-f0-9]{40}$/, MAX_ATTEMPTS: 5,
      matchCandidateToken: (candidate, token) => candidate.infoHash === token,
      resolveVideoTranscodeCapability: async () => { policyCalls++; return policy; },
      rankCandidates: (candidates, caps, options) => {
        assert.equal(options.videoTranscode, policy);
        assert.equal(candidates.length, pinned ? 1 : 2);
        return { best: candidates[0], playable: candidates, rejected: [] };
      },
      titleExpectation: () => ({}),
      fail: () => { throw new Error('Unexpected rejection'); },
      selectFallbackAttempts: candidates => candidates,
    });
    assert.equal(policyCalls, 1, 'evaluate policy once per resolve');
    assert.equal(result.videoTranscode, policy, 'codec and delivery steps share the ranked policy');
    assert.equal(result.attempts.length, pinned ? 1 : 2);
    if (!pinned) assert.equal(result.playable.length, 2, 'fallback candidates survive the ranking scope');
  }
}
console.log('ok - automatic and pinned resolve retain transcode policy for downstream playback');
