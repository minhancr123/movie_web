import { getMoviesByCategory } from '@/lib/api';
import MovieCard from '@/components/MovieCard';
import Pagination from '@/components/Pagination';

const CATEGORY_NAMES: Record<string, string> = {
    'phim-le': 'Phim Lẻ',
    'phim-bo': 'Phim Bộ',
    'hoat-hinh': 'Hoạt Hình',
    'tv-shows': 'TV Shows'
};

export default async function CategoryPage({ 
    params,
    searchParams 
}: { 
    params: { category: string },
    searchParams: { page?: string } 
}) {
  const categorySlug = params.category;
  const currentPage = Number(searchParams.page) || 1;
  
  const data = await getMoviesByCategory(categorySlug, currentPage);

  // Safely extract data
  // The API might return { data: { items: [...] } } or just { items: [...] } depending on version
  const movies = data?.data?.items || data?.items || [];
  const pagination = data?.data?.params?.pagination || data?.pagination || {};
  
  const totalItems = pagination.totalItems || 0;
  const itemsPerPage = pagination.totalItemsPerPage || 24;
  
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  
  // Clean up category name display
  const rawName = CATEGORY_NAMES[categorySlug] || categorySlug;
  const categoryName = rawName.replace(/-/g, ' ');

  return (
    <div className="pt-24 pb-12 min-h-screen">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mb-8 flex items-end justify-between border-b border-gray-800 pb-4">
            <div>
                <h1 className="text-3xl font-bold border-l-4 border-red-600 pl-4 uppercase leading-none">
                    {categoryName}
                </h1>
                <p className="text-gray-400 mt-2 pl-5 text-sm">
                    Danh sách {categoryName} mới cập nhật - Trang {currentPage}
                </p>
            </div>
            
            <div className="hidden md:block text-xs text-gray-500 font-mono">
                Hiển thị {movies.length} kết quả
            </div>
        </div>
        
        {movies.length > 0 ? (
            <>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
                    {movies.map((movie: any) => (
                    <MovieCard key={movie._id} movie={movie} />
                    ))}
                </div>
                
                <div className="mt-12 flex justify-center">
                    <Pagination 
                        currentPage={currentPage} 
                        totalPages={totalPages > 100 ? 100 : totalPages} 
                        path={`/danh-sach/${categorySlug}`}
                    />
                </div>
            </>
        ) : (
            <div className="flex flex-col items-center justify-center py-32 bg-gray-900/30 rounded-xl border border-gray-800/50">
                <div className="text-6xl mb-4 opacity-20">🎬</div>
                <h3 className="text-xl font-bold text-gray-400 mb-2">Chưa có phim nào</h3>
                <p className="text-gray-600 text-sm">Danh mục này hiện đang được cập nhật. Vui lòng quay lại sau.</p>
            </div>
        )}
      </div>
    </div>
  );
}
