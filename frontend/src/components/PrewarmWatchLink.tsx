'use client';

import Link from 'next/link';
import { useRef, type ReactNode } from 'react';
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

  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={fire}
      onTouchStart={fire}
      onClick={fire}
    >
      {children}
    </Link>
  );
}
