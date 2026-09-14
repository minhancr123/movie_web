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
if (!/handleWaiting[\s\S]{0,500}armStallTimer\(\)/.test(playerSource)) {
  failures.push('player-stall-watchdog');
}
if (!/externalOnly:\s*!allowEmbedded/.test(playerSource)) {
  failures.push('subtitle-background-prefetch');
}

if (failures.length) {
  console.error(`FAIL checks=${failures.join(',')}`);
  process.exit(1);
}

console.log('PASS checks=dead-remux-health-check,external-subtitle-fast-path,player-stall-watchdog,subtitle-background-prefetch');
process.exit(0);
