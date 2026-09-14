'use client';

import { useSavedMovies } from '@/hooks/useLocalStorage';
import CatalogCard from '@/components/CatalogCard';
import { fromStoredRecord, type CatalogItem } from '@/lib/catalog';

/**
 * Guest ("not signed in") favourites, kept in localStorage by SaveButton.
 * Entries save the contentRef as their id, so they map onto a CatalogItem the
 * same way server-side favourites do.
 */
export default function MyListPage() {
  const { savedMovies } = useSavedMovies();

  const items = savedMovies
    .map((saved: any) =>
      fromStoredRecord({
        contentRef: saved.id,
        movieData: {
          name: saved.name,
          originName: saved.origin_name,
          posterUrl: saved.poster_url,
        },
      })
    )
    .filter((item: CatalogItem | null): item is CatalogItem => item !== null);

  if (items.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="mb-4 text-2xl font-bold text-white">Danh sách phim yêu thích</h1>
        <p className="text-cinema-subtle">Bạn chưa lưu bộ phim nào cả.</p>
        <p className="mt-2 text-sm text-cinema-subtle">
          Hãy nhấn vào biểu tượng trái tim trên phim để thêm vào đây.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h1 className="mb-6 border-l-4 border-primary pl-3 text-2xl font-bold uppercase text-white text-glow">
        Phim yêu thích của tôi
      </h1>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5 md:gap-6">
        {items.map((item) => (
          <CatalogCard key={item.contentRef} item={item} />
        ))}
      </div>
    </div>
  );
}
