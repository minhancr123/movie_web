/**
 * A reused session must hand back the published rendition, not its own URL.
 *
 * The session's stored playlistUrl is per-session, which means the segment route
 * runs an owner check and a session lookup per segment and nothing is cacheable.
 * Once ffmpeg has finished, those exact bytes are also a content-addressed
 * rendition served from /hls/r/<id>/ with a one-year immutable header — shared by
 * every viewer, and cached by the browser after the first one.
 *
 * Measured: a completed episode 1 was published as d72cd8377 (774 segments,
 * 450 MB, lastAccessAt updating) while players were still being handed
 * /hls/<sessionId>/index.m3u8.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../controllers/playbackController.js', import.meta.url),
  'utf8',
);

const failures = [];
const check = (name, condition) => {
  if (!condition) failures.push(name);
};

// Isolate the reuse branch, not the whole resolve: the fresh path already returns
// the stable URL, and a match anywhere in the file would prove nothing.
const reuseAt = source.indexOf('const reusable = await findReusableRemuxSession');
check('reuse-branch-found', reuseAt > 0);
const freshAt = source.indexOf('const stablePlaylistUrl =');
const reuseBranch = source.slice(reuseAt, freshAt > reuseAt ? freshAt : reuseAt + 4000);

check(
  'reuse-consults-published-rendition',
  /findPublishedRendition\(db, reusable\.renditionKey\)/.test(reuseBranch),
  );
check(
  'reuse-returns-the-stable-url',
  /\/api\/playback\/hls\/r\/\$\{reuseRenditionId\}\/index\.m3u8/.test(reuseBranch),
);
check(
  'reuse-still-falls-back-to-session-url',
  /reusePlaylistUrl = reusable\.playlistUrl/.test(reuseBranch),
  );
check('reuse-reports-the-rendition-id', /publishedRenditionId: reuseRenditionId/.test(reuseBranch));
// The raw field must no longer be handed out unconditionally.
check(
  'reuse-no-longer-returns-the-raw-field',
  !/playlistUrl: reusable\.playlistUrl,/.test(reuseBranch),
);
// A lookup failure must not fail the resolve: reuse is an optimisation here.
check(
  'lookup-failure-is-contained',
  /\.catch\(\(\) => null\)/.test(reuseBranch),
);

// findPublishedRendition must check the files, not just the row, or this hands
// out a URL to a rendition the budget already evicted.
const finderAt = source.indexOf('const findPublishedRendition = async');
const finder = source.slice(finderAt, finderAt + 500);
check('finder-validates-disk-state', /readRenditionState\(/.test(finder));
check('finder-drops-a-dead-row', /deleteOne\(\{ renditionId: renditionKey \}\)/.test(finder));

if (failures.length) {
  console.error(`FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log('ok - a reused session serves the shared, immutable rendition');
console.log('All reuse-rendition-url tests passed!');
process.exit(0);
