'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { watchHistoryAPI, Movie } from '@/lib/api';
import MovieCard from '@/components/MovieCard';
import { Loader2, History, Trash2 } from 'lucide-react';
import Link from 'next/link';

export default function HistoryPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/auth/login');
            return;
        }

        if (status === 'authenticated') {
            fetchHistory();
        }
    }, [status, router]);

    const fetchHistory = async () => {
        try {
            const response = await watchHistoryAPI.getAll(50); // Get last 50 items
            if (response.data.success) {
                setHistory(response.data.history);
            }
        } catch (error) {
            console.error('Error fetching history:', error);
        } finally {
            setLoading(false);
        }
    };

    const clearHistory = async () => {
        if (confirm('Bạn có chắc muốn xóa toàn bộ lịch sử xem không?')) {
            try {
                await watchHistoryAPI.clear();
                setHistory([]);
            } catch (error) {
                console.error('Error clearing history:', error);
            }
        }
    };

    if (status === 'loading' || loading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <Loader2 className="animate-spin text-red-600" size={40} />
            </div>
        );
    }

    if (history.length === 0) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
                <div className="bg-blue-600/10 p-6 rounded-full mb-6">
                    <History size={60} className="text-blue-500" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">Chưa có lịch sử xem</h1>
                <p className="text-gray-400 mb-8 max-w-md">
                    Bạn chưa xem bộ phim nào. Hãy bắt đầu thưởng thức những bộ phim tuyệt vời ngay thôi!
                </p>
                <Link
                    href="/"
                    className="bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-8 rounded-full transition-all hover:scale-105"
                >
                    Xem phim ngay
                </Link>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                    <div className="w-1.5 h-8 bg-blue-600 rounded-full"></div>
                    <h1 className="text-2xl md:text-3xl font-bold text-white uppercase">
                        Lịch sử xem
                    </h1>
                    <span className="bg-blue-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                        {history.length}
                    </span>
                </div>

                <button
                    onClick={clearHistory}
                    className="flex items-center gap-2 text-gray-400 hover:text-red-500 transition-colors px-4 py-2 rounded-lg hover:bg-white/5"
                >
                    <Trash2 size={18} />
                    <span className="hidden md:inline">Xóa lịch sử</span>
                </button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-8">
                {history.map((item) => {
                    const movie: Movie = {
                        _id: item._id || item.movieSlug,
                        name: item.movieData.name,
                        origin_name: item.movieData.originName,
                        slug: item.movieSlug,
                        poster_url: item.movieData.posterUrl,
                        thumb_url: item.movieData.thumbUrl,
                        year: item.movieData.year,
                    };

                    return (
                        <div key={item._id || item.movieSlug} className="relative group">
                            <MovieCard movie={movie} />
                            <div className="mt-2 flex items-center justify-between text-xs text-gray-500 px-1">
                                <span>
                                    {item.episode ? `Tập ${item.episode}` : 'Đang xem'}
                                </span>
                                <span>
                                    {new Date(item.watchedAt).toLocaleDateString('vi-VN')}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
