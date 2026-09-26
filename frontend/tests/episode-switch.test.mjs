/**
 * Switching episodes must not go through the router.
 *
 * The watch page is an async Server Component behind a route-level loading.tsx,
 * so an episode change used to be a navigation: the fallback replaced the whole
 * subtree, the <video> element was destroyed, playback had to resolve again
 * from scratch, and the episode strip came back as a new node at scrollLeft 0.
 * The server was never the slow part (measured TTFB 117-142ms, season warm in
 * Redis) — the teardown was.
 *
 * These assertions read the component source rather than importing it: the
 * invariants are about which mechanism is used (client state + replaceState,
 * no router) and about a ref that must stay scoped to the episode. Both are
 * exactly the kind of thing a well-meaning refactor silently puts back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = readFileSync(path.join(root, 'src/components/PlaybackSection.tsx'), 'utf8');

test('the episode switch is client state, not a navigation', () => {
  assert.match(source, /const \[switchedEpisode, setSwitchedEpisode\] = useState<number \| null>\(null\)/,
    'the switch lives in component state');
  assert.match(source, /const currentEpisode = switchedEpisode \?\? episode \?\? null;/,
    'the switch overrides the URL-derived prop until a real navigation resets it');
  assert.match(source, /window\.history\.replaceState\(null, '', ep\.href\)/,
    'the address bar is corrected without a navigation');
  // A router push here would re-render the page and re-unmount the player, which
  // is the whole thing this change exists to avoid.
  assert.doesNotMatch(source, /router\.push\(ep\.href/,
    'no router.push on an episode click');
  // Modified clicks must still reach the browser, or "open in new tab" dies.
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    assert.ok(source.includes(`clickEvent.${modifier}`), `${modifier} is left to the browser`);
  }
  assert.match(source, /clickEvent\.preventDefault\(\)/, 'a plain left click is intercepted');
});

test('every resolve asks for the episode actually on screen', () => {
  const requests = source.match(/episode: currentEpisode \?\? undefined,/g) || [];
  assert.equal(requests.length, 3,
    'resolve, recover and the provider-connect path all send currentEpisode');
  assert.doesNotMatch(source, /episode: episode \?\? undefined/,
    'nothing still sends the stale prop');
  // If any dep array still watched the prop, the re-resolve chain would break.
  assert.doesNotMatch(source, /\[type, tmdbId, season, episode[,\]]/,
    'no effect still keys on the prop instead of currentEpisode');
});

test('the resume seed is scoped to the episode, not to the mount', () => {
  // This was a boolean owned by the component's lifetime, which only worked
  // because every switch remounted the page. With client-side switching the same
  // instance survives, so a boolean would hand the seed to episode 1 and start
  // every later episode from 0.
  assert.match(source, /const seedConsumedForRef = useRef<string \| null>\(null\)/);
  const uses = source.match(/seedConsumedForRef\.current === episodeSlug \? 0 : getResumeSeed\(\)/g) || [];
  assert.equal(uses.length, 2, 'both auto-start and provider-connect consult it');
  assert.doesNotMatch(source, /didInitialResolveRef/,
    'the mount-scoped boolean is gone');
});

test('the episode strip follows the episode that is on screen', () => {
  assert.match(source, /\}, \[currentEpisode, episodes\.length, revealActiveEpisode\]\)/,
    'the reveal re-runs on the effective episode');
  assert.match(source, /const isActive = ep\.episodeNumber === currentEpisode;/,
    'the highlight follows the effective episode');
  assert.match(source, /typeof currentEpisode === 'number'/,
    'the badge follows the effective episode');
  // One reveal pass is not enough on a rebuilt node: the pass that runs on mount
  // measures before the browser settles a width, and episodeScrollTarget answers
  // "do nothing" in that case — which is how the strip stayed on episode 1.
  assert.match(source, /requestAnimationFrame\(\(\) => \{\s*if \(!cancelled\) revealActiveEpisode\(\);/,
    're-reveal after a frame');
  assert.match(source, /new ResizeObserver\(\(\) => revealActiveEpisode\(\)\)/,
    're-reveal when the strip is resized, e.g. on rotation');
});
