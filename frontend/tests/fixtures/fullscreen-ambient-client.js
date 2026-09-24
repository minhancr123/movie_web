/* Runs inside the local browser regression fixture. */
const { createElement: h, useState, useEffect } = React;
const CinemaLayer = require('@/components/CinemaLayer').default;
const checks = [];
const results = document.querySelector('#results');
function record(name, pass, actual) {
  checks.push({ name, pass, actual });
  results.textContent = checks.map(c => `${c.pass ? 'PASS' : 'FAIL'} ${c.name}: ${c.actual}`).join('\n');
  results.className = checks.some(c => !c.pass) ? 'fail' : 'pass';
  fetch('/report?revision=' + fixtureRevision, { method: 'POST', body: JSON.stringify({ revision: fixtureRevision, checks }, null, 2) });
}
const input = document.createElement('canvas');
input.width = 1280; input.height = 720;
const ctx = input.getContext('2d');
let scene = 0;
function draw() {
  const palette = scene % 2 ? ['#30324c', '#833c27', '#173348'] : ['#30324c', '#184968', '#663317'];
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
  gradient.addColorStop(0, palette[1]); gradient.addColorStop(.5, palette[0]); gradient.addColorStop(1, palette[2]);
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1280, 720);
  ctx.strokeStyle = '#6b7183'; ctx.lineWidth = 2;
  for (let x = 80; x < 1280; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 720); ctx.stroke(); }
  ctx.fillStyle = '#e2e4eb'; ctx.font = '24px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('FULL FRAME · centre stays untouched', 640, 340);
  requestAnimationFrame(draw);
}
draw();
setInterval(() => scene++, 2500);
let liveVideo, liveShell, controlClicks = 0;
function App() {
  const [video, setVideo] = useState(null);
  const [mode, setMode] = useState('ambilight');
  useEffect(() => {
    document.querySelector('#off').onclick = () => setMode(m => m === 'off' ? 'ambilight' : 'off');
    document.querySelector('#pause').onclick = () => video && (video.paused ? video.play() : video.pause());
    document.querySelector('#fit').onchange = e => { if (video) video.style.objectFit = e.target.value; };
    if (video) { video.srcObject = input.captureStream(24); video.play(); }
    return () => { video?.srcObject?.getTracks().forEach(t => t.stop()); };
  }, [video]);
  return h('div', { className: fixtureClasses.shell, ref: el => { liveShell = el; } },
    h('div', { className: fixtureClasses.stage },
      h(CinemaLayer, { mode, video }),
      h('div', { className: fixtureClasses.frame, 'data-test-frame': true },
        h('div', { className: 'relative w-full h-full bg-black overflow-hidden', 'data-test-player': true },
          h('video', { ref: setVideo, muted: true, playsInline: true, style: { width: '100%', height: '100%', objectFit: 'contain' } }),
          h('div', { className: 'test-controls' },
            h('button', { id: 'control-probe', onClick: () => { controlClicks++; } }, 'Controls remain clickable'),
            h('button', { id: 'exit', onClick: () => document.exitFullscreen() }, 'Exit fullscreen'),
            h('button', { onClick: () => setMode(m => m === 'off' ? 'ambilight' : 'off') }, 'Toggle glow'))))));
}
ReactDOM.createRoot(document.querySelector('#mount')).render(h(App));
const settle = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const close = (a, b) => Math.abs(a - b) <= 1;
function sameBounds(a, b) { return ['x', 'y', 'width', 'height'].every(k => close(a[k], b[k])); }
function canvasData(canvas) { return canvas?.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; }
function hasLight(canvas) { return canvasData(canvas)?.some((v, i) => i % 4 < 3 && v > 12); }
async function waitFor(predicate, timeout = 4000) {
  const until = performance.now() + timeout;
  while (performance.now() < until) { if (predicate()) return true; await new Promise(r => setTimeout(r, 100)); }
  return false;
}
document.querySelector('#run').onclick = async () => {
  const before = liveShell.getBoundingClientRect();
  await liveShell.requestFullscreen();
  await settle();
  const shell = liveShell.getBoundingClientRect();
  const frame = liveShell.querySelector('[data-test-frame]').getBoundingClientRect();
  liveVideo = liveShell.querySelector('video');
  record('native fullscreen owns glow and player', document.fullscreenElement === liveShell && !!liveShell.querySelector('canvas'), 'shell=' + (document.fullscreenElement === liveShell));
  record('no artificial fullscreen margins', sameBounds(shell, frame), `shell=${shell.width}x${shell.height}; frame=${frame.width}x${frame.height}; x=${frame.x}; y=${frame.y}`);
  record('video element uses whole fullscreen frame', sameBounds(shell, liveVideo.getBoundingClientRect()), `${liveVideo.clientWidth}x${liveVideo.clientHeight}`);
  const light = liveShell.querySelector('.cinema-glow-viewport');
  const style = light && getComputedStyle(light);
  record('glow composited above video without intercepting clicks', !!style && Number(style.zIndex) > 0 && style.pointerEvents === 'none', style ? `z=${style.zIndex};pointer=${style.pointerEvents}` : 'glow is behind video');
  const mask = style?.maskImage || style?.webkitMaskImage;
  record('edge-only mask keeps centre transparent', !!mask && mask.includes('linear-gradient') && mask.includes('0, 0, 0, 0'), mask || 'no edge mask');
  const canvas = liveShell.querySelector('canvas');
  record('production sampler paints real video colours', await waitFor(() => hasLight(canvas)), `canvas=${canvas?.width}x${canvas?.height}`);
  const button = document.querySelector('#control-probe');
  const rect = button.getBoundingClientRect();
  record('controls stay on top of glow', document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === button, 'hit-tested control centre');
  const fitSizes = [];
  for (const fit of ['contain', 'cover', 'fill']) {
    liveVideo.style.objectFit = fit;
    await settle();
    fitSizes.push(sameBounds(shell, liveVideo.getBoundingClientRect()));
  }
  liveVideo.style.objectFit = 'contain';
  record('contain cover fill never shrink the fullscreen element', fitSizes.every(Boolean), fitSizes.join(','));
  const onExit = async () => {
    if (document.fullscreenElement) return;
    document.removeEventListener('fullscreenchange', onExit);
    await settle();
    const after = liveShell.getBoundingClientRect();
    const normalGlow = liveShell.querySelector('.cinema-glow-viewport');
    // Native fullscreen can also resize the host browser panel. Compare the
    // restored inline aspect and parent width rather than a stale pixel size.
    record('exit restores inline player sizing', close(after.width, document.querySelector('#mount').clientWidth) && Math.abs(before.width / before.height - after.width / after.height) < .01, `before=${before.width}x${before.height};after=${after.width}x${after.height}`);
    record('exit restores external glow behind the film', !!normalGlow && Number(getComputedStyle(normalGlow).zIndex) < 0, normalGlow ? getComputedStyle(normalGlow).zIndex : 'no glow viewport');
  };
  document.addEventListener('fullscreenchange', onExit);
};
document.querySelector('#matrix').onclick = async () => {
  // Size-only cases emulate the fullscreen selector inside isolated, real layout viewports.
  // The separate Run fullscreen checks action above exercises the native Fullscreen API.
  const css = document.querySelector('#production-css').textContent.replaceAll(':fullscreen', '[data-fixture-fullscreen]');
  for (const [width, height] of [[1920,1080],[2560,1080],[1024,768],[390,844]]) {
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `position:fixed;left:-10000px;width:${width}px;height:${height}px;border:0`;
    const ready = new Promise(resolve => iframe.onload = resolve);
    iframe.srcdoc = `<style>${css}</style><div class="${fixtureClasses.shell}" data-fixture-fullscreen><div class="${fixtureClasses.stage}"><div class="${fixtureClasses.frame}"><video style="width:100%;height:100%"></video></div></div></div>`;
    document.body.append(iframe);
    await ready;
    const doc = iframe.contentDocument;
    const shell = doc.querySelector('[data-fixture-fullscreen]').getBoundingClientRect();
    const video = doc.querySelector('video').getBoundingClientRect();
    record(`fills ${width}x${height} viewport without forcing 16:9 stage`, sameBounds(shell, video) && close(shell.width, width) && close(shell.height, height), `video=${video.width}x${video.height};x=${video.x};y=${video.y}`);
    iframe.remove();
  }
};
