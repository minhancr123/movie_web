'use client';
import { useSavedMovies } from "@/hooks/useLocalStorage";
import MovieCard from "@/components/MovieCard";

export default function MyListPage() {
    const { savedMovies } = useSavedMovies();

    // Hydration fix: only render after mount on client
    // Next.js might mismatch SSR vs Client here because localStorage is client-only.
    // A simple waittomount approach or "use client" full page is okay.

    if(savedMovies.length === 0) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center">
                <h1 className="text-2xl font-bold mb-4">Danh sách phim yêu thích</h1>
                <p className="text-gray-400">Bạn chưa lưu bộ phim nào cả.</p>
                <p className="text-gray-500 text-sm mt-2">Hãy nhấn vào biểu tượng trái tim trên phim để thêm vào đây.</p>
            </div>
        )
    }

    return (
        <div className="mt-8">
            <h1 className="text-2xl font-bold border-l-4 border-red-600 pl-3 uppercase mb-6">
                Phim Yêu Thích Của Tôi
            </h1>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                {savedMovies.map(movie => (
                    // We need to map SavedMovie structure back to Movie structure slightly if needed.
                    // Assuming they share compatible fields or mapping them
                    <MovieCard key={movie.slug} movie={movie as any} />
                ))}
            </div>
        </div>
    );
}
