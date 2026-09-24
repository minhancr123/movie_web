/** Browser regression harness: production CSS, production CinemaLayer, real video pixels.
 * Start with `node frontend/tests/fixtures/fullscreen-ambient-server.mjs` and open
 * http://127.0.0.1:4318. Click Run fullscreen checks, then Escape to check exit.
 * Only playback transport is replaced with a local canvas captureStream; no network media.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repo = path.dirname(frontend);
const require = createRequire(path.join(frontend, 'package.json'));
const ts = require('typescript');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const tx = path.join(repo, '.codex-task/ambient-fullscreen/revision-2');
const args = process.argv.slice(2);
if (args[0] === '--check-report') {
  const report = JSON.parse(fs.readFileSync(args[1], 'utf8'));
  const failed = report.checks.filter(x => !x.pass);
  console.log(`BROWSER_RESULT=${failed.length ? 'FAIL' : 'PASS'} ${report.checks.length - failed.length}/${report.checks.length}`);
  for (const c of failed) console.log(`FAIL ${c.name}: ${c.actual}`);
  process.exit(failed.length || report.checks.length < 7 ? 1 : 0);
}

function build(revision) {
  const source = relative => {
    const snapshot = path.join(tx, revision === 'rollback' ? 'rollback-probe' : 'original', 'frontend', relative);
    return fs.readFileSync(revision !== 'modified' && fs.existsSync(snapshot) ? snapshot : path.join(frontend, relative), 'utf8');
  };
  const modules = {};
  for (const name of ['components/CinemaLayer', 'components/SpatialShader', 'lib/ambilight', 'lib/shaderPref']) {
    const ext = name.startsWith('components/') ? '.tsx' : '.ts';
    modules['@/' + name] = ts.transpileModule(source('src/' + name + ext), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
  }
  // Reuse the actual shell/stage/frame markup from PlaybackSection, not a second design.
  const ast = ts.createSourceFile('PlaybackSection.tsx', source('src/components/PlaybackSection.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const classOf = n => n.openingElement.attributes.properties.find(p => p.name?.text === 'className')?.initializer?.text;
  let shell;
  function visit(n) {
    if (ts.isJsxElement(n) && classOf(n)?.includes('ambient-fullscreen-shell')) shell = n;
    ts.forEachChild(n, visit);
  }
  visit(ast);
  const stage = shell.children.find(ts.isJsxElement);
  const frame = stage.children.find(ts.isJsxElement);
  return { modules, classes: { shell: classOf(shell), stage: classOf(stage), frame: classOf(frame) }, css: source('src/app/globals.css') };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:4318');
  const revision = ['baseline', 'rollback'].includes(url.searchParams.get('revision')) ? url.searchParams.get('revision') : 'modified';
  try {
    const client = fs.readFileSync(path.join(frontend, 'tests/fixtures/fullscreen-ambient-client.js'), 'utf8');
    if (url.pathname === '/report' && req.method === 'POST') {
      let body = '';
      for await (const part of req) body += part;
      fs.mkdirSync(tx, { recursive: true });
      fs.writeFileSync(path.join(tx, `browser-${revision}.json`), body);
      res.end('recorded');
      return;
    }
    if (url.pathname === '/react.js' || url.pathname === '/react-dom.js') {
      const pkg = url.pathname === '/react.js' ? 'react' : 'react-dom';
      res.setHeader('Content-Type', 'text/javascript');
      res.end(fs.readFileSync(path.join(frontend, `node_modules/${pkg}/umd/${pkg}.development.js`)));
      return;
    }
    const { modules, classes, css } = build(revision);
    const compiledCss = (await postcss([tailwind({ content: [{ raw: Object.values(classes).join(' ') + ' relative absolute inset-0 w-full h-full bg-black overflow-hidden pointer-events-none -z-10 z-20 isolate', extension: 'html' }], corePlugins: { preflight: true } })]).process(css, { from: undefined })).css;
    const definitions = Object.entries(modules).map(([name, body]) => `${JSON.stringify(name)}:function(require,module,exports){${body}\n}`).join(',');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><title>Fullscreen Ambilight regression — ${revision}</title>
      <style id="production-css">${compiledCss}</style>
      <style>body{margin:0;background:#151619;color:white;font:16px system-ui}#toolbar{padding:16px}button,select{background:#333;color:white;border:1px solid #666;padding:8px 12px;margin:4px;border-radius:6px}#mount{width:80%;margin:20px auto}.test-controls{position:absolute;z-index:20;bottom:16px;left:16px}.test-caption{position:absolute;z-index:20;top:50%;left:50%;transform:translate(-50%,-50%);color:white;font-size:24px}#results{white-space:pre-wrap;padding:16px}.pass{color:#9f9}.fail{color:#f99}</style></head>
      <body><div id="toolbar"><h1>Fullscreen Ambilight — ${revision}</h1><button id="run">Run fullscreen checks</button><button id="matrix">Run aspect ratio checks</button><button id="off">Toggle glow</button><button id="pause">Pause / play</button><label>Video fit <select id="fit"><option>contain</option><option>cover</option><option>fill</option></select></label></div><div id="mount"></div><pre id="results">Ready</pre>
      <script src="/react.js"></script><script src="/react-dom.js"></script>
      <script>const modules={${definitions}},cache={};function require(name){if(name==='react')return React;if(name==='react-dom')return ReactDOM;if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;modules[name](require,module,module.exports);return module.exports;}window.fixtureClasses=${JSON.stringify(classes)};window.fixtureRevision=${JSON.stringify(revision)};</script>
      <script>${client}</script></body></html>`);
  } catch (e) { res.statusCode = 500; res.end(String(e.stack)); }
});
server.listen(4318, '127.0.0.1', () => console.log('FIXTURE_URL=http://127.0.0.1:4318'));
