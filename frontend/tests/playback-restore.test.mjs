import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const out = mkdtempSync(path.join(tmpdir(), 'playback-restore-'));
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'),
  'src/lib/playback-restore.ts', '--outDir', out, '--module', 'commonjs',
  '--target', 'es2020', '--moduleResolution', 'node', '--skipLibCheck'], { cwd: root });
const { restoreBeforePlayback, restorePlayIntent, nativeSeekCovered, pipelineRestoreTarget, canRetryNativeWithMse } = await import(pathToFileURL(path.join(out, 'playback-restore.js')));
test('Safari metadata-only restore may switch loader once without treating metadata as a decoded frame',()=>{
 assert.equal(canRetryNativeWithMse(true,true,1,false,null),true);
 for(const args of [[false,true,1,false,null],[true,false,1,false,null],[true,true,2,false,null],
   [true,true,1,true,null],[true,true,1,false,3],[true,true,0,false,null]])assert.equal(canRetryNativeWithMse(...args),false);
 const checkpoint={delivery:'same-source',requested:27,position:27};
 assert.equal(pipelineRestoreTarget('same-source',27,checkpoint,null),27);
 assert.equal(restorePlayIntent(true,true,false,true),true);
 assert.equal(restorePlayIntent(true,true,true,false),false);
});
process.on('exit', () => rmSync(out, { recursive: true, force: true }));

class Media extends EventTarget {
  readyState = 0;
  seeking = false;
  paused = false;
  position = 0;
  assignments = [];
  get currentTime() { return this.position; }
  set currentTime(at) {
    if (!this.readyState) throw new Error('No metadata');
    this.assignments.push(at);
    this.seeking = true; // WebKit has not presented the requested frame yet.
  }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  event(type) { this.dispatchEvent(new Event(type)); }
}

test('a playing seek keeps its intent despite internal pauses; a paused seek stays paused', () => {
  assert.equal(restorePlayIntent(true, true, true, true), true);
  assert.equal(restorePlayIntent(true, false, false, false), false);
  assert.equal(restorePlayIntent(true, true, true, null), false);
  assert.equal(restorePlayIntent(false, false, false, null), true);
});

test('27:27 restore does not play the 26:51 keyframe before seeked and a decoded frame', () => {
  const media = new Media();
  const target = 1647 - 1611.61;
  const playedAt = [];
  const cancel = restoreBeforePlayback(media, target, {
    ready: () => playedAt.push(media.currentTime), failed: () => assert.fail('unexpected timeout'),
  });
  assert.equal(media.paused, true);
  assert.deepEqual(media.assignments, []);
  media.readyState = 1; media.event('loadedmetadata');
  assert.deepEqual(media.assignments, [target]);
  media.readyState = 2; media.event('canplay'); // Old frame, seek still running.
  assert.deepEqual(playedAt, []);
  media.position = target; media.seeking = false; media.readyState = 1; media.event('seeked');
  assert.deepEqual(playedAt, [], 'metadata without a decoded frame is insufficient');
  media.readyState = 2; media.event('canplay');
  assert.deepEqual(playedAt, [target]);
  media.event('loadedmetadata'); media.event('seeked');
  assert.deepEqual(playedAt, [target], 'late metadata cannot repeat the seek or playback');
  cancel();
});

test('native HLS waits for target coverage and cancelling a pipeline removes callbacks', () => {
  const media = new Media(); media.readyState = 2;
  let head = 4; let ready = 0;
  const cancel = restoreBeforePlayback(media, 35.39, {
    covered: () => head >= 35.89, ready: () => ready++, failed: () => assert.fail(),
  });
  media.event('progress'); assert.deepEqual(media.assignments, []);
  head = 40; media.event('progress'); assert.deepEqual(media.assignments, [35.39]);
  cancel(); media.position = 35.39; media.seeking = false; media.event('seeked');
  assert.equal(ready, 0);
});

test('fresh native decoder loads initial data before seeking; never plays origin or settles on metadata', async () => {
  const media = new Media(); media.readyState = 1;
  let ready = 0, primed = 0;
  const cancel = restoreBeforePlayback(media, 3.183, {
    covered: () => true, waitForInitialData: true, primeWhenCovered: true,
    prime: () => primed++, ready: () => ready++, failed: () => assert.fail('unexpected timeout'),
  });
  media.event('loadedmetadata'); media.event('progress');
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.deepEqual(media.assignments, [], 'an exact seek must not interrupt initial native decoding');
  assert.equal(primed, 0, 'preloading must not play the origin as a workaround');
  assert.equal(ready, 0);
  media.readyState = 2; media.event('loadeddata');
  assert.deepEqual(media.assignments, [3.183]);
  assert.equal(ready, 0, 'the origin frame is not the destination');
  media.position = 3.183; media.seeking = false; media.event('seeked');
  assert.equal(ready, 1);
  cancel();
});

test('native HLS seeks a prepared playlist before downloading the destination, then waits for its frame',()=>{
 const media=new Media();media.readyState=1;media.duration=900;
 media.seekable=media.buffered={length:0};let ready=0;
 const cancel=restoreBeforePlayback(media,688,{covered:()=>nativeSeekCovered(media,688),ready:()=>ready++,failed:()=>assert.fail()});
 assert.deepEqual(media.assignments,[688],'request the remote destination without waiting for its buffered range');
 assert.equal(ready,0);
 media.position=688;media.seeking=false;media.event('seeked');assert.equal(ready,0);
 media.readyState=2;media.event('loadeddata');assert.equal(ready,1);
 cancel();
 assert.equal(nativeSeekCovered({...media,duration:300},688),false,'short playlist is not the advertised full-film duration');
 assert.equal(nativeSeekCovered({...media,duration:Infinity},688),false,'unknown live extent must not invent coverage');
});

test('synchronous currentTime changes still wait for the actual seeked event', () => {
  const media = new Media(); media.readyState = 2;
  Object.defineProperty(media, 'currentTime', {
    get: () => media.position,
    set: at => { media.position = at; media.assignments.push(at); },
  });
  let ready = 0;
  restoreBeforePlayback(media, 35.39, { ready: () => ready++, failed: () => assert.fail() });
  assert.equal(ready, 0);
  media.event('canplay'); assert.equal(ready, 0);
  media.event('seeked'); assert.equal(ready, 1);
});

test('starting at zero needs a decoded first frame without a redundant seek', () => {
  const media = new Media(); let ready = 0;
  restoreBeforePlayback(media, 0, { ready: () => ready++, failed: () => assert.fail() });
  media.readyState = 1; media.event('loadedmetadata'); assert.equal(ready, 0);
  media.readyState = 2; media.event('canplay'); assert.equal(ready, 1);
  assert.deepEqual(media.assignments, []);
});

test('a seek snapped backwards times out instead of playing the prefix', async () => {
  const media = new Media(); media.readyState = 2;
  let ready = 0;
  await new Promise(resolve => {
    restoreBeforePlayback(media, 35.39, { timeoutMs: 5, ready: () => ready++, failed: resolve });
    media.seeking = false; media.position = 0; media.event('seeked');
  });
  assert.equal(ready, 0);
  assert.equal(media.paused, true);
});

// Safari can deliver the first frame while paused without a canplay event.
test('native first frame loadeddata releases zero-origin restore without waiting for canplay', () => {
  const media = new Media(); let ready = 0;
  const cancel = restoreBeforePlayback(media, 0, { ready: () => ready++, failed: () => assert.fail() });
  media.readyState = 1; media.event('loadedmetadata'); assert.equal(ready, 0);
  media.readyState = 2; media.position = 0.083; media.event('loadeddata');
  assert.equal(ready, 1); assert.deepEqual(media.assignments, []); cancel();
});

test('a Safari seeked event at metadata-only state settles when loadeddata brings the destination frame', () => {
  const media = new Media(); media.readyState = 1; let ready = 0;
  const cancel = restoreBeforePlayback(media, 98.911, { ready: () => ready++, failed: () => assert.fail() });
  media.position = 98.911; media.seeking = false; media.event('seeked');
  assert.equal(ready, 0);
  media.readyState = 2; media.event('loadeddata');
  assert.equal(ready, 1); cancel();
});

test('MSE reaches the exact 14:52 destination with buffered data but no seeked event', async () => {
  const media = new Media(); media.readyState = 1;
  let ready = 0;
  const cancel = restoreBeforePlayback(media, 1.11, { timeoutMs: 2000, ready: () => ready++, failed: () => assert.fail('stuck restore') });
  media.position = 1.11; media.seeking = false; media.readyState = 4;
  media.buffered = { length: 1, start: () => 0, end: () => 15.936 };
  // No more media events: the bounded observer must still release the UI.
  await new Promise(resolve => setTimeout(resolve, 550));
  assert.equal(ready, 1);
  cancel();
});

test('a decoded destination frame releases a missing-seeked restore, not an old keyframe', () => {
  const media = new Media(); media.readyState = 1;
  let callback; let ready = 0;
  media.requestVideoFrameCallback = fn => { callback = fn; return 1; };
  media.cancelVideoFrameCallback = () => {};
  const cancel = restoreBeforePlayback(media, 35.39, { ready: () => ready++, failed: () => assert.fail() });
  media.position = 35.39; media.seeking = false; media.readyState = 2;
  callback(0, { mediaTime: 0 }); assert.equal(ready, 0);
  callback(0, { mediaTime: 35.39 }); assert.equal(ready, 1);
  cancel();
});

test('missing seeked fallback cannot release an unbuffered target, wrong prefix, or cancelled pipeline', async () => {
  for (const mode of ['unbuffered', 'prefix', 'cancelled']) {
    const media = new Media(); media.readyState = 1; let ready = 0;
    const cancel = restoreBeforePlayback(media, 35.39, { ready: () => ready++, failed: () => assert.fail() });
    media.position = mode === 'prefix' ? 0 : 35.39;
    media.seeking = false; media.readyState = 4;
    media.buffered = { length: 1, start: () => 0, end: () => mode === 'unbuffered' ? 10 : 40 };
    if (mode === 'cancelled') cancel();
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(ready, 0, mode);
    cancel();
  }
});


test('incidental pipeline rebuild resumes 107:42 instead of its 95-minute resolve seed', () => {
  const previous = { delivery: 'same-session-origin-reload', requested: 5701, position: 6462.4 };
  assert.equal(pipelineRestoreTarget(previous.delivery, 5701, previous, 5701), 6462.4);
  assert.equal(pipelineRestoreTarget(previous.delivery, 6400, previous, 5701), 6400, 'explicit backwards seek wins');
  assert.equal(pipelineRestoreTarget('new-reload-intent', 5701, previous, 5701), 5701, 'same URL resolved again has a new intent');
  assert.equal(pipelineRestoreTarget('different-episode', 0, previous, 5701), 0);
});


test('a buffered paused decoder can be primed once without completing the restore early', async () => {
  const media = new Media(); media.readyState = 1;
  let primed = 0, ready = 0;
  const cancel = restoreBeforePlayback(media, 28.664, {
    prime: () => primed++, ready: () => ready++, failed: () => assert.fail(),
  });
  media.position = 28.664;
  // A buffer hole at the destination must not trigger playback.
  media.buffered = { length: 1, start: () => 40, end: () => 124 };
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal(primed, 0);
  media.buffered = { length: 1, start: () => 20, end: () => 124 };
  media.event('progress'); media.event('progress');
  assert.equal(primed, 1);
  assert.equal(ready, 0, 'metadata and play intent are not a decoded destination');
  media.seeking = false; media.readyState = 2; media.event('seeked');
  assert.equal(ready, 1);
  cancel();
});

test('native HLS primes a covered metadata-only seek with no buffer, but does not settle from play()', async () => {
  const media = new Media(); media.readyState = 1;
  media.buffered = { length: 0 };
  let covered = false, primed = 0, ready = 0;
  const cancel = restoreBeforePlayback(media, 2.349, {
    covered: () => covered, primeWhenCovered: true, prime: () => primed++,
    ready: () => ready++, failed: () => assert.fail('unexpected timeout'),
  });
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(primed, 0, 'the new playlist must cover the destination first');
  covered = true; media.event('progress'); media.position = 2.349;
  await new Promise(resolve => setTimeout(resolve, 850));
  media.event('progress');
  assert.equal(primed, 1); assert.equal(ready, 0);
  assert.equal(media.seeking, true, 'play intent is not a completed seek');
  media.readyState = 2; media.seeking = false; media.event('seeked');
  assert.equal(ready, 1); cancel();
});

test('a native seek with no play intent never starts playback to fill its buffer', async () => {
  const media = new Media(); media.readyState = 1; media.buffered = { length: 0 };
  const cancel = restoreBeforePlayback(media, 2.349, {
    covered: () => true, primeWhenCovered: true, ready: () => assert.fail(), failed: () => assert.fail(),
  });
  media.position = 2.349;
  await new Promise(resolve => setTimeout(resolve, 850));
  assert.equal(media.paused, true); cancel();
});
