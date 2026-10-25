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
const { restoreBeforePlayback, restorePlayIntent, nativeSeekCovered } = await import(pathToFileURL(path.join(out, 'playback-restore.js')));
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
