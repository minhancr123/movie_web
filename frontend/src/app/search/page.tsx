import { searchMovies } from '@/lib/api';
import MovieCard from '@/components/MovieCard';
import { redirect } from 'next/navigation';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { keyword?: string };
}) {
  const keyword = searchParams.keyword || '';
  let movies = [];

  if (keyword) {
    const data = await searchMovies(keyword);
    // API structure might vary, adjust if needed based on actual API response
    movies = data?.data?.items || [];
  }

  async function searchAction(formData: FormData) {
    'use server';
    const kw = formData.get('keyword');
    if (kw) {
      redirect(`/search?keyword=${kw}`);
    }
  }

  return (
    <div className="py-8">
       <h1 className="text-2xl font-bold mb-6 border-l-4 border-red-600 pl-3">Tìm kiếm phim</h1>
       
       <form action={searchAction} className="mb-8 flex gap-2 max-w-md">
         <input 
            type="text" 
            name="keyword"
            defaultValue={keyword}
            placeholder="Nhập tên phim..." 
            className="flex-1 p-2 rounded bg-gray-800 border border-gray-700 text-white focus:outline-none focus:border-red-600"
         />
         <button 
            type="submit" 
            className="bg-red-600 text-white px-4 py-2 rounded font-bold hover:bg-red-700"
         >
            Tìm
         </button>
       </form>

       {keyword && (
           <h2 className="text-lg text-gray-400 mb-4">Kết quả cho "{keyword}":</h2>
       )}

       {movies.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {movies.map((movie: any) => (
            <MovieCard key={movie._id} movie={movie} />
            ))}
        </div>
       ) : (
           keyword && <p className="text-gray-500">Không tìm thấy phim nào.</p>
       )}
    </div>
  );
}
