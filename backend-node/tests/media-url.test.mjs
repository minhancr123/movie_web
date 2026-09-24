import test from 'node:test';
import assert from 'node:assert/strict';
import {publicMediaUrl} from '../services/media/publicUrl.js';

test('configured origin prefixes the path', () => {
  assert.equal(
    publicMediaUrl('/api/playback/hls/token/master.m3u8', {origin:'https://media.cineon.me'}),
    'https://media.cineon.me/api/playback/hls/token/master.m3u8'
  );
});

test('auth-carrying path is never rewritten', () => {
  // Paths with tokens must stay on the API origin to preserve auth headers
  assert.equal(
    publicMediaUrl('/api/playback/hls/token/master.m3u8', {origin:'https://media.cineon.me', preserveAuth:true}),
    '/api/playback/hls/token/master.m3u8'
  );
});

test('no origin returns path unchanged', () => {
  assert.equal(
    publicMediaUrl('/api/playback/hls/token/master.m3u8', {}),
    '/api/playback/hls/token/master.m3u8'
  );
});

test('query string is preserved', () => {
  assert.equal(
    publicMediaUrl('/api/playback/hls/token/master.m3u8', {origin:'https://media.cineon.me', query:'v=1'}),
    'https://media.cineon.me/api/playback/hls/token/master.m3u8?v=1'
  );
});

test('double slashes are collapsed', () => {
  assert.equal(
    publicMediaUrl('//api/playback/hls/token/master.m3u8', {origin:'https://media.cineon.me'}),
    'https://media.cineon.me/api/playback/hls/token/master.m3u8'
  );
});
