'use client';

import Link from 'next/link';
import { useEffect, useRef, type ReactNode } from 'react';
import { playbackAPI } from '@/lib/api';
import { detectCapabilities } from '@/lib/capabilities';

interface PrewarmWatchLinkProps {
  type: string;
  tmdbId: number;
  season?: number | null;
  episode?: number | null;
  href: string;
  className?: string;
  children: ReactNode;
}

/**
 * How long the pointer must rest on a link before a HOVER prewarm fires.
 *
 * Prewarm shares its rate-limit bucket with resolve (30/min, playbackRateLimit),
 * so a mouse sweeping across an episode list would otherwise spend the whole
 * budget on rows nobody wanted — and 429 the actual resolve that follows. Touch
 * and click are deliberate, so they still fire immediately; only hover waits.
 */
const HOVER_DWELL_MS = 250;

/**
 * Watch link that warms the resolve caches ahead of navigation.
 *
 * POST /playback/prewarm runs resolve's expensive-but-idempotent prefix
 * (candidates, link, ffprobe) without spawning ffmpeg, so the watch page's
 * real resolve skips ~10 s of refetching. Fired on hover (desktop) and on
 * tap/click: even if navigation aborts the request client-side, the server
 * keeps working and the caches still land. Once per mount, silent, best
 * effort — a failure must never block going to the film.
 */
export default function PrewarmWatchLink({
  type,
  tmdbId,
  season,
  episode,
  href,
  className,
  children,
}: PrewarmWatchLinkProps) {
  const warmed = useRef(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (dwellTimer.current) clearTimeout(dwellTimer.current);
  }, []);

  const fire = () => {
    if (warmed.current) return;
    warmed.current = true;
    try {
      const caps = detectCapabilities();
      void playbackAPI
        .prewarm({
          type,
          tmdbId,
          ...(season != null ? { season } : {}),
          ...(episode != null ? { episode } : {}),
          capabilities: caps,
        })
        .catch(() => {
          // Best effort only.
        });
    } catch {
      // detectCapabilities touches window APIs; never break navigation.
      warmed.current = false;
    }
  };

  const fireAfterDwell = () => {
    if (warmed.current || dwellTimer.current) return;
    dwellTimer.current = setTimeout(() => {
      dwellTimer.current = null;
      fire();
    }, HOVER_DWELL_MS);
  };

  const cancelDwell = () => {
    if (dwellTimer.current) {
      clearTimeout(dwellTimer.current);
      dwellTimer.current = null;
    }
  };

  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={fireAfterDwell}
      onMouseLeave={cancelDwell}
      onTouchStart={fire}
      onClick={fire}
    >
      {children}
    </Link>
  );
}
