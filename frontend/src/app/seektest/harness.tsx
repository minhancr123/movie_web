'use client';

import { useCallback, useRef, useState } from 'react';
import VideoPlayer from '@/components/VideoPlayer';

const ORIGIN = 'http://localhost:5099';
// Pinned head: 5 segs x 6s = 30s written, 600s film. Seeking past ~30s must
// open a "session beginning at the target" (full VOD here).
const SLOW = `${ORIGIN}/slow/index.m3u8?segs=5`;
const FULL = `${ORIGIN}/full/index.m3u8`;

/**
 * Mounts the REAL VideoPlayer against the fake remux origin.
 * onSeekToPosition simulates POST /playback/resolve?startAt=: a 2.5s
 * "server" delay, then the src swaps to the full playlist with startAt set
 * (truncated-timeline mapping), exactly like a seek-started session.
 */
export default function SeekHarness() {
  const [src, setSrc] = useState(SLOW);
  const [startAt, setStartAt] = useState(0);
  const callsRef = useRef<{ at: number; t: number }[]>([]);
  const cancelsRef = useRef(0);

  const onSeekToPosition = useCallback((displaySeconds: number) => {
    callsRef.current.push({ at: displaySeconds, t: Date.now() });
    return new Promise<unknown>((resolve, reject) => {
      const fail = new URLSearchParams(window.location.search).get('fail') === '1';
      setTimeout(() => {
        if (fail) {
          reject(new Error('422 mô phỏng: không còn nguồn nào khả dụng'));
          return;
        }
        setStartAt(Math.floor(displaySeconds));
        setSrc(FULL);
        resolve(undefined);
      }, fail ? 1000 : 2500);
    });
  }, []);

  const onCancelSeek = useCallback(() => {
    cancelsRef.current += 1;
  }, []);

  (globalThis as any).__seekHarness = {
    calls: callsRef.current,
    get cancels() {
      return cancelsRef.current;
    },
    get src() {
      return src;
    },
    get startAt() {
      return startAt;
    },
  };

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', aspectRatio: '16/9', height: 500 }}>
      <VideoPlayer
        src={src}
        startAt={startAt}
        durationSeconds={600}
        movie={{ name: 'Seek Test', slug: 'seek-test', poster_url: '', origin_name: 'Seek Test', quality: 'HD' }}
        episode={{ name: 'Full', slug: 'full' }}
        subContext={null}
        onSeekToPosition={onSeekToPosition}
        onCancelSeek={onCancelSeek}
      />
    </div>
  );
}
