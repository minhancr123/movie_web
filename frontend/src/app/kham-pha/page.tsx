import Link from 'next/link';
import { Filter } from 'lucide-react';
import { discoverCatalog, getGenres, type MediaType } from '@/lib/catalog';
import CatalogCard from '@/components/CatalogCard';

export const metadata = {
  title: 'Khám phá phim',
};

interface DiscoverPageProps {
  searchParams: { type?: string; genre?: string; year?: string; region?: string; page?: string };
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 15 }, (_, i) => CURRENT_YEAR - i);

// TMDB filters by ISO-3166-1 origin country, not by the old phimapi slugs.
const REGIONS = [
  { code: 'KR', name: 'Hàn Quốc' },
  { code: 'CN', name: 'Trung Quốc' },
  { code: 'US', name: 'Mỹ' },
  { code: 'VN', name: 'Việt Nam' },
  { code: 'JP', name: 'Nhật Bản' },
  { code: 'TH', name: 'Thái Lan' },
];

export default async function DiscoverPage({ searchParams }: DiscoverPageProps) {
  const type: MediaType = searchParams.type === 'tv' ? 'tv' : 'movie';
  const genre = searchParams.genre || '';
  const year = searchParams.year || '';
  const region = searchParams.region || '';
  const page = Number(searchParams.page) || 1;

  const [{ genres }, { items, pagination }] = await Promise.all([
    getGenres(type),
    discoverCatalog({ type, genre, year, region, page }),
  ]);

  // Build a URL that keeps the other filters and resets paging.
  const withParam = (key: string, value: string) => {
    const next = new URLSearchParams({ type, genre, year, region });
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'type') next.set('type', type);
    Array.from(next.entries()).forEach(([k, v]) => {
      if (!v) next.delete(k);
    });
    return `/kham-pha?${next.toString()}`;
  };

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
      active ? 'bg-primary text-white' : 'bg-white/5 text-cinema-muted hover:bg-white/10'
    }`;

  return (
    <div className="py-8">
      <h1 className="mb-6 flex items-center gap-2 border-l-4 border-primary pl-3 text-2xl font-bold text-white text-glow">
        <Filter size={22} /> Khám phá
      </h1>

      <div className="mb-8 space-y-4 rounded-xl border border-white/5 bg-white/5 p-5">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-cinema-subtle">Loại</p>
          <div className="flex flex-wrap gap-2">
            <Link href={withParam('type', 'movie')} className={chip(type === 'movie')}>
              Phim lẻ
            </Link>
            <Link href={withParam('type', 'tv')} className={chip(type === 'tv')}>
              Phim bộ
            </Link>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-cinema-subtle">Thể loại</p>
          <div className="flex flex-wrap gap-2">
            <Link href={withParam('genre', '')} className={chip(!genre)}>
              Tất cả
            </Link>
            {genres.map((g) => (
              <Link
                key={g.id}
                href={withParam('genre', String(g.id))}
                className={chip(genre === String(g.id))}
              >
                {g.name}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-cinema-subtle">Quốc gia</p>
          <div className="flex flex-wrap gap-2">
            <Link href={withParam('region', '')} className={chip(!region)}>
              Tất cả
            </Link>
            {REGIONS.map((r) => (
              <Link key={r.code} href={withParam('region', r.code)} className={chip(region === r.code)}>
                {r.name}
              </Link>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-cinema-subtle">Năm</p>
          <div className="flex flex-wrap gap-2">
            <Link href={withParam('year', '')} className={chip(!year)}>
              Tất cả
            </Link>
            {YEARS.map((y) => (
              <Link key={y} href={withParam('year', String(y))} className={chip(year === String(y))}>
                {y}
              </Link>
            ))}
          </div>
        </div>
      </div>

      {items.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5 md:gap-6">
            {items.map((item) => (
              <CatalogCard key={item.contentRef} item={item} />
            ))}
          </div>

          {pagination.totalPages > 1 && (
            <div className="mt-10 flex items-center justify-center gap-3">
              {page > 1 && (
                <Link
                  href={`${withParam('page', '')}&page=${page - 1}`}
                  className="rounded-lg glass-button px-4 py-2 text-sm font-semibold text-white"
                >
                  Trang trước
                </Link>
              )}
              <span className="text-sm text-cinema-subtle">
                Trang {pagination.currentPage} / {pagination.totalPages}
              </span>
              {page < pagination.totalPages && (
                <Link
                  href={`${withParam('page', '')}&page=${page + 1}`}
                  className="rounded-lg glass-button px-4 py-2 text-sm font-semibold text-white"
                >
                  Trang sau
                </Link>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="py-16 text-center text-cinema-subtle">Không có phim nào khớp bộ lọc này.</p>
      )}
    </div>
  );
}
