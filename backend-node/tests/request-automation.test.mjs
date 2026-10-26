import { requestIdentity } from '../services/requests/identity.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {createRequestWorker} from '../services/requests/worker.js';
import {findRequestMatch,readyProbe,initialAutomation,matchesRequestedEpisode} from '../services/requests/policy.js';
import {requestDb} from './helpers/requestDb.mjs';
const initial=()=>({_id:'req',title:'Test Film',status:'pending',userId:'u',requesters:[{id:'u'},{id:'v'}],createdAt:new Date(0),automation:initialAutomation()});
const base=()=>({detail:async()=>({tmdbId:123,mediaType:'movie'}),key:async()=> 'test-key',discover:async()=>[{infoHash:'a'.repeat(40),cached:true}],persist:x=>({...x}),prepare:async()=>({state:'ready'}),verify:async()=>true,publish:async()=>{}});
test('missing sources remain pending, wait six hours and never notify',async()=>{
 const db=requestDb([initial()]),adapter=base();adapter.discover=async()=>[];const w=createRequestWorker({db,adapter});await w.tick();
 const row=await db.collection('movie_requests').findOne({_id:'req'});assert.equal(row.status,'pending');assert.equal(row.automation.state,'waiting_source');assert.ok(+row.automation.nextAttemptAt>Date.now()+5*3600000);assert.equal(db.tables.get('notifications')?.length||0,0);
});
test('uncached download progress persists across worker restarts; only verified readiness completes',async()=>{
 const db=requestDb([initial()]);let t=Date.now(),ready=false,published=0;const adapter=base();adapter.discover=async()=>[{infoHash:'a'.repeat(40),cached:false,sizeBytes:1e9}];adapter.prepare=async()=>ready?{state:'ready'}:{state:'downloading',progress:35,torrentId:4};adapter.publish=async()=>published++;
 await createRequestWorker({db,adapter,now:()=>t}).tick();let row=await db.collection('movie_requests').findOne({_id:'req'});assert.equal(row.status,'pending');assert.equal(row.automation.progress,35);assert.equal(db.tables.get('movie_request_downloads').length,1);
 ready=true;t+=31000;await createRequestWorker({db,adapter,now:()=>t}).tick();row=await db.collection('movie_requests').findOne({_id:'req'});assert.equal(row.status,'completed');assert.equal(published,1);assert.equal(db.tables.get('notifications').length,2);
 await createRequestWorker({db,adapter,now:()=>t}).tick();assert.equal(db.tables.get('notifications').length,2);
});
test('failed video validation never publishes or sends an available notification',async()=>{
 const db=requestDb([initial()]),adapter=base();adapter.verify=async()=>false;let pub=0;adapter.publish=async()=>pub++;await createRequestWorker({db,adapter}).tick();assert.equal((await db.collection('movie_requests').findOne({_id:'req'})).status,'pending');assert.equal(pub,0);assert.equal(db.tables.get('notifications')?.length||0,0);
});
test('admin rejection during verification cannot be overwritten by a late worker',async()=>{
 const db=requestDb([initial()]),adapter=base();let pub=0;adapter.verify=async()=>{await db.collection('movie_requests').updateOne({_id:'req'},{$set:{status:'rejected'}});return true};adapter.publish=async()=>pub++;await createRequestWorker({db,adapter}).tick();assert.equal((await db.collection('movie_requests').findOne({_id:'req'})).status,'rejected');assert.equal(pub,0);
});
test('global lease allows only one claimant across concurrent workers',async()=>{
 const db=requestDb([initial()]),adapter=base();let searches=0;adapter.discover=async()=>{searches++;return[]};await Promise.all([createRequestWorker({db,adapter}).tick(),createRequestWorker({db,adapter}).tick()]);assert.equal(searches,1);
});
test('active download prevents another uncached file from being admitted',async()=>{
 const db=requestDb([initial()]),adapter=base();await db.collection('movie_request_jobs').updateOne({_id:'other'},{$set:{state:'downloading'}},{upsert:true});adapter.discover=async()=>[{infoHash:'b'.repeat(40),cached:false,sizeBytes:1e9}];let calls=0;adapter.prepare=async()=>{calls++;return{state:'ready'}};await createRequestWorker({db,adapter}).tick();assert.equal(calls,0);assert.equal((await db.collection('movie_requests').findOne({_id:'req'})).automation.state,'waiting_slot');
});
test('title matching requires a unique exact alias and video checks include audio and runtime',()=>{
 assert.equal(findRequestMatch('Film (2024)',[{title:'Film',year:2023,mediaType:'movie',tmdbId:1}]),null);
 assert.equal(findRequestMatch('Film',[{title:'Film',mediaType:'movie',tmdbId:1},{title:'Film',mediaType:'tv',tmdbId:2}]),null);
 assert.equal(findRequestMatch('Mien ky uc',[{title:'Miền ký ức',mediaType:'movie',tmdbId:3}]).tmdbId,3);
 const probe={format:'matroska,webm',duration:5400,video:{codec:'h264'},audio:[{codec:'aac'}]};assert.equal(readyProbe(probe,90),true);assert.equal(readyProbe(probe,150),false);assert.equal(readyProbe({...probe,audio:[]},90),false);assert.equal(readyProbe({...probe,video:null},90),false);
});
test('notification delivery retries after a transient failure without repeating publication',async()=>{
 const db=requestDb([initial()]),adapter=base();let sends=0,published=0;adapter.publish=async()=>published++;
 const notify=async()=>{if(++sends===1)throw new Error('temporary');};const w=createRequestWorker({db,adapter,notify});
 await w.tick();assert.equal((await db.collection('movie_requests').findOne({_id:'req'})).status,'completed');
 await w.tick();assert.equal(sends,2);assert.equal(published,1);assert.ok((await db.collection('movie_requests').findOne({_id:'req'})).automation.notifiedAt);
});
test('an oversized first result cannot hide an admissible second download',async()=>{
 const db=requestDb([initial()]),adapter=base();let selected;
 adapter.discover=async()=>[{infoHash:'big',cached:false,sizeBytes:99e9},{infoHash:'small',cached:false,sizeBytes:1e9}];
 adapter.prepare=async c=>{selected=c.infoHash;return{state:'downloading',progress:1,torrentId:5}};
 await createRequestWorker({db,adapter}).tick();assert.equal(selected,'small');
});
test('pausing during an in-flight probe prevents publication and completion',async()=>{
 const db=requestDb([initial()]),adapter=base();let pub=0;
 adapter.verify=async()=>{await db.collection('movie_requests').updateOne({_id:'req'},{$set:{'automation.enabled':false,'automation.state':'paused'},$unset:{'automation.lease':''}});return true};
 adapter.publish=async()=>pub++;await createRequestWorker({db,adapter}).tick();const row=await db.collection('movie_requests').findOne({_id:'req'});assert.equal(row.status,'pending');assert.equal(row.automation.state,'paused');assert.equal(pub,0);
});
test('three recent uncached submissions exhaust the daily budget without another provider call',async()=>{
 const db=requestDb([initial()]),adapter=base();for(let i=0;i<3;i++)await db.collection('movie_request_downloads').updateOne({_id:'d'+i},{$set:{createdAt:new Date()}},{upsert:true});
 adapter.discover=async()=>[{infoHash:'uncached',cached:false,sizeBytes:1e9}];let prepare=0;adapter.prepare=async()=>{prepare++;return{state:'ready'}};await createRequestWorker({db,adapter}).tick();assert.equal(prepare,0);assert.equal((await db.collection('movie_requests').findOne({_id:'req'})).automation.state,'waiting_slot');
});
test('episode verification rejects a different season, episode, or an ambiguous filename',()=>{
 assert.equal(matchesRequestedEpisode('Series.S01E04.1080p.mkv',1,4),true);
 assert.equal(matchesRequestedEpisode('Series.1x04.mkv',1,4),true);
 assert.equal(matchesRequestedEpisode('Series.S01E04.mkv',1,1),false);
 assert.equal(matchesRequestedEpisode('Series.S02E04.mkv',1,4),false);
 assert.equal(matchesRequestedEpisode('Series.S01E040.mkv',1,4),false);
 assert.equal(matchesRequestedEpisode('Series.mkv',1,4),false);
});
test('retargeting an episode cannot reuse the previous episode download',async()=>{
 const row={...initial(),season:1,episode:4},db=requestDb([row]),adapter=base();let picked;
 adapter.detail=async()=>({tmdbId:123,mediaType:'tv'});
 await db.collection('movie_request_jobs').updateOne({_id:'req'},{$set:{state:'downloading',tmdbId:123,mediaType:'tv',season:1,episode:1,source:{infoHash:'old',cached:true}}},{upsert:true});
 adapter.discover=async()=>[{infoHash:'new',cached:true}];adapter.prepare=async c=>{picked=c.infoHash;return{state:'ready'}};
 await createRequestWorker({db,adapter}).tick();assert.equal(picked,'new');
});

test('request links identify the exact movie without requiring an admin search', () => {
 assert.deepEqual(requestIdentity({note:'https://cinevn.me/phim/movie/791523/wildwood'}),{tmdbId:791523,mediaType:'movie'});
 assert.deepEqual(requestIdentity({note:'Xem https://cinevn.me/xem-phim/tv/220542/duoc-su?s=1&e=4'}),{tmdbId:220542,mediaType:'tv'});
 assert.deepEqual(requestIdentity({note:'https://www.themoviedb.org/movie/791523-wildwood'}),{tmdbId:791523,mediaType:'movie'});
 assert.deepEqual(requestIdentity({tmdbId:123,mediaType:'tv',note:'https://cinevn.me/phim/movie/791523/wildwood'}),{tmdbId:123,mediaType:'tv'});
 assert.deepEqual(requestIdentity({note:'https://cinevn.me/phim/movie/1/a https://cinevn.me/phim/movie/2/b'}),{ambiguous:true});
 for (const note of ['https://cinevn.me.evil.test/phim/movie/791523/wildwood','https://cinevn.me@evil.test/phim/movie/791523/wildwood','https://evil.test/movie/1','https://cinevn.me/phim/movie/0/a','Wildwood']) assert.equal(requestIdentity({note}),null);
});
