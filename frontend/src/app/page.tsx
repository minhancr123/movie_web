import { Suspense } from 'react';
import { getLatestMovies, getMoviesByCategory } from '@/lib/api';
import MovieCard from '@/components/MovieCard';
import HeroSection from '@/components/HeroSection';
import Pagination from '@/components/Pagination';
import MovieRow from '@/components/MovieRow';
import AsyncMovieRow from '@/components/AsyncMovieRow';
import ContinueWatchingRow from '@/components/ContinueWatchingRow';
import IntroAnimation from '@/components/IntroAnimation'; // Import Intro

export default async function Home({ searchParams }: { searchParams: { page?: string } }) {
  const currentPage = Number(searchParams.page) || 1;
  const page = currentPage; // alias

  // Fetch Data concurrently (Only critical data for Hero + Main List)
  // 1. Latest movies (paginated)
  const latestDataPromise = getLatestMovies(page);

  // 2. Categories for rows (Only fetch on page 1 to save resources, or fetch always if you want rows on every page)
  // Let's only show Feature Rows on Page 1
  const isFirstPage = page === 1;

  // We only wait for Hero data (Phim Chieu Rap) and Main Content (Latest)
  const [latestData, phimChieuRapData] = await Promise.all([
    latestDataPromise,
    isFirstPage ? getMoviesByCategory('phim-chieu-rap', 1) : Promise.resolve(null),
  ]);

  const movies = latestData.items || [];
  const pagination = latestData.pagination || {};
  const totalPages = Math.ceil((pagination.totalItems || 1000) / (pagination.totalItemsPerPage || 10));

  // Pick top 6 movies for slider - Prioritize Phim Chieu Rap if available
  const heroMovies = (phimChieuRapData?.data?.items?.length > 0)
    ? phimChieuRapData.data.items.slice(0, 6)
    : movies.slice(0, 6);

  // Skeleton for loading rows
  const RowSkeleton = () => (
    <div className="mb-12 w-full animate-pulse">
      <div className="h-8 w-48 bg-gray-800 rounded mb-6"></div>
      <div className="flex gap-4 overflow-hidden">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="min-w-[160px] md:min-w-[220px] h-[300px] bg-gray-900 rounded-xl"></div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="pb-8">
      {/* Intro Animation - Only runs once per session */}
      <IntroAnimation />

      {/* Show Hero only on first page */}
      {isFirstPage && heroMovies.length > 0 && <HeroSection movies={heroMovies} />}

      {/* Show Continue Watching only on first page */}
      {isFirstPage && <ContinueWatchingRow />}

      <div className="mt-8 mb-6">
        <h1 className="text-xl md:text-2xl font-bold text-white border-l-4 border-red-600 pl-3 uppercase tracking-wide">
          Phim Mới Cập Nhật {page > 1 ? `- Trang ${page}` : ''}
        </h1>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
        {movies.map((movie: any) => (
          <MovieCard key={movie._id} movie={movie} />
        ))}
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages > 100 ? 100 : totalPages}
        path="/"
      />

      {/* Show Featured Rows only on first page, below main list */}
      {isFirstPage && (
        <div className="mt-12 pt-8 space-y-4">
          {/* Reuse data for Phim Chieu Rap since we already fetched it for Hero */}
          {phimChieuRapData?.data?.items && (
            <MovieRow title="Phim Chiếu Rạp" movies={phimChieuRapData.data.items} path="/danh-sach/phim-chieu-rap" />
          )}

          {/* Load other rows progressively with Suspense */}
          <Suspense fallback={<RowSkeleton />}>
            <AsyncMovieRow category="phim-le" title="Phim Lẻ Hot" path="/danh-sach/phim-le" />
          </Suspense>

          <Suspense fallback={<RowSkeleton />}>
            <AsyncMovieRow category="phim-bo" title="Phim Bộ Mới" path="/danh-sach/phim-bo" />
          </Suspense>

          <Suspense fallback={<RowSkeleton />}>
            <AsyncMovieRow category="hoat-hinh" title="Hoạt Hình" path="/danh-sach/hoat-hinh" />
          </Suspense>
        </div>
      )}
    </div>
  );
}
