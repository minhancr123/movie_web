import Link from 'next/link';
import { notFound } from 'next/navigation';
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
import SpatialShader from '@/components/SpatialShader';

// No route-level revalidate: each fetch in lib/catalog.ts sets its own, and a
// page-level value makes Next 14 treat this route as ISR-cacheable, which
// swallows the status code from notFound() / redirect().

interface PageParams {
  params: { type: string; tmdbId: string; slug: string };
  searchParams: { s?: string; e?: string };
}

const parseType = (type: string): MediaType | null =>
  type === 'movie' || type === 'tv' ? type : null;

/**
 * Watch page wired to the Phase 2 playback API.
 *
 * Server part resolves the catalog identity (type/tmdbId) plus the season
 * episode list for TV; all source resolution, capability probing, and HLS
 * playback happen client-side in PlaybackSection against
 * POST /api/playback/resolve.
 */
export default async function WatchPage({ params, searchParams }: PageParams) {
  const type = parseType(params.type);
  if (!type) notFound();

  const tmdbId = Number(params.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) notFound();

  const detail = await getCatalogDetail(type, tmdbId);
  if (!detail) notFound();

  const season = Number(searchParams.s) || null;
  const episode = Number(searchParams.e) || null;
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
              <h1 className="mt-1 truncate font-syne text-headline-lg text-white md:text-headline-xl">
                {detail.title}
              </h1>
              {type === 'tv' && season && episode ? (
                <p className="mt-0.5 font-mono text-label-md uppercase text-amber-gold">
                  Mùa {season}, tập {episode}
                </p>
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
          <div className="glass-panel rounded-2xl p-8 text-center shadow-glass-card">
            <p className="font-syne text-headline-sm text-white">Chọn tập để xem</p>
            <p className="mx-auto mt-2 max-w-md text-sm text-cinema-subtle">
              Phim bộ cần số mùa/tập để tìm đúng file trên TorBox. Mở trang phim và
              bấm vào tập bạn muốn xem.
            </p>
            <Link
              href={catalogHref(detail)}
              className="glass-button mt-5 inline-flex items-center gap-2 rounded-full px-6 py-3 font-mono text-label-lg uppercase text-white transition-all hover:-translate-y-1"
            >
              <ArrowLeft size={18} />
              Danh sách tập
            </Link>
          </div>
        ) : (
          <PlaybackSection
            type={type}
            tmdbId={tmdbId}
            season={season}
            episode={episode}
            title={detail.title}
            contentRef={detail.contentRef}
            poster={detail.poster}
            episodes={episodes}
            activeEpisode={episode}
            seasonLabel={seasonName || (season ? `Mùa ${season}` : '')}
          />
        )}

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
