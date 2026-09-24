import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const playback = fs.readFileSync(path.join(root, 'src/components/PlaybackSection.tsx'), 'utf8');
const player = fs.readFileSync(path.join(root, 'src/components/VideoPlayer.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');

test('ambient layer stays inside the element requested for fullscreen', () => {
  const shellRef = playback.indexOf('ref={fullscreenTargetRef}');
  const ambientLayer = playback.indexOf('<CinemaLayer', shellRef);
  const videoPlayer = playback.indexOf('<VideoPlayer', ambientLayer);
  const sharedTarget = playback.indexOf('fullscreenTargetRef={fullscreenTargetRef}', videoPlayer);

  assert.ok(shellRef >= 0, 'the shared fullscreen shell must own a ref');
  assert.ok(ambientLayer > shellRef, 'the ambient layer must be inside the fullscreen shell');
  assert.ok(videoPlayer > ambientLayer, 'the player must share that fullscreen shell');
  assert.ok(sharedTarget > videoPlayer, 'the player must request fullscreen on the shared shell');

  assert.match(player, /fullscreenTargetRef\?\.current\s*\?\?\s*containerRef\.current/);
  assert.match(styles, /\.ambient-fullscreen-shell:fullscreen\s*\{/);
  assert.match(styles, /\.ambient-fullscreen-shell:fullscreen\s+\.ambient-fullscreen-stage\s*\{/);
});
