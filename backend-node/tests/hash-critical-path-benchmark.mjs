// Controlled local HTTP benchmark of the OPTIONAL HASH GATE, not player TTFF.
import http from 'node:http';import {performance} from 'node:perf_hooks';
import {computeOpenSubtitlesHash,singleflightFileHash} from '../services/playback/opensubtitlesHash.js';
const server=http.createServer((req,res)=>{const [,a,b]=/bytes=(\d+)-(\d+)/.exec(req.headers.range);res.writeHead(206,{'content-range':`bytes ${a}-${b}/131072`});setTimeout(()=>res.end(Buffer.alloc(65536)),80);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/file`;
const summary=values=>{values.sort((a,b)=>a-b);return {n:values.length,p50Ms:+values[Math.floor(values.length*.5)].toFixed(2),p95Ms:+values[Math.floor(values.length*.95)].toFixed(2)};};
const before=[],after=[];let failures=0;
try{for(let i=0;i<30;i++){
 let start=performance.now();try{await computeOpenSubtitlesHash(url,131072);before.push(performance.now()-start);}catch{failures++;}
 start=performance.now();const background=singleflightFileHash(`fixture:${i}`,()=>computeOpenSubtitlesHash(url,131072));
 // The new response path has no await on this optional task.
 after.push(performance.now()-start);await background;
}console.log(JSON.stringify({scenario:'optional-hash-critical-path-only',network:'loopback, 80ms body delay per parallel Range',before:summary(before),after:summary(after),failures,device:'Node.js; NOT iPhone or end-to-end playback'},null,2));}
finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
