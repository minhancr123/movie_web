'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PlayCircle, Star } from 'lucide-react';
import { CatalogItem, catalogHref } from '@/lib/catalog';

interface CatalogCardProps {
  item: CatalogItem;
  priority?: boolean;
}

/**
 * Card for a TMDB catalog entry.
 *
 * Deliberately has no hover video preview: the old MovieCard streamed a phimapi
 * m3u8 on hover, and TMDB has no playable source. Previews can come back in
 * Phase 2 once a debrid session can be opened cheaply.
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
  };

  return (
    <Link
      ref={cardRef}
      href={catalogHref(item)}
      onMouseMove={handleMouseMove}
      onTouchMove={handleTouchMove}
      onTouchStart={() => setHovered(true)}
      onTouchEnd={handleMouseLeave}
      onMouseEnter={() => setHovered(true)}
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
          <Image
            src={item.poster}
            alt={item.title}
            fill
            priority={priority}
            sizes="(max-width: 768px) 45vw, (max-width: 1200px) 22vw, 260px"
            className="poster-img object-cover transition-transform duration-500"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center px-3 text-center text-body-sm text-cinema-subtle">
            {item.title}
          </div>
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
