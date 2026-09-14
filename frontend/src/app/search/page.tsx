import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Search } from 'lucide-react';
import { searchCatalog } from '@/lib/catalog';
import CatalogCard from '@/components/CatalogCard';

interface SearchPageProps {
  searchParams: { keyword?: string; page?: string };
}

export const metadata = {
  title: 'Tìm kiếm phim',
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const keyword = (searchParams.keyword || '').trim();
  const page = Number(searchParams.page) || 1;

  const { items, pagination } = keyword
    ? await searchCatalog(keyword, page)
    : { items: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0 } };

  async function searchAction(formData: FormData) {
    'use server';
    const kw = String(formData.get('keyword') || '').trim();
    redirect(kw ? `/search?keyword=${encodeURIComponent(kw)}` : '/search');
  }

  const pageHref = (target: number) =>
    `/search?keyword=${encodeURIComponent(keyword)}&page=${target}`;

  return (
    <div className="py-8">
      <h1 className="mb-6 border-l-4 border-primary pl-3 text-2xl font-bold text-white text-glow">
        Tìm kiếm phim
      </h1>

      <form action={searchAction} className="mb-8 flex max-w-xl gap-2">
        <input
          type="text"
          name="keyword"
          defaultValue={keyword}
          placeholder="Nhập tên phim..."
          className="flex-1 rounded-lg border border-white/10 bg-white/5 p-3 text-white placeholder-cinema-subtle focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          className="flex items-center gap-2 rounded-lg bg-primary px-5 py-3 font-bold text-white transition-colors hover:brightness-110"
        >
          <Search size={18} />
          Tìm
        </button>
      </form>

      {keyword && (
        <p className="mb-5 text-cinema-subtle">
          {pagination.totalItems > 0
            ? `${pagination.totalItems.toLocaleString()} kết quả cho “${keyword}”`
            : `Không tìm thấy phim nào cho “${keyword}”`}
        </p>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-5 md:gap-6">
          {items.map((item) => (
            <CatalogCard key={item.contentRef} item={item} />
          ))}
        </div>
      )}

      {pagination.totalPages > 1 && (
        <div className="mt-10 flex items-center justify-center gap-3">
          {page > 1 && (
            <Link
              href={pageHref(page - 1)}
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
              href={pageHref(page + 1)}
              className="rounded-lg glass-button px-4 py-2 text-sm font-semibold text-white"
            >
              Trang sau
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
