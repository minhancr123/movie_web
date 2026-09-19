'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import VideoPlayer from '@/components/VideoPlayer';

const ORIGIN = 'http://localhost:5099';
const FULL = `${ORIGIN}/full/index.m3u8`;

/**
 * Mounts the REAL VideoPlayer against the fake remux origin with a subtitle
 * sidecar timed in FULL-FILM coordinates (see e2e/media/server.mjs).
 *
 * `?startAt=480` simulates a seek-started session: when the element plays
 * its local ~2-6s, the 8:02 cue must show (offset applied) and the 0:02
 * decoy must not. `?startAt=0` inverts the expectation (control case).
 * Exposes the displayed subtitle text for assertions.
 */
export default function SubHarness() {
  const params = useSearchParams();
  const startAt = useMemo(() => {
    const raw = Number(params.get('startAt'));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  }, [params]);

  const subContext = useMemo(
    () => ({ type: 'movie' as const, tmdbId: 1, season: null, episode: null }),
    [],
  );

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', aspectRatio: '16/9', height: 500 }}>
      <VideoPlayer
        src={FULL}
        startAt={startAt}
        durationSeconds={600}
        movie={{ name: 'Sub Test', slug: 'sub-test', poster_url: '', origin_name: 'Sub Test', quality: 'HD' }}
        episode={{ name: 'Full', slug: 'full' }}
        subContext={subContext}
      />
    </div>
  );
}
