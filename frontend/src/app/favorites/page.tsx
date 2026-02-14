'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { favoritesAPI, Movie } from '@/lib/api';
import MovieCard from '@/components/MovieCard';
import { Loader2, Heart } from 'lucide-react';
import Link from 'next/link';

export default function FavoritesPage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [favorites, setFavorites] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/auth/login');
            return;
        }

        if (status === 'authenticated') {
            fetchFavorites();
        }
    }, [status, router]);

    const fetchFavorites = async () => {
        try {
            const response = await favoritesAPI.getAll();
            if (response.data.success) {
                setFavorites(response.data.favorites);
            }
        } catch (error) {
            console.error('Error fetching favorites:', error);
        } finally {
            setLoading(false);
        }
    };

    if (status === 'loading' || loading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <Loader2 className="animate-spin text-red-600" size={40} />
            </div>
        );
    }

    if (favorites.length === 0) {
        return (
            <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
                <div className="bg-red-600/10 p-6 rounded-full mb-6">
                    <Heart size={60} className="text-red-600" />
                </div>
                <h1 className="text-2xl font-bold text-white mb-2">Chưa có phim yêu thích</h1>
                <p className="text-gray-400 mb-8 max-w-md">
                    Bạn chưa lưu bộ phim nào. Hãy khám phá và thả tim cho những bộ phim bạn yêu thích nhé!
                </p>
                <Link
                    href="/"
                    className="bg-red-600 hover:bg-red-700 text-white font-semibold py-3 px-8 rounded-full transition-all hover:scale-105"
                >
                    Khám phá ngay
                </Link>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-8">
            <div className="flex items-center gap-4 mb-8">
                <div className="w-1.5 h-8 bg-red-600 rounded-full"></div>
                <h1 className="text-2xl md:text-3xl font-bold text-white uppercase">
                    Phim Yêu Thích
                </h1>
                <span className="bg-red-600 text-white text-xs font-bold px-3 py-1 rounded-full">
                    {favorites.length}
                </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-8">
                {favorites.map((item) => {
                    // Map the backend structure to the Movie interface expected by MovieCard
                    // Backend stores movieData inside the favorite item
                    const movie: Movie = {
                        _id: item._id,
                        name: item.movieData.name,
                        origin_name: item.movieData.originName,
                        slug: item.movieSlug,
                        poster_url: item.movieData.posterUrl,
                        thumb_url: item.movieData.thumbUrl,
                        year: item.movieData.year,
                    };
                    return <MovieCard key={item._id} movie={movie} />;
                })}
            </div>
        </div>
    );
}
