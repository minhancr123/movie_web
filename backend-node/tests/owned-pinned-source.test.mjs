import assert from 'node:assert/strict';
import { ownedPinnedCandidate } from '../services/playback/ownedPinnedSource.js';
const hash='a'.repeat(40), now=100000;
const context={userId:'owner',contentRef:'movie:42246',mediaType:'movie',tmdbId:42246,sourceToken:hash+':index:3'};
const row={...context,userIdStr:'owner',provider:'torbox',mode:'remux',expiresAt:new Date(now+60000),sourceIdentity:context.sourceToken,infoHash:hash,sourceFileName:'Tom.and.Jerry.2005.mkv',videoHeight:1080,videoCodec:'h264',candidate:{url:'SECRET',magnet:'SECRET',audioTracks:[]}};
const candidate=ownedPinnedCandidate(row,context,now);
assert.equal(candidate.fileIdx,3);assert.equal(candidate.filename,row.sourceFileName);assert.equal(candidate.resolution,1080);
assert.equal(candidate.infoHash,hash);assert.ok(!('url' in candidate)&&!('magnet' in candidate));
for(const changed of [{userIdStr:'other'},{contentRef:'movie:299534'},{tmdbId:299534},{provider:'other'},{mode:'failed'},{expiresAt:new Date(now-1)},{sourceIdentity:hash+':index:4'},{infoHash:'b'.repeat(40)}]) {
 assert.equal(ownedPinnedCandidate({...row,...changed},context,now),null);
}
assert.equal(ownedPinnedCandidate(row,{...context,sourceToken:hash},now),null,'ambiguous legacy hash remains discovery-only');
const unknown=hash+':unknown:tom.and.jerry.2005.mkv';
assert.equal(ownedPinnedCandidate({...row,sourceIdentity:unknown},{...context,sourceToken:unknown},now).filename,'tom.and.jerry.2005.mkv');
const tv={...context,mediaType:'tv',contentRef:'tv:213331',tmdbId:213331,season:1,episode:10};
const tvRow={...row,...tv,sourceIdentity:context.sourceToken};
assert.ok(ownedPinnedCandidate(tvRow,tv,now));
assert.equal(ownedPinnedCandidate(tvRow,{...tv,episode:11},now),null,'never adopt another episode from a pack');
console.log('ok - trusted pins survive addon omission without bypassing ownership/file/episode/expiry boundaries');
