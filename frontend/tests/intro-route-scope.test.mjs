import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
const home = fs.readFileSync(path.join(root, 'src/app/page.tsx'), 'utf8');

test('intro animation is scoped to the home route, not watch pages', () => {
  assert.doesNotMatch(layout, /IntroAnimation/);
  assert.match(home, /IntroAnimation/);
});
