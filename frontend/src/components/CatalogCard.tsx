'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PlayCircle, Star } from 'lucide-react';
import { CatalogItem, catalogHref } from '@/lib/catalog';
import { API_URL, authClient } from '@/lib/api';

// Resolved once per session; defaults to OFF (the admin panel turns it on).
let hoverPreviewFlag: Promise<boolean> | null = null;
const hoverPreviewEnabled = (): Promise<boolean> => {
  if (!hoverPreviewFlag) {
    hoverPreviewFlag = authClient
      .get('/admin/site-settings/hover-trailer', { timeout: 4000 })
      .then((res: any) => Boolean(res?.data?.data?.enabled))
      .catch(() => false);
  }
  return hoverPreviewFlag;
};

interface CatalogCardProps {
  item: CatalogItem;
  priority?: boolean;
}

/**
 * Card for a TMDB catalog entry.
 *
 * Hover preview = the TMDB TRAILER (muted YouTube embed), fetched lazily on
 * first hover and served from the catalog's 24h cache. Deliberately NOT the
 * old MovieCard behaviour of streaming a phimapi m3u8 — that cost real
 * bandwidth per hover and is what the note below was about.
 *
 * Spatial 3D: the card tilts toward the cursor (rotateX/rotateY) with a
 * self-contained perspective() transform, so the effect works in every grid
 * and row without requiring a perspective on the parent. Badges float above
 * the surface via .spatial-float-pill and a light sheen sweeps on hover.
 */
export default function CatalogCard({ item, priority = false }: CatalogCardProps) {
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, px: 0.5, py: 0.5 });
  const [hovered, setHovered] = useState(false);
  const [trailerKey, setTrailerKey] = useState<string | null>(null);
  const trailerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trailerLoadingRef = useRef(false);

  // Muted trailer after ~900ms of hover: long enough to prove intent, short
  // enough to feel alive. One fetch per card per session (the detail endpoint
  // is cached server-side); iframe unmounts on leave so audio/GPU go with it.
  const maybeStartTrailer = useCallback(async () => {
    if (trailerKey || trailerLoadingRef.current) return;
    // Site-wide, admin-controlled: OFF by default until enabled in /admin.
    if (!(await hoverPreviewEnabled())) return;
    const match = /^tmdb:(movie|tv):(\d+)/.exec(item.contentRef || '');
    if (!match) return;
    trailerTimerRef.current = setTimeout(async () => {
      trailerLoadingRef.current = true;
      try {
        const res = await fetch(`${API_URL}/catalog/${match[1]}/${match[2]}`);
        const body = await res.json();
        const keys: string[] = body?.data?.trailerKeys || [];
        const single = body?.data?.trailerKey;
        const key = keys.find((k) => typeof k === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(k))
          || (typeof single === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(single) ? single : null);
        if (key) setTrailerKey(key);
      } catch {
        // stay a poster card silently
      } finally {
        trailerLoadingRef.current = false;
      }
    }, 900);
  }, [item.contentRef, trailerKey]);

  const stopTrailerTimer = useCallback(() => {
    if (trailerTimerRef.current) { clearTimeout(trailerTimerRef.current); trailerTimerRef.current = null; }
  }, []);

  useEffect(() => () => stopTrailerTimer(), [stopTrailerTimer]);

  const rating = item.voteAverage ? item.voteAverage.toFixed(1) : null;

  const updateFromPoint = (clientX: number, clientY: number) => {
    const el = cardRef.current;
    if (!el) return;
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }
    const rect = el.getBoundingClientRect();
    const nx = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const ny = Math.min(Math.max((clientY - rect.top) / rect.height, 0), 1);
    setTilt({ x: (ny - 0.5) * -16, y: (nx - 0.5) * 16, px: nx, py: ny });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLAnchorElement>) => {
    updateFromPoint(e.clientX, e.clientY);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLAnchorElement>) => {
    const touch = e.touches[0];
    if (touch) updateFromPoint(touch.clientX, touch.clientY);
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0, px: 0.5, py: 0.5 });
    setHovered(false);
    setTrailerKey(null); // unmount the iframe: no hidden audio/GPU left behind
    stopTrailerTimer();
  };

  return (
    <Link
      ref={cardRef}
      href={catalogHref(item)}
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onTouchStart={() => setHovered(true)}
      onTouchEnd={handleMouseLeave}
      onMouseEnter={() => { setHovered(true); maybeStartTrailer(); }}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: hovered
          ? `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateZ(22px) scale3d(1.05, 1.05, 1.05)`
          : 'perspective(800px) rotateX(0deg) rotateY(0deg) translateZ(0px) scale3d(1, 1, 1)',
        transformStyle: 'preserve-3d',
        transition: hovered
          ? 'transform 0.08s ease-out, box-shadow 0.3s ease-out'
          : 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.6s ease-out',
        boxShadow: hovered
          ? `${-tilt.y * 2.2}px ${(16 - tilt.x) * 1.4}px 45px -8px rgba(0, 0, 0, 0.85), 0 0 32px rgba(245, 158, 11, 0.35)`
          : undefined,
      }}
      className="card-zoom spatial-tilt group/card block relative rounded-2xl overflow-hidden bg-surface-light border border-white/10 shadow-glass-card hover:border-amber-primary/50"
    >
      <div className="relative aspect-[2/3] w-full bg-surface-container">
        {item.poster ? (
          <>
          <img
            src={item.poster.replace('/w500/', '/w92/')}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full scale-110 object-cover blur-xl"
          />
          <Image
            src={item.poster}
            alt={item.title}
            fill
            priority={priority}
            sizes="(max-width: 768px) 45vw, (max-width: 1200px) 22vw, 260px"
            className="poster-img object-cover transition-transform duration-500"
          />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center px-3 text-center text-body-sm text-cinema-subtle">
            {item.title}
          </div>
        )}

        {/* Muted trailer preview replaces the poster while hovered */}
        {hovered && trailerKey && (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${trailerKey}?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&iv_load_policy=3&rel=0&playsinline=1&loop=1&playlist=${trailerKey}`}
            title="Trailer"
            allow="autoplay; encrypted-media"
            // 140% and centered: YouTube's logo (bottom-right), title chip and
            // control chrome all sit in the outer 20% band of the player, so
            // the crop hides them — the card shows only the moving picture.
            // pointer-events=none keeps hover OFF the player, so no overlay
            // UI (or "Watch on YouTube") can ever appear.
            className="pointer-events-none absolute left-1/2 top-1/2 z-[1] h-[175%] w-[175%] -translate-x-1/2 -translate-y-1/2 border-0"
            tabIndex={-1}
            loading="lazy"
          />
        )}
        {/* Corner mask: the YouTube watermark zone sinks into darkness even
            if a logo frame slips through the crop. */}
        {hovered && trailerKey && (
          <div className="pointer-events-none absolute inset-0 z-[2] bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.75)_100%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d0e11] via-[#0d0e11]/25 to-transparent opacity-85 transition-opacity duration-300 group-hover/card:opacity-100" />
        <div className="spatial-sheen" />
        {/* Cursor-tracking glare: the most visible spatial cue */}
        <div
          className="pointer-events-none absolute inset-0 transition-opacity duration-300"
          style={{
            opacity: hovered ? 1 : 0,
            background: `radial-gradient(circle at ${tilt.px * 100}% ${tilt.py * 100}%, rgba(255, 255, 255, 0.28) 0%, rgba(255, 193, 116, 0.12) 28%, transparent 55%)`,
          }}
        />

        <span className="spatial-float-pill absolute left-2 top-2 rounded-lg bg-black/60 px-2 py-0.5 font-mono text-label-sm uppercase text-cinema-text backdrop-blur-md border border-white/10">
          {item.mediaType === 'tv' ? 'Phim bộ' : 'Phim lẻ'}
        </span>

        {rating && (
          <span className="spatial-float-pill absolute right-2 top-2 flex items-center gap-1 rounded-lg bg-black/60 px-2 py-0.5 font-mono text-badge-numeric text-amber-gold backdrop-blur-md border border-amber-primary/30">
            <Star size={10} fill="currentColor" />
            {rating}
          </span>
        )}

        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover/card:opacity-100">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-primary/90 shadow-amber-glow">
            <PlayCircle size={32} className="text-black" />
          </span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-3">
          <h3 className="font-syne line-clamp-2 text-headline-sm text-white drop-shadow">
            {item.title}
          </h3>
          <div className="mt-1 flex items-center gap-2 font-mono text-label-sm text-cinema-muted">
            {item.year && <span>{item.year}</span>}
            {item.genres.length > 0 && (
              <span className="line-clamp-1 text-cinema-subtle normal-case">{item.genres.slice(0, 2).join(' · ')}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
