import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
const home = fs.readFileSync(path.join(root, 'src/app/page.tsx'), 'utf8');

// The fullscreen intro splash is retired: on a cold start (fresh dev server,
// wiped .next) its overlay painted pure black over the header while the page
// chunk and the first data fetch were still pending — long enough to read as
// a broken page. No route may mount it anymore.
test('intro animation is retired from every route', () => {
  assert.doesNotMatch(layout, /IntroAnimation/);
  assert.doesNotMatch(home, /IntroAnimation/);
  assert.equal(
    fs.existsSync(path.join(root, 'src/components/IntroAnimation.tsx')),
    false,
    'IntroAnimation.tsx must stay deleted',
  );
});
