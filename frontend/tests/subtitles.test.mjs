/** Pending embedded tracks remain selectable in the menu, but auto-selection
 * waits for their published URL and upgrades them after extraction completes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const outDir = mkdtempSync(path.join(tmpdir(), 'subs-test-'));

execFileSync(
  'node',
  [
    path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    'src/lib/subtitles.ts',
    '--outDir', outDir, '--module', 'commonjs', '--target', 'es2020',
    '--moduleResolution', 'node', '--skipLibCheck', '--esModuleInterop',
  ],
  { cwd: root, stdio: 'pipe' },
);

const { isReadyTrack, isEmbeddedTrack, isViTrack, pickBestViTrack, pickAutoSubtitle, autoSubtitleRank, subtitleWindowNeedsRefresh, pickEmbeddedReference, pickValidatedViTrack } = await import(
  pathToFileURL(path.join(outDir, 'subtitles.js')).href,
);
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));
test('automatic selection prefers Vietnamese and ranks timing within each language', () => {
  const generic = { id: 'en-generic', language: 'en', label: 'English 1', url: '/generic.vtt' };
  const varyg = { id: 'en-varyg', language: 'en', label: 'VARYG', url: '/varyg.vtt', matched: true };
  const vi = { id: 'vi', language: 'vi', label: 'Vietnamese', url: '/vi.vtt' };
  assert.equal(pickAutoSubtitle([generic, varyg])?.id, varyg.id);
  assert.equal(pickAutoSubtitle([vi, varyg])?.id, vi.id);
  assert.equal(pickAutoSubtitle([varyg, { ...vi, matched: true }])?.id, vi.id);
  assert.equal(pickAutoSubtitle([generic, vi])?.id, vi.id);
  assert.equal(pickAutoSubtitle([{ ...varyg, ready: false }]), undefined);
  assert.equal(pickAutoSubtitle([{ ...varyg, language: 'ro' }]), undefined);
  assert.ok(autoSubtitleRank(varyg) > autoSubtitleRank(generic));
});
test('pickBestViTrack prefers matched over first-seen Vietnamese', () => {
  const generic = { id: 'vi-1', language: 'vi', label: 'Tiếng Việt 1', url: 'http://example/a.vtt', ready: true };
  const matched = { id: 'vi-2', language: 'vi', label: 'Tiếng Việt 2', url: 'http://example/b.vtt', ready: true, matched: true };
  assert.equal(pickBestViTrack([generic, matched])?.id, 'vi-2', 'matched sidecar wins even when listed second');
  assert.equal(pickBestViTrack([generic])?.id, 'vi-1', 'falls back to first Vietnamese when nothing matched');
  const embedded = { id: 'a'.repeat(40) + ':3', language: 'vi', label: 'Embedded', url: '', ready: false, source: 'embedded' };
  assert.equal(pickBestViTrack([generic, matched, embedded])?.id, matched.id, 'pending embedded must not hide ready dialogue');
});
test('pickBestViTrack ranks a suggested track above popularity, below proof', () => {
  const generic = { id: 'vi-1', language: 'vi', label: 'Tiếng Việt 1', url: 'http://example/a.vtt', ready: true };
  const suggested = { id: 'vi-9', language: 'vi', label: 'Tiếng Việt 9', url: 'http://example/c.vtt', ready: true, suggested: true };
  const matched = { id: 'vi-2', language: 'vi', label: 'Tiếng Việt 2', url: 'http://example/b.vtt', ready: true, matched: true };
  const embedded = { id: 'a'.repeat(40) + ':3', language: 'vi', label: 'Embedded', url: '', ready: false, source: 'embedded' };
  assert.equal(pickBestViTrack([generic, suggested])?.id, 'vi-9', 'suggested beats the popularity pick');
  assert.equal(pickBestViTrack([suggested, matched])?.id, 'vi-2', 'proof still beats suggestion');
  assert.equal(pickBestViTrack([suggested, embedded])?.id, suggested.id, 'pending extraction must not hide ready dialogue');
});

// Availability in the inventory is not readiness to display.
assert.equal(isReadyTrack({ id: 'a'.repeat(40) + ':3', language: 'vi', label: 'Tiếng Việt', ready: false, url: '' }), false, 'embedded track with no URL is not display-ready');
// Embedded with URL is obviously ready.
assert.equal(isReadyTrack({ id: 'a'.repeat(40) + ':3', language: 'vi', label: 'Tiếng Việt', ready: true, url: 'http://example/sub.vtt', source: 'embedded' }), true, 'embedded track with URL is ready');
// Online track still needs a URL.
assert.equal(isReadyTrack({ id: 'Tiếng Việt 1', language: 'vi', label: 'Tiếng Việt 1', ready: true, url: 'http://example/cam.vtt' }), true, 'online track with URL is ready');
assert.equal(isReadyTrack({ id: 'Tiếng Việt 1', language: 'vi', label: 'Tiếng Việt 1', ready: true, url: '' }), false, 'online track without URL is not ready');
// isEmbeddedTrack identity check is unchanged.
assert.equal(isEmbeddedTrack({ id: 'a'.repeat(40) + ':3', source: undefined }), true);
assert.equal(isEmbeddedTrack({ id: 'Tiếng Việt 1' }), false);
// Not Vietnamese regardless.
assert.equal(isViTrack({ language: 'en' }), false);

console.log('ok - isReadyTrack allows embedded tracks before their URL lands');
console.log('ok - bestViTrack will now find embedded Vietnamese first');

test('embedded slices refresh with overlap after forward/backward seeks; external tracks do not', () => {
  const track = { id: 'file:0', source: 'embedded', windowStart: 600, windowSeconds: 300 };
  assert.equal(subtitleWindowNeedsRefresh(track, 648), false);
  assert.equal(subtitleWindowNeedsRefresh(track, 720), true);
  assert.equal(subtitleWindowNeedsRefresh(track, 599), true);
  assert.equal(subtitleWindowNeedsRefresh({ ...track, source: 'external' }, 1000), false);
});


test('a full French reference beats an English signs-only stream', () => {
  const signs = { id: 'en-signs', language: 'eng', source: 'embedded', url: '/signs' };
  const dialogue = { id: 'fr-dialogue', language: 'fre', source: 'embedded', url: '/dialogue' };
  assert.equal(pickEmbeddedReference([signs, dialogue], { 'en-signs': Array(3).fill({}), 'fr-dialogue': Array(68).fill({}) })?.id, dialogue.id);
  assert.equal(pickEmbeddedReference([signs], { 'en-signs': Array(3).fill({}) }), undefined);
});
test('measured Vietnamese dialogue replaces empty online candidates and stays selected', () => {
  const empty = { id: 'vi-empty', language: 'vie', url: '/ssa' };
  const good = { id: 'vi-good', language: 'vie', url: '/srt' };
  const cues = { 'vi-empty': [], 'vi-good': [{ start: 157, end: 160, text: 'Dialogue' }] };
  const scores = { 'vi-good': { confident: true, matchRate: 0.82, offset: 0.156 } };
  assert.equal(pickValidatedViTrack([empty, good], cues, scores, empty.id)?.id, good.id);
  assert.equal(pickValidatedViTrack([empty, good], cues, scores, good.id)?.id, good.id);
  assert.equal(pickValidatedViTrack([empty, good], cues, {}, empty.id)?.id, good.id);
  assert.equal(pickValidatedViTrack([empty, good], { 'vi-good': cues['vi-good'] }, {}, empty.id), undefined, 'failed or pending response is not a confirmed empty track');
});
test('weak timing evidence does not displace readable Vietnamese or an exact match', () => {
  const current = { id: 'current', language: 'vi', url: '/current' };
  const other = { id: 'other', language: 'vi', url: '/other' };
  const cues = { current: [{ start: 1, end: 2, text: 'a' }], other: [{ start: 1, end: 2, text: 'b' }] };
  const scores = { other: { confident: false, matchRate: 0.6, offset: 5 } };
  assert.equal(pickValidatedViTrack([current, other], cues, scores, current.id), undefined);
  assert.equal(pickValidatedViTrack([{ ...current, matched: true }, other], cues,
    { other: { confident: true, matchRate: 0.9, offset: 0 } }, current.id)?.id, current.id);
});

test('ready sidecars display while embedded extraction runs, then upgrade on publication',()=>{
 const sidecar={id:'vi-online',language:'vie',label:'Việt',url:'https://example/sub.vtt',ready:true};
 const embedded={id:'a'.repeat(40)+':1',language:'vie',label:'Việt nhúng',url:'',ready:false,source:'embedded'};
 assert.equal(pickAutoSubtitle([sidecar,embedded]).id,sidecar.id);
 assert.equal(pickAutoSubtitle([sidecar,{...embedded,ready:true,url:'/api/sub.vtt'}]).id,embedded.id);
});
