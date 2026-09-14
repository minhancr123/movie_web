import Link from 'next/link';
import Image from 'next/image';
import { Calendar, Star } from 'lucide-react';
import { discoverCatalog, catalogHref } from '@/lib/catalog';

export const metadata = {
  title: 'Phim mới ra mắt',
};

/**
 * Previously a fake "TV schedule" built from phimapi's latest-updated list, with
 * a hardcoded 20:00 slot and a hardcoded 8.5 rating on every row. TMDB has no
 * broadcast schedule, so this now honestly shows this year's releases, newest
 * first, with real ratings.
 */
export default async function SchedulePage() {
  const year = new Date().getFullYear();
  const [movies, shows] = await Promise.all([
    discoverCatalog({ type: 'movie', year, page: 1 }),
    discoverCatalog({ type: 'tv', year, page: 1 }),
  ]);

  const rows = [...movies.items, ...shows.items]
    .sort((a, b) => b.voteAverage - a.voteAverage)
    .slice(0, 20);

  return (
    <div className="py-8">
      <div className="mb-8 flex items-center gap-4">
        <div className="rounded-xl bg-primary p-3 shadow-glow">
          <Calendar size={30} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold uppercase tracking-wide text-white md:text-3xl">
            Phim mới ra mắt
          </h1>
          <p className="text-sm text-cinema-subtle">Phim lẻ và phim bộ phát hành năm {year}</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="py-16 text-center text-cinema-subtle">Chưa lấy được danh sách phát hành.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((item) => (
            <Link
              key={item.contentRef}
              href={catalogHref(item)}
              className="group flex items-center gap-4 rounded-xl border border-white/5 bg-white/5 p-3 transition-colors hover:bg-white/10"
            >
              <div className="relative h-[84px] w-[56px] shrink-0 overflow-hidden rounded-lg bg-surface-container">
                {item.poster && (
                  <Image src={item.poster} alt={item.title} fill sizes="56px" className="object-cover" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="truncate font-bold text-white transition-colors group-hover:text-primary">
                  {item.title}
                </h3>
                {item.originalTitle && item.originalTitle !== item.title && (
                  <p className="mb-1 truncate text-xs text-cinema-subtle">{item.originalTitle}</p>
                )}
                <div className="flex items-center gap-2 text-[11px] text-cinema-subtle">
                  <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-primary">
                    {item.mediaType === 'tv' ? 'Phim bộ' : 'Phim lẻ'}
                  </span>
                  {item.year && <span>{item.year}</span>}
                  {item.voteAverage > 0 && (
                    <span className="flex items-center gap-1">
                      <Star size={10} className="text-amber-gold" fill="currentColor" />
                      {item.voteAverage.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>

              <span className="shrink-0 rounded-lg bg-white px-4 py-2 text-xs font-bold text-black transition-colors group-hover:bg-primary group-hover:text-white">
                Xem ngay
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
