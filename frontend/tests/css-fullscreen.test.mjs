import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const ctx = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('../src/lib/css-fullscreen.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, ctx);
const { enterCssFullscreen } = ctx.exports;
class Style {
  values = new Map();
  setProperty(key, value, priority = '') { this.values.set(key, [value, priority]); }
  getPropertyValue(key) { return this.values.get(key)?.[0] || ''; }
  getPropertyPriority(key) { return this.values.get(key)?.[1] || ''; }
  removeProperty(key) { this.values.delete(key); }
}
const fixture = (withViewport = true) => {
  const win = new EventTarget();
  const viewport = Object.assign(new EventTarget(), { width: 390, height: 720, offsetTop: 0, offsetLeft: 0 });
  Object.assign(win, { innerWidth: 390, innerHeight: 844, visualViewport: withViewport ? viewport : null,
    getComputedStyle: el => ({ position: el.position || 'relative' }) });
  const doc = { defaultView: win };
  const node = parent => ({ parentElement: parent, ownerDocument: doc, style: new Style(), attrs: new Map(),
    getAttribute(key) { return this.attrs.get(key) ?? null; },
    setAttribute(key, value) { this.attrs.set(key, value); }, removeAttribute(key) { this.attrs.delete(key); } });
  const html = node(null), body = node(html), wrapper = node(body), target = node(wrapper);
  Object.assign(doc, { documentElement: html, body });
  return { win, viewport, wrapper, body, target };
};
test('positioned auto-z ancestors escape clipping/containing blocks, then restore exact priorities', () => {
  const { target, wrapper, body } = fixture();
  wrapper.style.setProperty('transform', 'translateZ(0)', 'important');
  wrapper.style.setProperty('overflow', 'clip');
  body.style.setProperty('overflow', 'auto');
  const cleanup = enterCssFullscreen(target);
  assert.equal(wrapper.style.getPropertyValue('z-index'), '2147483646');
  assert.equal(wrapper.style.getPropertyValue('transform'), 'none');
  assert.equal(wrapper.style.getPropertyValue('overflow'), 'visible');
  assert.equal(body.style.getPropertyValue('overflow'), 'hidden');
  assert.equal(target.getAttribute('data-cinevn-css-fullscreen'), '');
  // Unrelated state changes during playback must survive fullscreen cleanup.
  target.style.setProperty('color', 'red');
  cleanup(); cleanup();
  assert.equal(wrapper.style.getPropertyValue('transform'), 'translateZ(0)');
  assert.equal(wrapper.style.getPropertyPriority('transform'), 'important');
  assert.equal(wrapper.style.getPropertyValue('overflow'), 'clip');
  assert.equal(wrapper.style.getPropertyValue('z-index'), '');
  assert.equal(body.style.getPropertyValue('overflow'), 'auto');
  assert.equal(target.style.getPropertyValue('color'), 'red');
  assert.equal(target.getAttribute('data-cinevn-css-fullscreen'), null);
});
test('rotation and Safari toolbar resize follow the visible viewport; retired listeners do nothing', () => {
  const { target, viewport, win } = fixture();
  const cleanup = enterCssFullscreen(target);
  assert.equal(target.style.getPropertyValue('height'), '720px');
  Object.assign(viewport, { width: 844, height: 350, offsetLeft: 12, offsetTop: 4 });
  viewport.dispatchEvent(new Event('resize'));
  assert.equal(target.style.getPropertyValue('width'), '844px');
  assert.equal(target.style.getPropertyValue('height'), '350px');
  assert.equal(target.style.getPropertyValue('left'), '12px');
  assert.equal(target.style.getPropertyValue('top'), '4px');
  cleanup();
  viewport.dispatchEvent(new Event('scroll')); win.dispatchEvent(new Event('resize'));
  assert.equal(target.style.getPropertyValue('width'), '');
});
test('browsers without VisualViewport use window size and still restore the target', () => {
  const { target, win } = fixture(false);
  target.style.setProperty('height', '80%', 'important');
  const parent = target.parentElement;
  const cleanup = enterCssFullscreen(target);
  assert.equal(target.style.getPropertyValue('height'), '844px');
  win.innerHeight = 390; win.dispatchEvent(new Event('resize'));
  assert.equal(target.style.getPropertyValue('height'), '390px');
  assert.equal(target.parentElement, parent, 'video ancestry is never reparented');
  cleanup();
  assert.equal(target.style.getPropertyValue('height'), '80%');
  assert.equal(target.style.getPropertyPriority('height'), 'important');
});
