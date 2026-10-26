import test from 'node:test';import assert from 'node:assert/strict';
import {matchesVietnameseCatalogue,catalogueStreams,lookupVietnameseCatalogues,validateCatalogueVideoUrl} from '../services/playback/vietnameseCatalogues.js';
const detail={title:'Bo Gia',originalTitle:'Dad, I am sorry',year:2021,tmdbId:123};
const movie={name:'Bố Già',origin_name:'Dad, I am sorry',year:2021,slug:'bo-gia',type:'single'};
const groups=[{server_name:'Vietsub',server_data:[{name:'Full',slug:'full',link_m3u8:'https://cdn.example/video.m3u8'}]}];
test('Vietnamese alias matching rejects remakes, conflicting IDs, unrelated or missing-year detail',()=>{
 assert.ok(matchesVietnameseCatalogue(movie,detail));assert.equal(matchesVietnameseCatalogue({...movie,year:2011},detail),false);
 assert.equal(matchesVietnameseCatalogue({...movie,tmdb:{id:999}},detail),false);
 assert.equal(matchesVietnameseCatalogue({...movie,name:'Other',origin_name:''},detail),false);
 assert.equal(matchesVietnameseCatalogue({...movie,year:undefined},detail),false);
});
test('movie/episode selection never silently picks a different episode or unknown later season',()=>{
 assert.equal(catalogueStreams(movie,groups,{type:'movie'},'kk').length,1);
 const eps=[{items:[{name:'01',m3u8:'https://cdn.example/1.m3u8'},{name:'02',m3u8:'https://cdn.example/2.m3u8'}]}];
 assert.equal(catalogueStreams(movie,eps,{type:'movie'},'kk').length,0);
 assert.equal(catalogueStreams(movie,eps,{type:'tv',season:1,episode:2},'kk')[0].url,'https://cdn.example/2.m3u8');
 assert.equal(catalogueStreams(movie,eps,{type:'tv',season:2,episode:2},'kk').length,0);
});
test('catalogue adapter supports both schemas and checks detailed metadata before accepting HLS',async()=>{
 const args={type:'movie',tmdbId:123,detail};const seen=[];
 const fetchJson=async url=>{seen.push(url);if(url.includes('keyword='))return {data:{items:[movie]},items:[movie]};return url.includes('phimapi')?{movie,episodes:groups}:{movie:{...movie,episodes:[{items:[{name:'Full',m3u8:'https://cdn.example/n.m3u8'}]}]}};};
 const streams=await lookupVietnameseCatalogues(args,{fetchJson,validateUrl:async()=>true});assert.equal(streams.length,2);assert.ok(streams.every(x=>x.sourceToken.startsWith('yastream:vn:')));
 assert.ok(seen.every(x=>x.startsWith('https://phimapi.com/')||x.startsWith('https://phim.nguonc.com/')));
});
test('a failing catalogue does not hide another working source; expired year results never become video',async()=>{
 const streams=await lookupVietnameseCatalogues({type:'movie',detail},{fetchJson:async url=>{
  if(url.includes('phimapi'))throw Error('unavailable');if(url.includes('keyword='))return{items:[movie]};return{movie:{...movie,year:2011,episodes:groups}};
 }});assert.equal(streams.length,0);
});

test('private video origins are refused before being handed to a player',async()=>{assert.equal(await validateCatalogueVideoUrl('https://127.0.0.1/video.m3u8'),false);assert.equal(await validateCatalogueVideoUrl('https://[::1]/video.m3u8'),false);});
