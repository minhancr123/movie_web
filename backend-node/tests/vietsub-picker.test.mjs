import crypto from 'node:crypto';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/movieweb';
process.env.TOKEN_ENCRYPTION_KEYS = `1:${crypto.randomBytes(32).toString('base64')}`;
process.env.REDIS_URL = 'redis://127.0.0.1:6399';
process.env.STREMIO_ADDONS = '';

import assert from 'node:assert/strict';
const playback = await import('../controllers/playbackController.js');

console.log('Testing Vietsub tokens & picker flows...');

// Test 1: parseResolveBody parses yastreamToken and vimoToken correctly
const parsed1 = playback.parseResolveBody({
  type: 'movie',
  tmdbId: 12345,
  sourceToken: 'yastream:0:sub_720p',
});
assert.equal(parsed1.yastreamToken, 'yastream:0:sub_720p', 'sourceToken yastream extracted');
assert.equal(parsed1.sourceToken, null, 'torrent sourceToken is null');

const parsed2 = playback.parseResolveBody({
  type: 'movie',
  tmdbId: 12345,
  vimoToken: 'vimo|movie|67890',
});
assert.equal(parsed2.vimoToken, 'vimo|movie|67890', 'vimoToken extracted directly');

const parsed3 = playback.parseResolveBody({
  type: 'movie',
  tmdbId: 12345,
  sourceToken: 'vimo|movie|67890',
});
assert.equal(parsed3.vimoToken, 'vimo|movie|67890', 'sourceToken vimo extracted');

const parsed4 = playback.parseResolveBody({
  type: 'tv',
  tmdbId: 999,
  season: 2,
  episode: 3,
  sourceToken: 'vimo|series|slug123:2:3',
});
assert.equal(parsed4.vimoToken, 'vimo|series|slug123:2:3', 'series vimoToken extracted with season/episode');

console.log('ok - parseResolveBody handles yastream and vimo tokens for movie and tv');
const { candidateIdentity, matchCandidateToken } = await import('../services/addonClient.js');
for (const candidate of [
  {infoHash:'a'.repeat(40),fileIdx:1,filename:'movie.mkv'},
  {infoHash:'a'.repeat(40),filename:'Avengers Endgame (2019) IMAX.mkv'},
  {infoHash:'a'.repeat(40),filename:'Tập làm người xấu - S2E8.mkv'},
]) {
  const token=candidateIdentity(candidate);
  const parsed=playback.parseResolveBody({type:'movie',tmdbId:299534,sourceToken:token});
  assert.equal(parsed.sourceToken,token,'a token returned by the picker must survive resolve, not become an automatic pick');
  assert.equal(matchCandidateToken(candidate,parsed.sourceToken),true);
}
for (const suffix of ['bad|provider', 'bad\nname', 'x'.repeat(1025)]) {
  assert.equal(playback.SOURCE_TOKEN_PATTERN.test('a'.repeat(40)+':unknown:'+suffix),false);
}
console.log('ok - source picker identities round-trip including spaced and Unicode filenames');
console.log('All vietsub-picker tests passed!');
process.exit(0);