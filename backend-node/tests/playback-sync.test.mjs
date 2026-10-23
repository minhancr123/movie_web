import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSyncSnapshot, playbackSyncSnapshot } from '../services/playback/syncDiagnostics.js';

const event = { requestedStartAt: 197, playerCurrentTime: 4.583,
  absolutePlaybackTime: 199.083, subtitleLookupTime: 199, subtitleCueStart: 199,
  subtitleDelaySeconds: 0, presentationShiftMs: 83, selectedAudioIndex: 0, subtitleStreamIndex: 4 };
const session = { sessionId: 'owned-session', mode: 'remux', startAt: 194.5, presentationShiftMs: 83, audioIndex: 0 };
test('seek at 197 uses measured origin, not the requested time', () => {
  const snapshot = playbackSyncSnapshot(session, event);
  assert.equal(snapshot.actualSeekOrigin, 194.5);
  assert.equal(snapshot.absoluteMappingErrorSeconds, 0);
  assert.equal(snapshot.lookupMappingErrorSeconds, 0);
});
test('session reuse retains its original clock and reveals a client using stale metadata', () => {
  assert.equal(playbackSyncSnapshot({ ...session }, { ...event }).lookupMappingErrorSeconds, 0);
  const wrong = playbackSyncSnapshot(session, { ...event, absolutePlaybackTime: 201.583, subtitleLookupTime: 201.5 });
  assert.equal(wrong.absoluteMappingErrorSeconds, 2.5);
  assert.equal(wrong.lookupMappingErrorSeconds, 2.5);
});
test('start zero and direct playback have distinct timestamp bases', () => {
  const zero = { ...event, requestedStartAt: 0, playerCurrentTime: 2.083, absolutePlaybackTime: 2.083,
    subtitleLookupTime: 2, subtitleCueStart: 2 };
  assert.equal(playbackSyncSnapshot({ ...session, startAt: 0 }, zero).lookupMappingErrorSeconds, 0);
  const direct = { ...zero, presentationShiftMs: 0, playerCurrentTime: 2, absolutePlaybackTime: 2 };
  assert.equal(playbackSyncSnapshot({ ...session, mode: 'direct', startAt: 194.5, presentationShiftMs: 0 }, direct).lookupMappingErrorSeconds, 0);
});
test('diagnostics accept only bounded numbers and exclude credentials and cue text', () => {
  const input = { ...event, url: 'signed-private', token: 'private-key', subtitleText: 'private-line' };
  const parsed = parseSyncSnapshot(input);
  assert.deepEqual(parsed, event);
  assert.doesNotMatch(JSON.stringify(playbackSyncSnapshot(session, parsed)), /signed-private|private-key|private-line/);
  for (const patch of [{ playerCurrentTime: Infinity }, { subtitleDelaySeconds: -301 }, { selectedAudioIndex: 0.5 }, { subtitleStreamIndex: '4' }]) {
    assert.equal(parseSyncSnapshot({ ...event, ...patch }), null);
  }
});
