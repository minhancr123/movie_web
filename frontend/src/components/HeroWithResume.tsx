'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Play, X } from 'lucide-react';
import { useWatchHistory } from '@/hooks/useLocalStorage';
import PrewarmWatchLink from '@/components/PrewarmWatchLink';
import HeroSection, { type HeroMovie } from '@/components/HeroSection';
import { IMAGE_PREFIX } from '@/lib/api';

/**
 * The home hero the viewer actually wants: what THEY were watching. With a
 * resumable entry in history the trending carousel steps aside; without one
 * it renders untouched. Client-side by necessity (history lives in
 * localStorage); the backdrop/name come from the cached catalog detail.
 */
export default function HeroWithResume({ fallback }: { fallback: HeroMovie[] }) {
  const { history, removeFromHistory } = useWatchHistory();
  const [dismissed, setDismissed] = useState(false);

  const resume = useMemo(() => {
    return history.find((h) => {
      if (!h.tmdbId || !h.mediaType) return false;
      const dur = Number(h.duration) || 0;
      const pos = Number(h.progress) || 0;
      // Finished titles are not "đang xem": below 3% there is nothing to
      // resume into either.
      return dur > 60 && pos > dur * 0.03 && pos < dur * 0.97;
    });
  }, [history]);

  const [detail, setDetail] = useState<{ backdrop: string; title: string; overview: string } | null>(null);
  useEffect(() => {
    if (!resume?.tmdbId || !resume?.mediaType) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/catalog/${resume.mediaType}/${resume.tmdbId}`);
        const json = await res.json();
        const d = json?.data;
        if (!cancelled && d?.backdrop) {
          setDetail({ backdrop: d.backdrop, title: d.title || resume.name, overview: d.overview || '' });
        }
      } catch { /* hero falls back to trending */ }
    })();
    return () => { cancelled = true; };
  }, [resume?.tmdbId, resume?.mediaType]);

  if (!resume || dismissed || !detail) {
    return <HeroSection movies={fallback} />;
  }

  const dur = Number(resume.duration) || 0;
  const pos = Number(resume.progress) || 0;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return h > 0 ? `${h}:${String(m % 60).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
      : `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  };
  const href = `/xem-phim/${resume.slug}${resume.currentEpisode ? `?tap=${resume.currentEpisode}` : ''}`;
  const epLabel = resume.season && resume.currentEpisode
    ? `Mùa ${resume.season} · Tập ${resume.currentEpisode}` : null;

  return (
    <section className="relative mt-2 overflow-hidden rounded-2xl border border-white/5">
      {/* Dải ngang gọn: nổi bật nhưng không nuốt màn hình đầu — hero trending
          nằm ngay dưới vẫn nhìn thấy. Ảnh cover theo chiều cao cố định. */}
      <div className="relative h-[210px] w-full sm:h-[280px] lg:h-[320px]">
        <Image
          src={`${IMAGE_PREFIX}${detail.backdrop}`}
          alt={detail.title}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0d0e11] via-[#0d0e11]/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0d0e11]/80 via-transparent to-transparent" />

        <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-7">
          <div className="flex items-center gap-2">
            <span className="rounded bg-amber-primary px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-black">
              Đang xem
            </span>
            {epLabel && (
              <span className="rounded bg-black/60 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-white/80 backdrop-blur">
                {epLabel}
              </span>
            )}
          </div>
          <h2 className="mt-1.5 max-w-3xl font-syne text-xl font-black leading-tight text-white drop-shadow-lg sm:text-3xl">
            {detail.title}
          </h2>
          <p className="mt-1.5 hidden max-w-xl text-xs leading-relaxed text-white/70 sm:line-clamp-1 md:line-clamp-2">{detail.overview}</p>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <PrewarmWatchLink
              type={resume.mediaType as string}
              tmdbId={resume.tmdbId as number}
              season={resume.season ?? null}
              episode={Number(resume.currentEpisode) > 0 ? Number(resume.currentEpisode) : null}
              href={href}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-primary px-5 py-2.5 text-sm font-bold text-black shadow-lg shadow-amber-primary/30 transition-all hover:bg-amber-gold"
            >
              <Play size={18} fill="currentColor" />
              Tiếp tục từ {fmt(pos)}
            </PrewarmWatchLink>
            <span className="font-mono text-xs text-white/50">còn {fmt(Math.max(0, dur - pos))}</span>
            <button
              onClick={() => { setDismissed(true); }}
              aria-label="Ẩn gợi ý xem tiếp"
              className="ml-1 rounded-full p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          <div className="mt-3 h-1 w-full max-w-xl overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-amber-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
