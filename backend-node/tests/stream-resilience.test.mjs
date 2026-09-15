// Focused regression checks for dead-remux recovery and the fast subtitle path.
process.env.REDIS_URL = 'redis://127.0.0.1:6399';
process.env.STREMIO_ADDONS = '';

import fs from 'node:fs';

const remux = await import('../services/playback/remuxService.js');
const addons = await import('../services/addonClient.js');

const failures = [];

if (typeof remux.shouldReuseRemuxSession !== 'function') {
  failures.push('dead-remux-health-check');
} else {
  const reusable = remux.shouldReuseRemuxSession({
    playlistComplete: false,
    hasLiveSession: true,
    liveExitCode: 1,
    playlistGrowing: false,
  });
  if (reusable !== false) failures.push('dead-remux-health-check');
}

if (typeof addons.normalizeSubtitlePayload !== 'function') {
  failures.push('external-subtitle-fast-path');
} else {
  const tracks = addons.normalizeSubtitlePayload(
    {
      subtitles: [
        { id: 'en-1', lang: 'eng', url: 'https://subs.example/en.srt' },
        { id: 'vi-1', lang: 'vie', url: 'https://subs.example/vi.srt' },
        { id: 'bad', lang: 'vie', url: 'http://127.0.0.1/private.srt' },
      ],
    },
    'opensubtitles.example',
  );
  if (tracks.length !== 2 || tracks[0]?.language !== 'vie') {
    failures.push('external-subtitle-fast-path');
  }
}

const playerSource = fs.readFileSync(
  new URL('../../frontend/src/components/VideoPlayer.tsx', import.meta.url),
  'utf8',
);
const playbackControllerSource = fs.readFileSync(
  new URL('../controllers/playbackController.js', import.meta.url),
  'utf8',
);
const sectionSource = fs.readFileSync(
  new URL('../../frontend/src/components/PlaybackSection.tsx', import.meta.url),
  'utf8',
);
if (
  /state\.duration < 30/.test(playbackControllerSource) ||
  !/const PLAYLIST_MIN_SECONDS = Math\.min\(8, STARTUP_BUFFER_SECONDS\)/.test(playbackControllerSource) ||
  (playbackControllerSource.match(/state\.duration < PLAYLIST_MIN_SECONDS/g) || []).length < 1
) {
  failures.push('hls-startup-threshold-invariant');
}
if (!/handleWaiting[\s\S]{0,500}armStallTimer\(\)/.test(playerSource)) {
  failures.push('player-stall-watchdog');
}
if (
  !/const handlePlay = \(\) => \{[\s\S]{0,180}armStallTimer\(\)/.test(playerSource) ||
  !/video\.currentTime > lastProgressRef\.current \+ 0\.25\) \{[\s\S]{0,120}armStallTimer\(\)/.test(playerSource)
) {
  failures.push('player-continuous-stall-watchdog');
}
if (!/externalOnly:\s*!allowEmbedded/.test(playerSource)) {
  failures.push('subtitle-background-prefetch');
}
// A recovery that resolves the identical playlist URL must still rebuild the
// player: React bails out on an unchanged src, so without a forced reload the
// stuck hls.js instance is never destroyed and the watchdog never re-arms.
if (
  !/reloadKey\?: number/.test(playerSource) ||
  !/retryKey, reloadKey, onPlaybackFailure\]/.test(playerSource) ||
  !/setReloadKey\(\(k\) => k \+ 1\)/.test(sectionSource) ||
  !/reloadKey=\{reloadKey\}/.test(sectionSource)
) {
  failures.push('player-recovery-forces-reload');
}

if (failures.length) {
  console.error(`FAIL checks=${failures.join(',')}`);
  process.exit(1);
}

console.log('PASS checks=dead-remux-health-check,external-subtitle-fast-path,hls-startup-threshold-invariant,player-stall-watchdog,player-continuous-stall-watchdog,player-recovery-forces-reload,subtitle-background-prefetch');
process.exit(0);
