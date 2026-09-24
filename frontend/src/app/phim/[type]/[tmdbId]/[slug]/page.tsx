import Image from 'next/image';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Play, Calendar, Clock, Star, Users, Video, MessageSquare } from 'lucide-react';
import {
  getCatalogDetail,
  getSeason,
  catalogHref,
  watchHref,
  type MediaType,
} from '@/lib/catalog';
import SaveButton from '@/components/SaveButton';
import PrewarmWatchLink from '@/components/PrewarmWatchLink';
import ViewCounter from '@/components/ViewCounter';
import CommentsSection from '@/components/CommentsSection';

// No route-level revalidate: each fetch in lib/catalog.ts sets its own, and a
// page-level value makes Next 14 treat this route as ISR-cacheable, which
// swallows the status code from notFound() / redirect().

interface PageParams {
  params: Promise<{ type: string; tmdbId: string; slug: string }>;
  searchParams: Promise<{ season?: string }>;
}

const parseType = (type: string): MediaType | null =>
  type === 'movie' || type === 'tv' ? type : null;

export async function generateMetadata({ params }: PageParams): Promise<Metadata> {
  const resolvedParams = await params;
  const type = parseType(resolvedParams.type);
  if (!type) return { title: 'Không tìm thấy' };

  const detail = await getCatalogDetail(type, resolvedParams.tmdbId);
  if (!detail) return { title: 'Không tìm thấy phim' };

  const description =
    detail.overview.slice(0, 155) || `Xem ${detail.title} (${detail.year ?? ''}) chất lượng cao.`;

  return {
    title: `${detail.title}${detail.year ? ` (${detail.year})` : ''} - Xem phim`,
    description,
    openGraph: {
      title: detail.title,
      description,
      images: detail.backdrop ? [detail.backdrop] : detail.poster ? [detail.poster] : [],
    },
  };
}

export default async function CatalogDetailPage({ params, searchParams }: PageParams) {
  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const type = parseType(resolvedParams.type);
  if (!type) notFound();

  const detail = await getCatalogDetail(type, resolvedParams.tmdbId);
  if (!detail) notFound();

  // Slug is decorative, but keep the canonical one in the address bar for SEO.
  if (resolvedParams.slug !== detail.slug) {
    redirect(catalogHref(detail));
  }

  const seasons = detail.seasons ?? [];
  const activeSeasonNumber = Number(resolvedSearchParams.season) || seasons[0]?.seasonNumber;
  const season =
    type === 'tv' && activeSeasonNumber
      ? await getSeason(detail.tmdbId, activeSeasonNumber)
      : null;

  // SaveButton still accepts the legacy shape for its guest/localStorage path.
  const legacyMovie = {
    _id: detail.contentRef,
    slug: detail.slug,
    name: detail.title,
    origin_name: detail.originalTitle,
    poster_url: detail.poster,
  };

  const firstEpisode = season?.episodes[0];

  return (
    <div className="pb-16">
      <div className="relative -mx-4 mb-8 h-[38vh] md:h-[55vh] overflow-hidden md:-mx-8">
        {detail.backdrop && (
          <Image
            src={detail.backdrop}
            alt={detail.title}
            fill
            priority
            sizes="100vw"
            className="object-cover object-top"
          />
        )}
        <div className="hero-vignette absolute inset-0" />
      </div>

      <div className="spatial-stage relative z-10 -mt-32 grid gap-8 md:-mt-48 md:grid-cols-[260px_1fr]">
        <div className="mx-auto w-40 md:mx-0 md:w-full">
          <div className="spatial-tilt relative aspect-[2/3] overflow-hidden rounded-2xl border border-white/10 shadow-glass-card">
            {detail.poster && (
              <Image
                src={detail.poster}
                alt={detail.title}
                fill
                sizes="260px"
                className="object-cover"
              />
            )}
          </div>
        </div>

        <div>
          <h1 className="font-syne text-display-hero-mobile text-white md:text-display-hero">
            {detail.title}
          </h1>
          {detail.originalTitle && detail.originalTitle !== detail.title && (
            <p className="mt-1 font-mono text-label-lg uppercase text-cinema-subtle">
              {detail.originalTitle}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <PrewarmWatchLink
              type={detail.mediaType}
              tmdbId={detail.tmdbId}
              season={season?.seasonNumber ?? null}
              episode={firstEpisode?.episodeNumber ?? null}
              href={watchHref(detail, season?.seasonNumber, firstEpisode?.episodeNumber)}
              className="group/btn flex items-center gap-2 rounded-full bg-amber-primary px-6 py-3 font-mono text-label-lg uppercase text-surface-dark shadow-amber-button transition-all hover:-translate-y-1 hover:bg-amber-gold"
            >
              <div className="rounded-full bg-surface-dark p-1.5 transition-transform group-hover/btn:scale-110">
                <Play fill="currentColor" className="h-4 w-4 text-amber-gold" />
              </div>
              Xem ngay
            </PrewarmWatchLink>
            <SaveButton movie={legacyMovie} item={detail} />
            <ViewCounter contentId={detail.contentRef} />
          </div>

          <div className="mt-5 flex flex-wrap gap-4 text-sm text-cinema-muted">
            {detail.year && (
              <span className="flex items-center gap-2">
                <Calendar size={16} className="text-amber-gold" />
                {detail.year}
              </span>
            )}
            {detail.runtime && (
              <span className="flex items-center gap-2">
                <Clock size={16} className="text-amber-gold" />
                {detail.runtime} phút
              </span>
            )}
            {detail.voteAverage > 0 && (
              <span className="flex items-center gap-2">
                <Star size={16} className="text-amber-gold" fill="currentColor" />
                {detail.voteAverage.toFixed(1)}
              </span>
            )}
            {detail.status && <span className="text-cinema-subtle">{detail.status}</span>}
          </div>

          {detail.genres.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {detail.genres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-label-md uppercase text-cinema-text"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}

          {detail.overview && (
            <p className="mt-6 max-w-3xl leading-relaxed text-cinema-muted">{detail.overview}</p>
          )}

          {detail.directors.length > 0 && (
            <p className="mt-5 text-sm text-cinema-subtle">
              <span className="inline-flex items-center gap-1.5 font-semibold text-cinema-text">
                <Video size={14} className="text-amber-gold" /> Đạo diễn:
              </span>{' '}
              {detail.directors.join(', ')}
            </p>
          )}
        </div>
      </div>

      {detail.cast.length > 0 && (
        <section className="mt-14">
          <h2 className="mb-5 flex items-center gap-2 border-l-4 border-amber-primary pl-3 font-syne text-headline-lg uppercase text-white">
            <Users size={20} /> Diễn viên
          </h2>
          <div className="flex gap-4 overflow-x-auto pb-3 scrollbar-none">
            {detail.cast.map((person) => {
              const card = (
                <>
                  <div className="relative mx-auto h-[110px] w-[110px] overflow-hidden rounded-full bg-surface-container">
                    {person.profile && (
                      <Image src={person.profile} alt={person.name} fill sizes="110px" className="object-cover" />
                    )}
                  </div>
                  <p className="mt-2 line-clamp-1 text-sm font-semibold text-white group-hover:text-amber-gold">{person.name}</p>
                  <p className="line-clamp-1 text-xs text-cinema-subtle">{person.character}</p>
                </>
              );
              return person.id ? (
                <Link
                  key={`${person.name}-${person.character}`}
                  href={`/dien-vien/${person.id}`}
                  className="group min-w-[110px] text-center transition-transform hover:-translate-y-1"
                >
                  {card}
                </Link>
              ) : (
                <div key={`${person.name}-${person.character}`} className="group min-w-[110px] text-center">
                  {card}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {type === 'tv' && seasons.length > 0 && (
        <section className="mt-14">
          <h2 className="mb-5 border-l-4 border-amber-primary pl-3 font-syne text-headline-lg uppercase text-white">
            Danh sách tập
          </h2>

          <div className="mb-5 flex flex-wrap gap-2">
            {seasons.map((s) => (
              <Link
                key={s.seasonNumber}
                href={`${catalogHref(detail)}?season=${s.seasonNumber}`}
                scroll={false}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  s.seasonNumber === activeSeasonNumber
                    ? 'bg-amber-primary text-surface-dark shadow-amber-button'
                    : 'bg-white/5 text-cinema-muted hover:bg-white/10'
                }`}
              >
                {s.name} <span className="text-xs opacity-70">({s.episodeCount})</span>
              </Link>
            ))}
          </div>

          {season && (
            <div className="grid gap-3 md:grid-cols-2">
              {season.episodes.map((episode) => (
                <Link
                  key={episode.contentRef}
                  href={watchHref(detail, season.seasonNumber, episode.episodeNumber)}
                  className="glass-panel glass-panel-hover flex gap-3 rounded-xl p-3"
                >
                  <div className="relative h-[68px] w-[120px] shrink-0 overflow-hidden rounded-lg bg-surface-container">
                    {episode.still && (
                      <Image
                        src={episode.still}
                        alt={episode.name}
                        fill
                        sizes="120px"
                        className="object-cover"
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">
                      {episode.episodeNumber}. {episode.name}
                    </p>
                    <p className="mt-1 line-clamp-2 text-xs text-cinema-subtle">
                      {episode.overview || 'Chưa có mô tả.'}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="mt-14">
        <h2 className="mb-5 flex items-center gap-2 border-l-4 border-amber-primary pl-3 font-syne text-headline-lg uppercase text-white">
          <MessageSquare size={20} /> Bình luận
        </h2>
        <CommentsSection slug={detail.contentRef} />
      </section>
    </div>
  );
}
