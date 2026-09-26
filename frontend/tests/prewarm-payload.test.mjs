import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const link = readFileSync(path.join(root, 'src/components/PrewarmWatchLink.tsx'), 'utf8');
const row = readFileSync(path.join(root, 'src/components/ContinueWatchingRow.tsx'), 'utf8');

test('a prewarm only names an episode when the pair is complete and valid', () => {
  // parseResolveBody answers 400 for a TV prewarm that carries either key
  // without a valid partner, or an episode below 1. Sending the keys
  // independently is how a watch-history row with an empty currentEpisode became
  // episode 0 and a 400 that the server never explained.
  assert.match(link, /Number\.isInteger\(seasonNumber\) && seasonNumber >= 0/, 'season must be a non-negative integer');
  assert.match(link, /Number\.isInteger\(episodeNumber\) && episodeNumber > 0/, 'episode must be a positive integer');
  assert.match(link, /\.\.\.\(pair \? \{ season: seasonNumber, episode: episodeNumber \} : \{\}\)/,
    'both keys or neither — never one alone');
  assert.doesNotMatch(link, /\.\.\.\(season != null \? \{ season \}/,
    'the per-key spread that produced the 400 is gone');
  // A movie prewarm must not carry them at all: a season on a movie is
  // meaningless and the same 400 applies if it is non-numeric.
  assert.match(link, /const wantsEpisode = type === 'tv'/, 'episode keys are TV-only');
});

test('watch-history numbers are read strictly, not with Number()', () => {
  // Number('') is 0, Number(null) is 0, and both are "finite" — which is the
  // test that let an empty currentEpisode through as episode 0.
  assert.match(row, /const positiveInt = \(value: unknown\): number \| null => \{\s*const n = Number\(value\);\s*return Number\.isInteger\(n\) && n > 0 \? n : null;/,
    'positiveInt requires an integer above 0');
  assert.match(row, /const nonNegativeInt = \(value: unknown\): number \| null => \{\s*const n = Number\(value\);\s*return Number\.isInteger\(n\) && n >= 0 \? n : null;/,
    'nonNegativeInt allows season 0 (specials) but not NaN');
  assert.doesNotMatch(row, /Number\.isFinite\(Number\(movie\.currentEpisode\)\)/,
    'the isFinite test that accepted 0 is gone');
});
