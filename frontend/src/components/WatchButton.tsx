'use client';
import Link from 'next/link';
import { Play } from 'lucide-react';

interface WatchButtonProps {
    slug: string;
    episodeSlug?: string;
}

export default function WatchButton({ slug, episodeSlug }: WatchButtonProps) {
    if (!episodeSlug) {
        return (
            <button disabled className="flex items-center justify-center gap-2 bg-surface-bright text-white px-8 py-3 rounded-full font-bold cursor-not-allowed opacity-70">
                <Play size={20} fill="currentColor" />
                Sắp Chiếu
            </button>
        );
    }

    return (
        <Link 
            href={`/xem-phim/${slug}?tap=${episodeSlug}`}
            className="flex items-center justify-center gap-2 bg-amber-primary hover:bg-amber-600 text-white px-8 py-3 rounded-full font-bold transition-all shadow-lg hover:shadow-amber-glow hover:scale-105"
        >
            <Play size={20} fill="currentColor" />
            Xem Ngay
        </Link>
    );
}
