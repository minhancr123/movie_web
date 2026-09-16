/**
 * The dialogue-forward surround fold, and — just as important — the cases that
 * must NOT get it. Pointing the matrix at a source with no centre channel fails
 * the whole ffmpeg command, which takes playback down entirely, so the gate
 * matters more than the coefficients.
 *
 * Coefficients themselves were measured against real AC-3 5.1 through the
 * production encode, not derived on paper. Old `-ac 2` put dialogue 7.0 dB
 * BELOW the front bed; this fold puts it 5.0 dB above.
 */
import assert from 'node:assert/strict';
import {
  buildFfmpegArgs,
  decidePlaybackMode,
  parseFrameRate,
} from '../services/playback/remuxService.js';

const argsFor = (opts) => buildFfmpegArgs({ inputUrl: 'in.mkv', outputDir: '/out', ...opts });
const afOf = (args) => (args.includes('-af') ? args[args.indexOf('-af') + 1] : null);

/* ------------------------------------------------------------- gating */

// Surround gets the fold; everything else keeps the plain downmix.
for (const channels of [6, 7, 8]) {
  const args = argsFor({ audioChannels: channels });
  assert.ok(afOf(args), `${channels}ch must use the fold`);
  assert.ok(!args.includes('-ac'), `${channels}ch must not also pass -ac (pan already emits stereo)`);
}

// A stereo/mono source has no FC for the matrix to name: pan would abort ffmpeg.
// Unknown (null) is the ffprobe-didn't-say case and must stay on the safe path.
for (const channels of [null, undefined, 1, 2, 5]) {
  const args = argsFor({ audioChannels: channels });
  assert.equal(afOf(args), null, `channels=${channels} must not get the fold`);
  assert.deepEqual(args.slice(args.indexOf('-ac'), args.indexOf('-ac') + 2), ['-ac', '2']);
}

// Copying audio means no filtering at all, whatever the layout.
const copied = argsFor({ audioCopy: true, audioChannels: 6 });
assert.equal(afOf(copied), null, 'audioCopy must never filter');
assert.ok(!copied.includes('-ac') && !copied.includes('-b:a'));
console.log('ok - fold applies to surround only, never to stereo/unknown/copy');

/* -------------------------------------------------------- filter shape */

const filter = afOf(argsFor({ audioChannels: 6 }));

// Without this pre-fold a 7.1 source loses SL/SR outright (measured at -91 dB):
// the matrix names only BL/BR. It also rewrites the very common 5.1(side)
// layout, which likewise has no BL/BR at all.
assert.match(filter, /^aformat=channel_layouts=5\.1,/, 'fold must normalise layout first');

// Centre must outweigh the front bed — this is the entire point of the change.
// Parsed by splitting rather than regex: the coefficients are the assertion,
// and an escaping slip in a pattern would silently read them all as zero.
const flExpr = filter.split('|FL=')[1].split('|')[0];
const gain = (ch) => {
  const term = flExpr.split('+').find((t) => t.endsWith(`*${ch}`));
  return term ? Number(term.split('*')[0]) : 0;
};
assert.ok(gain('FC') > gain('FL'), 'centre must sit above the fronts');
assert.ok(gain('FL') > gain('BL'), 'fronts must sit above the surrounds');

// The coefficient sum exceeds 1, so the limiter is load-bearing for the
// fully-correlated worst case, where it holds -0.4 dB instead of clipping.
assert.ok(gain('FC') + gain('FL') + gain('BL') > 1, 'sum >1 is why the limiter is required');
assert.match(filter, /alimiter=/, 'limiter must be present whenever the sum can exceed 1');
console.log('ok - centre-forward coefficients, layout normalised, clipping guarded');

/* ------------------------------------------------- decision plumbing */

// The channel count has to survive decidePlaybackMode or the fold never fires.
const probe = {
  format: 'matroska,webm',
  video: { codec: 'h264' },
  audio: [{ index: 1, streamIndex: 1, codec: 'ac3', channels: 6, language: 'eng' }],
};
const decision = decidePlaybackMode(probe, { hevc: true, av1: true });
assert.equal(decision.mode, 'remux');
assert.equal(decision.audioChannels, 6, 'decision must carry channels through to the fold');
assert.ok(afOf(argsFor({ audioChannels: decision.audioChannels, audioCopy: decision.audioCopy })));

// A stereo AAC track that still needs remuxing must not pick up the fold.
const stereoProbe = {
  format: 'matroska,webm',
  video: { codec: 'h264' },
  audio: [{ index: 1, streamIndex: 1, codec: 'aac', profile: 'LC', channels: 2, language: 'eng' }],
};
const stereoDecision = decidePlaybackMode(stereoProbe, { hevc: true, av1: true });
assert.equal(stereoDecision.audioChannels, 2);
assert.equal(afOf(argsFor({ audioChannels: stereoDecision.audioChannels })), null);
console.log('ok - decidePlaybackMode carries channel count end to end');

/* ---------------------------------------------- high-frame-rate rejection */

// This is the exact average rate measured from the frozen 1080p HEVC session.
assert.equal(Number(parseFrameRate('45497/316').toFixed(2)), 143.98);
assert.equal(parseFrameRate('60000/1001') < 60, true, '59.94 fps remains normal');

const highFrameRateDecision = decidePlaybackMode(
  {
    ...probe,
    video: { codec: 'hevc', frameRate: parseFrameRate('45497/316') },
  },
  { hevc: true, av1: true },
);
assert.equal(highFrameRateDecision.mode, 'reject');
assert.match(highFrameRateDecision.reason, /143\.98 fps/);

const normalFrameRateDecision = decidePlaybackMode(
  {
    ...probe,
    video: { codec: 'hevc', frameRate: parseFrameRate('60000/1001') },
  },
  { hevc: true, av1: true },
);
assert.equal(normalFrameRateDecision.mode, 'remux');
console.log('ok - 143.98 fps HEVC rejected while 59.94 fps remains playable');

/* ------------------------------------------- superseded remux selection */

/**
 * The rule that stops a retry from piling a second full-speed remux on top of
 * the first. The dangerous mistake is stopping the session just created, which
 * would kill playback outright, so that is pinned first.
 */
const { selectSupersededRemuxes } = await import('../services/playback/remuxService.js');

const live = (ids) => (id) => ids.includes(id);

// Never stop the session we are about to hand the viewer.
assert.deepEqual(
  selectSupersededRemuxes(['a', 'keep', 'b'], 'keep', live(['a', 'keep', 'b'])),
  ['a', 'b'],
  'the new session must never be selected',
);

// Already-dead sessions need no killing, and must not be reported as stopped.
assert.deepEqual(
  selectSupersededRemuxes(['a', 'b'], 'keep', live(['b'])),
  ['b'],
  'only sessions with a running ffmpeg are worth stopping',
);

// Nothing prior, nothing live, and junk ids must all be no-ops.
assert.deepEqual(selectSupersededRemuxes([], 'keep', live(['a'])), []);
assert.deepEqual(selectSupersededRemuxes(['a'], 'keep', () => false), []);
assert.deepEqual(selectSupersededRemuxes([null, undefined, ''], 'keep', () => true), []);
assert.deepEqual(selectSupersededRemuxes(undefined, 'keep'), [], 'missing input must not throw');
console.log('ok - superseded remuxes selected without ever stopping the new one');

/* ---------------------------------- superseded-stop grace period bindings */

const {
  scheduleSupersededStop,
  cancelScheduledStop,
  stopRemuxSession,
} = await import('../services/playback/remuxService.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Scheduling is idempotent per session: the second call is a no-op.
assert.equal(scheduleSupersededStop('grace-probe-a', 5000), true);
assert.equal(scheduleSupersededStop('grace-probe-a', 5000), false);
// Junk ids never arm a timer.
assert.equal(scheduleSupersededStop('', 10), false);
assert.equal(scheduleSupersededStop(null, 10), false);
// Cancelling twice reports accordingly, and a cancelled timer never fires.
assert.equal(cancelScheduledStop('grace-probe-a'), true);
assert.equal(cancelScheduledStop('grace-probe-a'), false);
assert.equal(cancelScheduledStop('never-scheduled'), false);
// A fired grace timer stops a live-tracked session; stopping twice is safe.
assert.equal(scheduleSupersededStop('grace-probe-b', 15), true);
await sleep(60);
assert.equal(await stopRemuxSession('grace-probe-b'), false);
console.log('ok - superseded-stop grace arms once, cancels cleanly, fires safely');
