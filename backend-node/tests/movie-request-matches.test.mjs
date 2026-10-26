import test from 'node:test';import assert from 'node:assert/strict';
import {movieRequestMatches} from '../services/movieRequestMatches.js';
test('admin request matching reads normalized movie and TV catalog entries',()=>{
 const rows=movieRequestMatches({items:[{tmdbId:157336,mediaType:'movie',title:'Hố đen tử thần',year:2014,poster:'https://image.tmdb.org/t/p/w500/a.jpg'}, {tmdbId:220542,mediaType:'tv',title:'Dược Sư Tự Sự',year:2023},{tmdbId:123,mediaType:'person',title:'Not a film'}]});
 assert.equal(rows.length,2);assert.equal(rows[0].tmdbId,157336);assert.equal(rows[0].year,'2014');assert.equal(rows[0].poster,'https://image.tmdb.org/t/p/w500/a.jpg');assert.equal(rows[1].mediaType,'tv');
 assert.deepEqual(movieRequestMatches(null),[]);
 assert.equal(movieRequestMatches({items:Array.from({length:10},(_,i)=>({tmdbId:i+1,mediaType:'movie',title:'Film'}))}).length,6);
});
