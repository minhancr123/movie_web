import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ctx = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/native-subtitles.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, ctx);
const { suppressNativeSubtitles } = ctx.exports;
class TrackList extends EventTarget {
  length = 0;
  add(track) { this[this.length++] = track; this.dispatchEvent(new Event('addtrack')); }
}
const fixture = () => {
  const video = new EventTarget(); video.textTracks = new TrackList(); return video;
};
test('embedded MP4 subtitles are disabled while chapter and metadata tracks remain intact', () => {
  const video = fixture();
  for (const track of [
    { kind: 'subtitles', mode: 'showing' }, { kind: 'captions', mode: 'showing' },
    { kind: 'chapters', mode: 'hidden' }, { kind: 'metadata', mode: 'hidden' },
  ]) video.textTracks.add(track);
  const cleanup = suppressNativeSubtitles(video);
  assert.deepEqual(Array.from({ length: 4 }, (_, i) => video.textTracks[i].mode), ['disabled', 'disabled', 'hidden', 'hidden']);
  cleanup();
});
test('late tracks and browser auto-selection after metadata cannot create another caption overlay', () => {
  const video = fixture(); const cleanup = suppressNativeSubtitles(video);
  const english = { kind: 'subtitles', mode: 'showing' }; video.textTracks.add(english);
  assert.equal(english.mode, 'disabled');
  for (const event of ['change', 'loadedmetadata', 'loadeddata', 'play']) {
    english.mode = 'showing';
    (event === 'change' ? video.textTracks : video).dispatchEvent(new Event(event));
    assert.equal(english.mode, 'disabled');
  }
  cleanup();
  english.mode = 'showing'; video.textTracks.dispatchEvent(new Event('change'));
  assert.equal(english.mode, 'showing', 'listeners are detached from a retired video element');
});
