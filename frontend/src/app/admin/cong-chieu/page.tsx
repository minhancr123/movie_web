'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { moviesAPI, premiereAPI, IMAGE_PREFIX, Movie } from '@/lib/api';
import Image from 'next/image';
import { Loader2, Calendar, Search, Check, AlertTriangle, ArrowLeft } from 'lucide-react';
import { useDebounce } from '@/hooks/useDebounce';
import { useSearchMovies } from '@/hooks/useSearchMovies';
import Link from 'next/link';

export default function AdminPremierePage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
    const [startTime, setStartTime] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    // Debounce search
    const debouncedSearch = useDebounce(searchQuery, 500);
    const { movies: searchResults, isLoading: isSearching } = useSearchMovies(debouncedSearch);

    // Check admin role
    useEffect(() => {
        if (status === 'loading') return;

        if (status === 'unauthenticated') {
            router.push('/auth/login');
            return;
        }

        // Check if user has admin role (need to extend session type or fetch user profile)
        // For now, let's assume if they are here, we check backend on submit
        // Ideally we fetch user profile first.
        const checkAdmin = async () => {
            try {
                // If session user has role property (we added it to JWT but need to see if next-auth exposes it)
                // If not exposed, we might need to fetch /auth/me
                // For this demo, let's trust the backend to reject non-admins
                setIsLoading(false);
            } catch (error) {
                router.push('/');
            }
        };
        checkAdmin();

    }, [status, router]);

    const handleSelectMovie = (movie: Movie) => {
        setSelectedMovie(movie);
        setSearchQuery(''); // Close search
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);

        if (!selectedMovie || !startTime) {
            setMessage({ type: 'error', text: 'Vui lòng chọn phim và thời gian công chiếu' });
            return;
        }

        setSubmitting(true);
        try {
            const posterUrl = selectedMovie.poster_url
                ? (selectedMovie.poster_url.startsWith('http') ? selectedMovie.poster_url : `${IMAGE_PREFIX}${selectedMovie.poster_url}`)
                : '/icon.svg';
            const thumbUrl = selectedMovie.thumb_url
                ? (selectedMovie.thumb_url.startsWith('http') ? selectedMovie.thumb_url : `${IMAGE_PREFIX}${selectedMovie.thumb_url}`)
                : '/icon.svg';

            await premiereAPI.create({
                movieSlug: selectedMovie.slug,
                name: selectedMovie.name,
                posterUrl,
                thumbUrl,
                startTime: new Date(startTime).toISOString()
            });

            setMessage({ type: 'success', text: 'Tạo sự kiện công chiếu thành công!' });
            setTimeout(() => {
                router.push('/cong-chieu');
            }, 1500);
        } catch (error: any) {
            console.error(error);
            setMessage({
                type: 'error',
                text: error.response?.data?.message || 'Có lỗi xảy ra khi tạo sự kiện'
            });
        } finally {
            setSubmitting(false);
        }
    };

    if (isLoading || status === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
                <Loader2 className="w-8 h-8 text-red-600 animate-spin" />
            </div>
        );
    }

    // Access check (simple frontend check, backend enforces security)
    // In a real app, use a dedicated AdminLayout or HOC
    // const isAdmin = (session?.user as any)?.role === 'admin'; 

    return (
        <div className="min-h-screen bg-[#0a0a0a] pt-24 pb-12">
            <div className="container mx-auto px-4 max-w-2xl">
                <Link href="/profile" className="inline-flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors">
                    <ArrowLeft size={18} /> Quay lại
                </Link>

                <div className="bg-[#111] rounded-2xl border border-gray-800 p-8 shadow-2xl">
                    <div className="flex items-center gap-3 mb-8 pb-6 border-b border-gray-800">
                        <div className="w-10 h-10 rounded-full bg-red-600/20 flex items-center justify-center">
                            <Calendar className="text-red-500" size={20} />
                        </div>
                        <h1 className="text-2xl font-bold text-white">Lên lịch Công Chiếu</h1>
                    </div>

                    {message && (
                        <div className={`p-4 rounded-xl mb-6 flex items-center gap-3 ${message.type === 'success'
                            ? 'bg-green-900/20 text-green-500 border border-green-900/30'
                            : 'bg-red-900/20 text-red-500 border border-red-900/30'
                            }`}>
                            {message.type === 'success' ? <Check size={20} /> : <AlertTriangle size={20} />}
                            <span className="font-medium">{message.text}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Movie Selection */}
                        <div className="relative">
                            <label className="block text-sm font-bold text-gray-400 mb-2">Chọn Phim</label>

                            {!selectedMovie ? (
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Tìm kiếm phim..."
                                        className="w-full bg-black border border-gray-800 rounded-xl py-3 pl-12 pr-4 text-white focus:border-red-500 focus:outline-none"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                    />
                                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" size={18} />

                                    {/* Search Results Dropdown */}
                                    {searchQuery && (
                                        <div className="absolute top-full left-0 right-0 mt-2 bg-[#1a1a1a] border border-gray-700 rounded-xl shadow-xl z-50 max-h-60 overflow-y-auto">
                                            {isSearching ? (
                                                <div className="p-4 text-center text-gray-400">
                                                    <Loader2 className="animate-spin inline-block mr-2" size={16} /> Đang tìm...
                                                </div>
                                            ) : searchResults && searchResults.length > 0 ? (
                                                searchResults.map((movie: Movie) => (
                                                    <button
                                                        key={movie.slug}
                                                        type="button"
                                                        onClick={() => handleSelectMovie(movie)}
                                                        className="w-full text-left p-3 hover:bg-white/10 flex items-center gap-3 border-b border-gray-700/50 last:border-0"
                                                    >
                                                        <div className="w-10 h-14 relative shrink-0 bg-gray-800 rounded overflow-hidden">
                                                            <Image
                                                                src={(movie.thumb_url || movie.poster_url || '').startsWith('http') ? (movie.thumb_url || movie.poster_url || '') : `${IMAGE_PREFIX}${movie.thumb_url || movie.poster_url || ''}`}
                                                                alt={movie.name}
                                                                fill
                                                                className="object-cover"
                                                            />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-white line-clamp-1">{movie.name}</div>
                                                            <div className="text-xs text-gray-400">{movie.year}</div>
                                                        </div>
                                                    </button>
                                                ))
                                            ) : (
                                                <div className="p-4 text-center text-gray-500">Không tìm thấy phim.</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex items-start gap-4 p-4 bg-gray-800/30 rounded-xl border border-gray-700">
                                    <div className="w-16 h-24 relative shrink-0 bg-gray-800 rounded-lg overflow-hidden shadow-lg">
                                        <Image
                                            src={(selectedMovie.thumb_url || selectedMovie.poster_url || '').startsWith('http') ? (selectedMovie.thumb_url || selectedMovie.poster_url || '') : `${IMAGE_PREFIX}${selectedMovie.thumb_url || selectedMovie.poster_url || ''}`}
                                            alt={selectedMovie.name}
                                            fill
                                            className="object-cover"
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="font-bold text-white max-w-[200px] truncate">{selectedMovie.name}</h3>
                                        <p className="text-sm text-gray-400">{selectedMovie.origin_name}</p>
                                        <p className="text-xs text-gray-500 mt-1">Năm: {selectedMovie.year}</p>
                                        <button
                                            type="button"
                                            onClick={() => setSelectedMovie(null)}
                                            className="mt-2 text-xs text-red-500 hover:text-red-400 font-medium hover:underline"
                                        >
                                            Thay đổi phim
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Date Time Picker */}
                        <div>
                            <label className="block text-sm font-bold text-gray-400 mb-2">Thời gian bắt đầu</label>
                            <div className="relative">
                                <input
                                    type="datetime-local"
                                    className="w-full bg-black border border-gray-800 rounded-xl px-4 py-3 text-white focus:border-red-500 focus:outline-none [color-scheme:dark]"
                                    value={startTime}
                                    onChange={(e) => setStartTime(e.target.value)}
                                    min={new Date().toISOString().slice(0, 16)}
                                    style={{ colorScheme: 'dark' }}
                                />
                                <Calendar className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={20} />
                            </div>
                            <p className="text-xs text-gray-500 mt-2">Chọn thời gian phim sẽ bắt đầu chiếu.</p>
                        </div>

                        <div className="pt-6 border-t border-gray-800">
                            <button
                                type="submit"
                                disabled={submitting || !selectedMovie || !startTime}
                                className="w-full bg-red-600 hover:bg-red-700 text-white py-4 rounded-xl font-bold transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center gap-2"
                            >
                                {submitting ? (
                                    <><Loader2 className="animate-spin" /> Đang xử lý...</>
                                ) : (
                                    <>Lên Lịch Công Chiếu</>
                                )}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
