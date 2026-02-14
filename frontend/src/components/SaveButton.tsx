'use client';
import { Heart, Loader2 } from 'lucide-react';
import { useSavedMovies } from '@/hooks/useLocalStorage';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { favoritesAPI } from '@/lib/api';
import { useRouter } from 'next/navigation';

interface SaveButtonProps {
    movie: {
        slug: string;
        name: string;
        poster_url: string;
        _id: string;
        origin_name?: string;
        quality?: string;
    };
    iconOnly?: boolean;
}

export default function SaveButton({ movie, iconOnly = false }: SaveButtonProps) {
    const { data: session, status } = useSession();
    const router = useRouter();
    const { isSaved, toggleSaveMovie: toggleLocal } = useSavedMovies(); // Keep local sync for guest/optimistic?
    // Actually, if we want cross-device sync, we must depend on API.
    // If we mix both, it gets complicated. Valid strategy:
    // 1. If logged in -> Use API mainly.
    // 2. If guest -> Use LocalStorage.

    const [saved, setSaved] = useState(false);
    const [loading, setLoading] = useState(false);

    // Initial check
    useEffect(() => {
        if (status === 'authenticated') {
            checkFavoriteStatus();
        } else {
            setSaved(isSaved(movie.slug));
        }
    }, [status, movie.slug, isSaved]);

    const checkFavoriteStatus = async () => {
        try {
            const res = await favoritesAPI.check(movie.slug);
            if (res.data.success) {
                setSaved(res.data.isFavorite);
            }
        } catch (error) {
            console.error(error);
        }
    };

    const handleToggle = async (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        if (status === 'unauthenticated') {
            // Guest mode: toggle local and maybe prompt login? 
            // For now, let's allow local save but warn it won't sync?
            // Or just redirect to login if stricter.
            // User requested "Sync", implying auth is key.
            // Let's redirect to login to encourage sync, or just use local.
            // Given the requirement "Tích hợp Auth... Lưu danh sách vào Database", 
            // let's try to update backend if logged in.
            // If not logged in, we use local hook.
            toggleLocal({
                id: movie._id,
                slug: movie.slug,
                name: movie.name,
                poster_url: movie.poster_url,
                origin_name: movie.origin_name,
                quality: movie.quality
            });
            setSaved(!saved);
            return;
        }

        if (loading) return;
        setLoading(true);

        try {
            if (saved) {
                await favoritesAPI.remove(movie.slug);
                setSaved(false);
            } else {
                await favoritesAPI.add({
                    movieSlug: movie.slug,
                    movieData: {
                        name: movie.name,
                        originName: movie.origin_name,
                        posterUrl: movie.poster_url,
                        thumbUrl: movie.poster_url, // fallback
                        year: 2024 // Default or pass prop
                    }
                });
                setSaved(true);
            }
        } catch (error) {
            console.error('Error toggling favorite:', error);
        } finally {
            setLoading(false);
        }
    };

    if (iconOnly) {
        return (
            <button
                onClick={handleToggle}
                disabled={loading}
                className={`p-2 rounded-full backdrop-blur-md transition-colors ${saved ? 'bg-red-600 text-white' : 'bg-black/40 text-white hover:bg-black/60'}`}
                title={saved ? "Bỏ lưu" : "Lưu phim"}
            >
                {loading ? <Loader2 size={20} className="animate-spin" /> : <Heart size={20} fill={saved ? "currentColor" : "none"} />}
            </button>
        );
    }

    return (
        <button
            onClick={handleToggle}
            disabled={loading}
            className={`flex items-center justify-center gap-2 px-6 py-3 rounded-full font-bold transition-all border ${saved
                ? 'bg-black/50 border-red-600 text-red-500 hover:bg-red-900/20'
                : 'bg-white/10 border-white/20 text-white hover:bg-white/20'
                }`}
        >
            {loading ? <Loader2 size={20} className="animate-spin" /> : <Heart size={20} fill={saved ? "currentColor" : "none"} />}
            {saved ? "Đã Lưu" : "Lưu Phim"}
        </button>
    );
}
