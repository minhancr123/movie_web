import test from 'node:test';import assert from 'node:assert/strict';
import {directPlayVerdict,isRecommendedDirectSource} from '../services/playback/directPlayVerdict.js';
import {rankCandidates} from '../services/playback/sourceRanker.js';
import {selectFallbackAttempts} from '../services/playback/sourcePicker.js';
process.env.REDIS_CACHE_URL='redis://127.0.0.1:1';
const { mergeStreamCandidates, collectDiscovery, candidateIdentity, matchCandidateToken } = await import('../services/addonClient.js');
const { parseCandidate, scoreCandidate } = await import('../services/playback/sourceRanker.js');
const {cacheClient}=await import('../config/redis.js');
const base={playable:true,container:'mp4',codec:'hevc',audio:{browserFriendly:true},cached:true};
test('direct hints respect HEVC/Main10/AV1/WebM client capabilities',()=>{
 assert.equal(directPlayVerdict(base,{hevc:true}),'likely');
 assert.equal(directPlayVerdict(base,{hevc:false}),'remux');
 assert.equal(directPlayVerdict({...base,filename:'Film.10bit.mp4'},{hevc:true,hevcMain10:false}),'remux');
 assert.equal(directPlayVerdict({...base,codec:'av1'},{av1:true}),'likely');
 assert.equal(directPlayVerdict({...base,codec:'vp9',container:'webm'},{webm:true}),'likely');
 assert.equal(directPlayVerdict({...base,audio:{browserFriendly:false}},{hevc:true}),'remux');
});
test('WebM VP9 Opus filenames are recognized only on a WebM-capable browser',()=>{
 const file={infoHash:'webm',filename:'Film.1080p.VP9.Opus.webm',cached:true};
 assert.equal(rankCandidates([file],{webm:true,maxHeight:1080}).best.directPlay,'likely');
 assert.notEqual(rankCandidates([file],{webm:false,maxHeight:1080}).best?.directPlay,'likely');
});
test('verified requires probed container/audio, supported range and selected language track',()=>{
 const s={...base,probedCodec:'h264',probedFormat:'mov,mp4',audioTracks:[{codec:'aac',profile:'LC',channels:2,language:'rus',streamIndex:1},{codec:'aac',profile:'LC',channels:2,language:'eng',streamIndex:2}],rangeSupported:true};
 assert.equal(directPlayVerdict(s,{}, {contentLanguage:'en'}),'remux');
 assert.equal(directPlayVerdict({...s,audioTracks:s.audioTracks.slice(1)},{}),'verified');
 assert.equal(directPlayVerdict({...s,audioTracks:s.audioTracks.slice(1),rangeSupported:false},{}),'remux');
 assert.equal(directPlayVerdict({...s,audioTracks:s.audioTracks.slice(1),rangeSupported:undefined},{}),'likely');
});
test('same-quality native HEVC direct wins on Safari, without trading away 4K quality',()=>{
 const mkv={infoHash:'a',filename:'Film.1080p.H264.AAC.mkv',cached:true};
 const mp4={infoHash:'b',filename:'Film.1080p.H265.AAC.mp4',cached:true};
 const opts={runtimeMinutes:100};
 assert.equal(rankCandidates([mkv,mp4],{hevc:true,maxHeight:2160},opts).best.infoHash,'b');
 assert.equal(rankCandidates([mkv,mp4],{hevc:false},opts).best.infoHash,'a');
 assert.equal(rankCandidates([{...mkv,infoHash:'4k',filename:'Film.2160p.H265.AAC.mkv'},mp4],{hevc:true,maxHeight:2160},opts).best.infoHash,'4k');
});
test('a tiny direct encode does not outrank an adequate same-quality source',()=>{
 const good={infoHash:'good',filename:'Film.1080p.H264.AAC.mkv',cached:true,sizeBytes:3e9};
 const tiny={infoHash:'tiny',filename:'Film.1080p.H264.AAC.mp4',cached:true,sizeBytes:100e6};
 const r=rankCandidates([tiny,good],{maxHeight:1080},{runtimeMinutes:100});
 assert.equal(r.best.infoHash,'good');assert.equal(r.playable[1].qualityRisk,'low_bitrate');
});
test('fallback budget reserves a different codec and lighter cached file, excluding failed bytes',()=>{
 const sources=Array.from({length:7},(_,i)=>({infoHash:`h${i}`,codec:'hevc',resolution:2160,cached:true}));
 sources.push({infoHash:'avc',codec:'h264',resolution:2160,cached:true},{infoHash:'lighter',codec:'h264',resolution:1080,cached:true});
 const selected=selectFallbackAttempts(sources,5,['h0']);
 assert.equal(selected.length,5);assert.equal(selected[0].infoHash,'h1');
 assert(selected.some(s=>s.infoHash==='avc'));assert(selected.some(s=>s.infoHash==='lighter'));assert(!selected.some(s=>s.infoHash==='h0'));
 assert.deepEqual(selectFallbackAttempts(sources,0),[]);
});
test('dedup enriches the same file but preserves separate pack indices', () => {
 const out = mergeStreamCandidates([
   { candidates: [{ infoHash: 'h', fileIdx: 1, label: 'short', filename: 'episode1' }] },
   { candidates: [
     { infoHash: 'h', fileIdx: 2, label: 'much longer but wrong episode', sizeBytes: 999 },
     { infoHash: 'h', fileIdx: 1, label: 'longer', sizeBytes: 10 }
   ] }
 ]);
 assert.equal(out.candidates.length, 2);
 const ep1 = out.candidates.find(c => c.fileIdx === 1);
 const ep2 = out.candidates.find(c => c.fileIdx === 2);
 assert(ep1 && ep2);
 assert.equal(ep1.filename, 'episode1');
 assert.equal(ep1.sizeBytes, 10);
 assert.equal(ep1.label, 'longer');
 assert.equal(ep2.label, 'much longer but wrong episode');
});

test('candidate identity and token matching preserve versioned file index', () => {
 const c1 = { infoHash: 'a'.repeat(40), fileIdx: 2, filename: 's01e02.mkv' };
 const id = candidateIdentity(c1);
 assert.equal(id, `${'a'.repeat(40)}:index:2`);
 assert.equal(matchCandidateToken(c1, 'a'.repeat(40)), true);
 assert.equal(matchCandidateToken(c1, id), true);
 assert.equal(matchCandidateToken(c1, `${'a'.repeat(40)}:2`), true);
 assert.equal(matchCandidateToken(c1, `${'a'.repeat(40)}:index:1`), false);
});

test('probed audio facts outrank missing filename codec in ranking', () => {
 const unprobed = parseCandidate({
   filename: 'Interstellar.2014.1080p.BluRay.x264.YIFY.mp4',
   container: 'mp4',
   codec: 'h264',
 });
 assert.equal(unprobed.audio?.browserFriendly, false);

 const probedAac = parseCandidate({
   filename: 'Interstellar.2014.1080p.BluRay.x264.YIFY.mp4',
   container: 'mp4',
   codec: 'h264',
   audioTracks: [{ codec: 'aac', profile: 'LC', channels: 2 }],
 });
 assert.equal(probedAac.audio?.browserFriendly, true);

 const probedDts = parseCandidate({
   filename: 'Interstellar.2014.1080p.BluRay.x264.YIFY.mp4',
   container: 'mp4',
   codec: 'h264',
   audioTracks: [{ codec: 'dts', channels: 6 }],
 });
 assert.equal(probedDts.audio?.browserFriendly, false);
});
test('hybrid discovery merges fast feeds but returns before a slow addon finishes',async()=>{
 const good=id=>({candidates:[{infoHash:id}],errors:[]});
 const merged=await collectDiscovery([async()=>good('one'),async()=>good('two')],5);assert.equal(merged.candidates.length,2);
 let release;const pending=new Promise(resolve=>{release=resolve;});let finished=false;
 const result=await collectDiscovery([async()=>good('one'),async()=>{await pending;finished=true;return good('two');}],5);
 assert.equal(finished,false);assert.equal(result.candidates.length,1);release();
 await new Promise(r=>setTimeout(r,0));assert.equal(finished,true);
});
test('a pinned source waits for the feed that contains it instead of reporting a false 404',async()=>{
 let release;const pending=new Promise(resolve=>{release=resolve;});let done=false;
 const job=collectDiscovery([async()=>({candidates:[{infoHash:'other'}]}),async()=>{await pending;return{candidates:[{infoHash:'pinned'}]};}],1,'pinned').then(r=>{done=true;return r;});
 await new Promise(r=>setTimeout(r,10));assert.equal(done,false);release();
 assert((await job).candidates.some(s=>s.infoHash==='pinned'));
});
test.after(()=>cacheClient.disconnect());

test('recommendation requires ready compatible direct sources without picture/network quality risks', () => {
 for (const directPlay of ['verified', 'likely']) {
  assert.equal(isRecommendedDirectSource({ directPlay, cached: true }), true);
  for (const patch of [{ cached: false }, { qualityRisk: 'low_bitrate' }, { qualityRisk: 'network' }, { playable: false }]) {
   assert.equal(isRecommendedDirectSource({ directPlay, cached: true, ...patch }), false);
  }
 }
 for (const directPlay of ['remux', 'unknown', 'unavailable']) assert.equal(isRecommendedDirectSource({ directPlay, cached: true }), false);
});
