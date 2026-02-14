import { getMoviesByGenre } from '@/lib/api';
import MovieCard from '@/components/MovieCard';
import Pagination from '@/components/Pagination';

const GENRES: Record<string, string> = {
  'hanh-dong': 'Hành Động',
  'tinh-cam': 'Tình Cảm',
  'hai-huoc': 'Hài Hước',
  'co-trang': 'Cổ Trang',
  'tam-ly': 'Tâm Lý',
  'hinh-su': 'Hình Sự',
  'chien-tranh': 'Chiến Tranh',
  'the-thao': 'Thể Thao',
  'vo-thuat': 'Võ Thuật',
  'vien-tuong': 'Viễn Tưởng',
  'phieu-luu': 'Phiêu Lưu',
  'khoa-hoc': 'Khoa Học',
  'kinh-di': 'Kinh Dị',
  'am-nhac': 'Âm Nhạc',
  'than-thoai': 'Thần Thoại',
  'tai-lieu': 'Tài Liệu',
  'gia-dinh': 'Gia Đình',
};

export default async function GenrePage({ 
    params, 
    searchParams 
}: { 
    params: { slug: string },
    searchParams: { page?: string } 
}) {
  const genreSlug = params.slug;
  const currentPage = Number(searchParams.page) || 1;
  const genreName = GENRES[genreSlug] || genreSlug.replace(/-/g, ' ');

  const data = await getMoviesByGenre(genreSlug, currentPage);

  const movies = data?.data?.items || data?.items || [];
  const pagination = data?.data?.params?.pagination || data?.pagination || {};
  
  const totalItems = pagination.totalItems || 0;
  // Default to 24 if invalid
  const totalItemsPerPage = pagination.totalItemsPerPage || 24;
  const totalPages = Math.ceil(totalItems / totalItemsPerPage);

  return (
    <div className="pt-24 pb-12 min-h-screen">
       <div className="container mx-auto px-4 md:px-8">
        <div className="mb-8 flex items-end justify-between border-b border-gray-800 pb-4">
             <div>
                <h1 className="text-3xl font-bold uppercase border-l-4 border-red-600 pl-4 leading-none">
                    Thể Loại: {genreName}
                </h1>
                <p className="text-gray-400 mt-2 pl-5 text-sm">
                    Khám phá {movies.length > 0 ? movies.length : 0} phim {genreName} hấp dẫn
                </p>
             </div>
             
             <div className="hidden md:block">
                  <span className="bg-gray-800 text-xs px-2 py-1 rounded text-red-500 font-bold border border-red-900/30">
                     PAGE {currentPage}
                  </span>
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
                        path={`/the-loai/${genreSlug}`}
                    />
                </div>
            </>
        ) : (
             <div className="flex flex-col items-center justify-center py-32 bg-gray-900/30 rounded-xl border border-gray-800/50">
                <div className="text-6xl mb-4 opacity-20">👻</div>
                <h3 className="text-xl font-bold text-gray-400 mb-2">Không tìm thấy phim</h3>
                <p className="text-gray-600 text-sm">Vui lòng thử lại với thể loại khác.</p>
            </div>
        )}
      </div>
    </div>
  );
}
