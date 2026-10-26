import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ArrowLeft, ListVideo } from 'lucide-react';
import {
  getCatalogDetail,
  getSeason,
  catalogHref,
  watchHref,
  type MediaType,
  type PlayerEpisode,
} from '@/lib/catalog';
import PlaybackSection from '@/components/PlaybackSection';
import SeasonPicker from '@/components/SeasonPicker';
import { nextSeasonNumber } from '@/lib/season-navigation';
import RecommendationsRow from '@/components/RecommendationsRow';
import SpatialShader from '@/components/SpatialShader';
import WatchEpisodeLabel from '@/components/WatchEpisodeLabel';
import { Suspense } from 'react';

// No route-level revalidate: each fetch in lib/catalog.ts sets its own, and a
// page-level value makes Next 14 treat this route as ISR-cacheable, which
// swallows the status code from notFound() / redirect().

interface PageParams {
  params: Promise<{ type: string; tmdbId: string; slug: string }>;
  searchParams: Promise<{ s?: string; e?: string; restart?: string }>;
}

const parseType = (type: string): MediaType | null =>
  type === 'movie' || type === 'tv' ? type : null;

/**
 * Trang xem là nội dung mỏng, trùng với trang /phim/* và cần query ?s=&e=
 * mới đủ nghĩa. Chặn index để Google dồn ranking về trang chi tiết,
 * canonical cũng trỏ về đó.
 */
export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const resolvedParams = await params;
  const type = parseType(resolvedParams.type);
  if (!type) return { robots: { index: false, follow: false } };
  const tmdbId = Number(resolvedParams.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0)
    return { robots: { index: false, follow: false } };
  try {
    const detail = await getCatalogDetail(type, tmdbId);
    if (!detail)
      return { title: 'Xem phim', robots: { index: false, follow: false } };
    return {
      title: `Xem ${detail.title} - CineVN`,
      description: `Xem ${detail.title}${detail.year ? ` (${detail.year})` : ''} Vietsub chất lượng cao.`,
      robots: { index: false, follow: true },
      alternates: { canonical: catalogHref(detail) },
    };
  } catch {
    return { robots: { index: false, follow: false } };
  }
}

/**
 * Watch page wired to the Phase 2 playback API.
 *
 * Server part resolves the catalog identity (type/tmdbId) plus the season
 * episode list for TV; all source resolution, capability probing, and HLS
 * playback happen client-side in PlaybackSection against
 * POST /api/playback/resolve.
 */
export default async function WatchPage({ params, searchParams }: PageParams) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const type = parseType(resolvedParams.type);
  if (!type) notFound();

  const tmdbId = Number(resolvedParams.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) notFound();

  const detail = await getCatalogDetail(type, tmdbId);
  if (!detail) notFound();

  const season = Number(resolvedSearchParams.s) || null;
  const episode = Number(resolvedSearchParams.e) || null;
  const missingEpisode = type === 'tv' && (!season || !episode);

  // Pro episodes panel data (Stitch player-4k-pro layout): resolved on the
  // server so the panel renders with real stills/titles, no extra client fetch.
  let episodes: PlayerEpisode[] = [];
  let seasonName = '';
  if (type === 'tv' && season) {
    try {
      const seasonData = await getSeason(tmdbId, season);
      if (seasonData) {
        seasonName = seasonData.name || `Mùa ${season}`;
        episodes = (seasonData.episodes || []).map((ep) => ({
          episodeNumber: ep.episodeNumber,
          airDate: ep.airDate,
          name: ep.name,
          overview: ep.overview,
          still: ep.still,
          href: watchHref(detail, season, ep.episodeNumber),
        }));
      }
    } catch {
      episodes = [];
    }
  }

  const seasonOptions = (detail.seasons || []).filter(item => item.seasonNumber > 0 && item.episodeCount > 0)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .map(item => ({ seasonNumber: item.seasonNumber, episodeCount: item.episodeCount,
      href: watchHref(detail, item.seasonNumber, 1) }));
  const followingSeason = nextSeasonNumber(seasonOptions, season);
  const nextSeason = seasonOptions.find(item => item.seasonNumber === followingSeason) || null;

  return (
    <div className="relative mx-auto -mt-8 max-w-5xl overflow-x-clip px-4 pb-8 pt-8">
      {/* Realtime WebGL cinematic shader background (Stitch player pro) */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-60">
        <SpatialShader opacity={1} speed={1.4} />
      </div>

      <div className="relative z-10">
        {/* 1. TOP STATUS / NAVIGATION BAR (Stitch pro) */}
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={catalogHref(detail)}
              aria-label="Quay lại trang phim"
              className="glass-button flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-cinema-text transition-colors hover:text-amber-gold"
            >
              <ArrowLeft size={18} />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center rounded bg-amber-primary/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-gold ring-1 ring-amber-primary/30">
                  4K HDR
                </span>
                <span className="inline-flex items-center rounded bg-cyan-accent/10 px-2 py-0.5 font-mono text-[10px] font-bold text-cyan-accent ring-1 ring-cyan-accent/30">
                  VISIONOS
                </span>
              </div>
              <h1 className="movie-title mt-2 text-xl text-white md:text-2xl lg:text-3xl">
                {detail.title}
              </h1>
              {type === 'tv' && season && episode ? (
                <Suspense fallback={<p className="mt-0.5 font-mono text-label-md uppercase text-amber-gold">Mùa {season}, tập {episode}</p>}>
                  <WatchEpisodeLabel season={season} episode={episode} />
                </Suspense>
              ) : (
                detail.year && (
                  <p className="mt-0.5 font-mono text-label-md uppercase text-cinema-subtle">
                    {detail.year}
                  </p>
                )
              )}
            </div>
          </div>
          {type === 'tv' && episodes.length > 0 && (
            <a
              href="#episodes"
              className="glass-button hidden shrink-0 items-center gap-1.5 rounded-full px-4 py-2 font-mono text-label-md uppercase text-cinema-text transition-colors hover:text-amber-gold sm:inline-flex"
            >
              <ListVideo size={16} />
              Danh sách tập
            </a>
          )}
        </div>

        {missingEpisode ? (
          <section id="episodes" className="glass-panel rounded-2xl p-5 shadow-glass-card">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-white">{season ? `Mùa ${season} · Chọn tập để xem` : 'Chọn mùa và tập để xem'}</h2>
                <p className="mt-1 text-sm text-cinema-subtle">Phim chỉ bắt đầu phát sau khi bạn chọn một tập.</p>
              </div>
              <SeasonPicker seasons={seasonOptions} current={season} />
            </div>
            {episodes.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {episodes.map(ep => <Link key={ep.episodeNumber} href={ep.href}
                  className="overflow-hidden rounded-xl border border-white/10 bg-white/5 transition hover:border-amber-primary/60 hover:bg-amber-primary/10">
                  <div className="relative aspect-video bg-black/30">
                    {ep.still && <Image src={ep.still} alt={ep.name} fill sizes="(max-width: 640px) 45vw, 240px" className="object-cover" />}
                    <span className="absolute bottom-2 left-2 rounded bg-black/75 px-2 py-1 text-xs font-bold text-white">Tập {ep.episodeNumber}</span>
                  </div>
                  <div className="p-3"><p className="line-clamp-2 text-sm font-semibold text-white">{ep.name || `Tập ${ep.episodeNumber}`}</p></div>
                </Link>)}
              </div>
            ) : <p className="py-6 text-sm text-cinema-subtle">{season ? 'Chưa tải được danh sách tập của mùa này. Bạn thử tải lại hoặc chọn mùa khác.' : 'Chọn một mùa để xem danh sách tập.'}</p>}
          </section>
        ) : (
          <PlaybackSection
            key={`${type}:${tmdbId}:s${season}`}
            seasons={seasonOptions}
            nextSeason={nextSeason}
            startFromBeginning={resolvedSearchParams.restart === '1'}
            type={type}
            tmdbId={tmdbId}
            season={season}
            episode={episode}
            title={detail.title}
            contentRef={detail.contentRef}
            poster={detail.poster}
            runtimeMinutes={detail.runtime}
            episodes={episodes}
            activeEpisode={episode}
            seasonLabel={seasonName || (season ? `Mùa ${season}` : '')}
          />
        )}

        <div className="mt-12">
          <RecommendationsRow 
            type={type} 
            tmdbId={tmdbId} 
            title="Nội dung tương tự" 
          />
        </div>

        <Link
          href={catalogHref(detail)}
          className="mt-6 inline-flex items-center gap-2 font-mono text-label-md uppercase text-cinema-subtle transition-colors hover:text-amber-gold"
        >
          <ArrowLeft size={16} />
          Quay lại trang phim
        </Link>
      </div>
    </div>
  );
}
