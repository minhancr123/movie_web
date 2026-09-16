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
    playlistFresh: false,
    playlistGrowing: false,
  });
  if (reusable !== false) failures.push('dead-remux-health-check');

  const freshLiveWriter = remux.shouldReuseRemuxSession({
    playlistComplete: false,
    hasLiveSession: true,
    liveExitCode: undefined,
    playlistFresh: true,
    playlistGrowing: false,
  });
  const hungLiveWriter = remux.shouldReuseRemuxSession({
    playlistComplete: false,
    hasLiveSession: true,
    liveExitCode: undefined,
    playlistFresh: false,
    playlistGrowing: false,
  });
  if (freshLiveWriter !== true || hungLiveWriter !== false) {
    failures.push('hung-live-remux-health-check');
  }
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
const routeLoadingUrl = new URL(
  '../../frontend/src/app/xem-phim/[type]/[tmdbId]/[slug]/loading.tsx',
  import.meta.url,
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
if (
  !/LOCAL_STALL_RECOVERY_MS/.test(playerSource) ||
  !/hls\.startLoad\(video\.currentTime\s*\|\|\s*-1\)/.test(playerSource) ||
  !/armStallTimer\(ESCALATED_STALL_TIMEOUT_MS\)/.test(playerSource)
) {
  failures.push('player-local-stall-recovery');
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
if (
  !/preservePlayer\?: boolean/.test(sectionSource) ||
  !/startPlaybackResolutionRef[\s\S]{0,300}preservePlayer:\s*true/.test(sectionSource)
) {
  failures.push('recovery-keeps-player-mounted');
}
if (
  /min-h-\[70vh\]/.test(sectionSource) ||
  !/Đang tải trình phát/.test(sectionSource)
) {
  failures.push('first-open-player-placeholder');
}
// The watch page is an async Server Component. Its client-side placeholder
// cannot mount until catalog data resolves, so the segment itself needs a
// loading boundary or first navigation shows only the page background.
if (!fs.existsSync(routeLoadingUrl)) {
  failures.push('route-level-player-skeleton');
} else {
  const routeLoadingSource = fs.readFileSync(routeLoadingUrl, 'utf8');
  if (
    !/aspect-video/.test(routeLoadingSource) ||
    !/animate-pulse/.test(routeLoadingSource) ||
    !/Đang mở rạp phim/.test(routeLoadingSource)
  ) {
    failures.push('route-level-player-skeleton');
  }
}

const getSessionSource = playbackControllerSource.slice(
  playbackControllerSource.indexOf('export const getPlaybackSession'),
  playbackControllerSource.indexOf('/* ------------------------------------------------------------ HLS'),
);
const serveHlsSource = playbackControllerSource.slice(
  playbackControllerSource.indexOf('export const serveHlsAsset'),
  playbackControllerSource.indexOf('export default'),
);
if (
  !/playlistFresh:\s*ageMs <= SESSION_STALE_MS/.test(getSessionSource) ||
  !/writerAlive:\s*writerHealthy/.test(getSessionSource) ||
  !/await stopRemuxSession\(session\.sessionId\)/.test(getSessionSource)
) {
  failures.push('warmup-kills-hung-writer');
}
if (
  !/playlistFresh:\s*ageMs <= SESSION_STALE_MS/.test(serveHlsSource) ||
  !/await stopRemuxSession\(sessionId\)/.test(serveHlsSource)
) {
  failures.push('manifest-kills-hung-writer');
}
const warmupWriterDeadBlock = sectionSource.match(
  /if \(sessionData\.writerAlive === false\) \{([\s\S]{0,400}?)\n\s*\}/,
)?.[1] || '';
if (
  !/recoverPlayback\(/.test(warmupWriterDeadBlock) ||
  /finishWarm\(\)/.test(warmupWriterDeadBlock)
) {
  failures.push('warmup-reresolves-dead-writer');
}

if (failures.length) {
  console.error(`FAIL checks=${failures.join(',')}`);
  process.exit(1);
}

console.log('PASS checks=dead-remux-health-check,hung-live-remux-health-check,external-subtitle-fast-path,hls-startup-threshold-invariant,player-stall-watchdog,player-continuous-stall-watchdog,player-local-stall-recovery,player-recovery-forces-reload,recovery-keeps-player-mounted,first-open-player-placeholder,route-level-player-skeleton,warmup-kills-hung-writer,manifest-kills-hung-writer,warmup-reresolves-dead-writer,subtitle-background-prefetch');
process.exit(0);
