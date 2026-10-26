/**
 * A video site's service worker has one job: cache the shell, and stay out of
 * the way.
 *
 * The worker it replaces had been sitting in public/ since April 2026 with a
 * Pages-Router chunk table, and because public/ is copied verbatim into the image
 * its bytes never changed, so the browser never re-installed it — returning
 * visitors have been served by a worker referencing routes that stopped existing
 * months ago. These assertions pin the two things that matter: the replacement
 * purges what the old one left behind, and it never touches /api/, where a
 * cached resolve or a cached HLS segment would be actively harmful.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sw = readFileSync(path.join(root, 'public/sw.js'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(root, 'public/manifest.json'), 'utf8'));
const register = readFileSync(path.join(root, 'src/components/ServiceWorkerRegister.tsx'), 'utf8');
const layout = readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');

test('the old frozen workbox runtime is gone', () => {
  const leftovers = ['workbox-4754cb34.js', 'sw.js.map']
    .filter((f) => existsSync(path.join(root, 'public', f)));
  assert.deepEqual(leftovers, [], 'workbox runtime must not ship alongside the replacement');
  assert.doesNotMatch(sw, /precacheAndRoute|workbox-precache/, 'no workbox precache table left');
  assert.doesNotMatch(sw, /_next\/static\/chunks\/app\//, 'no hand-written chunk table to rot');
});

test('the worker purges caches it does not own, which is how the April one dies', () => {
  assert.match(sw, /const OWN_CACHES = new Set/, 'owned cache names are declared');
  assert.match(sw, /names\.filter\(\(name\) => !OWN_CACHES\.has\(name\)\)/,
    'activate deletes every foreign cache, not just its own predecessor');
  assert.match(sw, /VERSION = 'cinevn-v3'/, 'cache names are versioned, so a change purges');
  assert.match(sw, /SKIP_WAITING/, 'it honours the page asking to take over');
});

test('nothing under /api/ is ever cached', () => {
  // A cached resolve response, session poll or HLS segment is worse than no
  // response at all. Episodes are ~450 MB and already immutable in the HTTP
  // cache; duplicating that into the Cache API would fill storage for nothing.
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/, 'the /api guard exists');
  // The guard is CALLED from the fetch handler, before it responds with anything.
  // (Its definition sits above the handler, so comparing those two offsets would
  // be comparing source layout rather than behaviour.)
  const handlerAt = sw.indexOf("addEventListener('fetch'");
  const callAt = sw.indexOf('if (isUncacheable(url)) return;');
  assert.ok(handlerAt > 0 && callAt > handlerAt, 'the guard is applied inside the fetch handler');
  assert.doesNotMatch(sw, /cache\.add\(\/api/, 'no /api/ URL is ever added to a cache');
  // Same-origin /api/ must not slip through the cross-origin filter instead.
  assert.match(sw, /url\.origin !== self\.location\.origin/, 'cross-origin is skipped too');
});

test('pages are network-first so a cached document cannot outrun a deploy', () => {
  // The server serves HTML no-store. Caching it would pin a build that is no
  // longer deployed — the failure that made "which build am I running?"
  // unanswerable from the page.
  assert.match(sw, /request\.mode === 'navigate'[\s\S]{0,400}offlineResponse\(\)/,
    'navigations go to the network, with a guaranteed Response as the floor');
  assert.match(sw, /isImmutableAsset[\s\S]{0,120}cache\.match\(request\)[\s\S]{0,220}const response = await fetch\(request\)/,
    'hashed build output is cache-first');
  assert.ok(existsSync(path.join(root, 'public/offline.html')), 'the offline page exists');
});

test('a failed request can never resolve to undefined', () => {
  // catch(() => hit) resolves to undefined when the fetch fails and nothing
  // was cached, and respondWith(undefined) throws "Failed to convert value
  // to 'Response'" as an unhandled rejection — leaving the request hanging
  // rather than failing the way the network did.
  assert.match(sw, /\.catch\(\(\) => hit \|\| offlineResponse\(\)\)/,
    'the stale-while-revalidate fallback always resolves to a Response');
  assert.match(sw, /const offlineResponse = \(\) => new Response\(''/,
    'the fallback is a real Response, and catch sites use it');
});

test('the worker is registered, and its updates are applied', () => {
  // A registered worker that never reloads is worse than none: tabs keep running
  // the bundle from install time, so after a deploy they quietly execute code
  // that is no longer deployed. That is indistinguishable from the bug.
  assert.match(register, /navigator\.serviceWorker\.register\('\/sw\.js\?rev=cinevn-v3', \{ scope: '\/', updateViaCache: 'none' \}\)/);
  assert.match(register, /updatefound/, 'an installing worker is observed');
  assert.match(register, /navigator\.serviceWorker\.controller/, 'a replacement is told from a first install');
  // The handler that reloads, and the wiring that calls it. Checked as two
  // halves: a directional regex would be asserting the order the author happened
  // to write the lines in, not the behaviour.
  assert.match(register, /const onControllerChange = \(\) => \{[\s\S]{0,160}window\.location\.reload\(\)/,
    'the controllerchange handler reloads');
  assert.match(register, /addEventListener\('controllerchange', onControllerChange\)/,
    'and it is actually wired to controllerchange');
  assert.match(register, /reloading/, 'and reloads only once');
  // Polarity, not presence. Written as `=== 'production'` the guard is an
  // unconditional return in the served bundle: Next folds process.env.NODE_ENV,
  // the minifier deletes everything after it, and no worker is ever registered
  // while the source still reads as though it were. This assertion exists because
  // the first version of it matched the wrong line and passed.
  assert.match(
    register,
    /if \(process\.env\.NODE_ENV !== 'production'\) return;/,
    'the early return is for development, not production',
  );
  assert.doesNotMatch(
    register,
    /if \(process\.env\.NODE_ENV === 'production'\) return;/,
    'an early return for production disables the worker in every real build',
  );
  assert.match(layout, /<ServiceWorkerRegister \/>/, 'it is mounted in the root layout');
});

test('the manifest is installable and pointed at routes that exist', () => {
  for (const key of ['name', 'short_name', 'start_url', 'scope', 'display']) {
    assert.ok(manifest[key], `manifest.${key} is required for installability`);
  }
  assert.equal(manifest.display, 'standalone', 'no browser chrome once installed');
  assert.equal(manifest.orientation, 'any',
    'portrait-primary would fight every viewer who turns the phone to watch');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'), 'Chrome requires a 192px icon');
  assert.ok(sizes.includes('512x512'), 'and a 512px one');
  for (const icon of manifest.icons) {
    assert.ok(existsSync(path.join(root, 'public', icon.src.replace(/^\//, ''))),
      `icon ${icon.src} is on disk`);
  }
  for (const shortcut of manifest.shortcuts || []) {
    const route = shortcut.url.split('?')[0];
    assert.ok(existsSync(path.join(root, 'src/app', route.slice(1))),
      `shortcut ${route} is a real route`);
  }
});

test('iOS can add it to the home screen', () => {
  // iOS has no install prompt at all: it is Share -> Add to Home Screen, and
  // without these tags the app launches as a Safari tab with its own chrome.
  for (const tag of [
    'apple-mobile-web-app-capable',
    'apple-mobile-web-app-status-bar-style',
    'apple-touch-icon',
  ]) {
    assert.ok(layout.includes(tag), `${tag} is required for an iOS home-screen app`);
  }
  assert.match(layout, /rel="manifest"/, 'the manifest is linked');
});

// Execute the actual worker instead of treating its source text as behavior.
async function workerRequest(request, fetchFn, offline = '<h1>offline</h1>') {
  const { runInNewContext } = await import('node:vm');
  const handlers = {}, writes = [];
  const context = {
    self: { location: { origin: 'https://cinevn.me' }, addEventListener: (name, fn) => { handlers[name] = fn; } },
    URL, Response, Request: class { constructor(original, options) { Object.assign(this, original, options); } },
    fetch: fetchFn,
    caches: { match: async () => offline ? new Response(offline) : undefined, open: async () => ({ match: async () => undefined, put: (...args) => writes.push(args) }) },
  };
  runInNewContext(sw, context);
  let result;
  handlers.fetch({ request, respondWith: value => { result = value; } });
  return { response: result ? await result : undefined, writes };
}
const navigation = () => ({ url:'https://cinevn.me/phim/movie/791523/wildwood',method:'GET',mode:'navigate',destination:'document',headers:new Headers(),signal:{aborted:false} });

test('one transient navigation failure retries before showing the offline document',async()=>{
  let attempts=0;
  const {response}=await workerRequest(navigation(),async request=>{if(++attempts===1)throw new Error('connection reset');assert.equal(request.cache,'reload');return new Response('actual film');});
  assert.equal(attempts,2);assert.equal(await response.text(),'actual film');
});
test('persistent connection failure returns an uncached 503 document, never a cached 200 success',async()=>{
  let attempts=0;const {response}=await workerRequest(navigation(),async()=>{attempts++;throw Error('offline');});
  assert.equal(attempts,2);assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-cinevn-offline'),'1');assert.match(await response.text(),/offline/);
});
test('RSC, prefetch and arbitrary same-origin data never use the image cache',async()=>{
  for(const request of [
    {...navigation(),mode:'cors',destination:'',url:'https://cinevn.me/phim/movie/791523/wildwood?_rsc=test'},
    {...navigation(),mode:'cors',destination:'',headers:new Headers({RSC:'1'})},
    {...navigation(),mode:'cors',destination:'',headers:new Headers({'Next-Router-State-Tree':'tree'})},
    {...navigation(),mode:'cors',destination:'',headers:new Headers({Accept:'text/x-component'})},
    {...navigation(),mode:'cors',destination:'',url:'https://cinevn.me/data.json'},
  ]) { const result=await workerRequest(request,()=>{throw Error('worker must pass through');});assert.equal(result.response,undefined);assert.equal(result.writes.length,0); }
});

const offline = readFileSync(path.join(root,'public/offline.html'),'utf8');
async function offlinePage({ fetchFn = async()=>new Response(null,{headers:{'content-type':'text/html'}}), storage = new Map() } = {}) {
  const {runInNewContext}=await import('node:vm');const timers=[],events={},replaced=[],elements={};
  const target='https://cinevn.me/phim/movie/791523/wildwood?s=1&e=4';
  const context={URL,AbortController,Date,JSON,Math,location:{href:target,replace:value=>replaced.push(value)},
    document:{visibilityState:'visible',addEventListener:(name,fn)=>events[name]=fn,getElementById:id=>elements[id] ||= {textContent:'',addEventListener:(name,fn)=>events[id+':'+name]=fn}},
    window:{addEventListener:(name,fn)=>events[name]=fn},fetch:fetchFn,
    sessionStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)},
    setTimeout:(fn,ms)=>{const item={fn,ms,cleared:false};timers.push(item);return item;},clearTimeout:item=>{if(item)item.cleared=true;}};
  runInNewContext(offline.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  return {timers,events,replaced,elements,target,storage,run:()=>timers.findLast(x=>!x.cleared&&x.ms!==5000).fn()};
}
test('offline page probes the original route and automatically returns there when it recovers',async()=>{
  let healthy=false;const requests=[];const page=await offlinePage({fetchFn:async(url,options)=>{requests.push({url,options});return new Response(null,{status:healthy?200:503,headers:{'content-type':'text/html'}});}});
  await page.run();assert.equal(page.replaced.length,0);healthy=true;await page.run();assert.deepEqual(page.replaced,[page.target]);
  assert.ok(requests.every(x=>x.url===page.target&&x.options.method==='HEAD'&&x.options.cache==='no-store'));
});
test('offline recovery cannot enter an automatic reload loop across document loads',async()=>{
  const storage=new Map();for(let i=0;i<3;i++){const page=await offlinePage({storage});await page.run();assert.equal(page.replaced.length,i<2?1:0);}
});
test('manual retry keeps the movie URL and query instead of sending the viewer home',async()=>{
  const page=await offlinePage();page.events['retry:click']();assert.deepEqual(page.replaced,[page.target]);assert.doesNotMatch(offline,/class="badge">4|Không có mạng để tải trang/);
});

// Mutable worker/offline documents bypass both browser and shared CDN caches.
test('worker registration and offline shell use the same cache-busting revision',async()=>{
 const version=/const VERSION = '([^']+)'/.exec(sw)[1];assert.ok(register.includes('/sw.js?rev='+version));assert.match(sw,/offline\.html\?rev=\$\{VERSION\}/);
 const config=(await import('../next.config.js')).default;const rules=await config.headers();
 for(const resource of ['/sw.js','/offline.html']){const rule=rules.find(x=>x.source===resource);assert.ok(rule);assert.ok(rule.headers.some(x=>x.key==='Cache-Control'&&x.value.includes('no-store')));assert.ok(rule.headers.some(x=>x.key==='Cloudflare-CDN-Cache-Control'&&x.value==='no-store'));}
});
