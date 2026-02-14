'use client';

import { useWatchHistory } from '@/hooks/useLocalStorage';
import Link from 'next/link';
import Image from 'next/image';
import { Play, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IMAGE_PREFIX } from '@/lib/api';

export default function ContinueWatchingRow() {
    const { history, removeFromHistory } = useWatchHistory();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted || history.length === 0) return null;

    // Filter valid entries
    const ongoing = history.filter(h => h.progress && h.progress > 0 && h.currentEpisode);

    if (ongoing.length === 0) return null;

    return (
        <section className="mb-10">
            <h2 className="text-xl md:text-2xl font-bold text-white border-l-4 border-red-600 pl-3 uppercase tracking-wide mb-6 flex items-center gap-3">
                Đang xem dở <span className="text-sm font-semibold text-gray-400 bg-white/10 px-2 py-0.5 rounded-md border border-white/5">({ongoing.length})</span>
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {ongoing.map((movie) => {
                    const duration = movie.duration || 2700;
                    const progressPercent = Math.min(((movie.progress || 0) / duration) * 100, 100);

                    const posterUrl = movie.poster_url?.startsWith('http')
                        ? movie.poster_url
                        : `${IMAGE_PREFIX}${movie.poster_url}`;

                    const imageUrl = posterUrl;

                    return (
                        <div key={movie.slug} className="group relative bg-[#111] rounded-xl overflow-hidden border border-white/10 shadow-lg hover:shadow-red-900/20 transition-all hover:-translate-y-1">
                            {/* Remove Button */}
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    removeFromHistory(movie.slug);
                                }}
                                className="absolute top-1 right-1 z-20 p-1.5 bg-black/60 hover:bg-red-600 text-gray-300 hover:text-white rounded-full transition-colors opacity-0 group-hover:opacity-100"
                                title="Xóa khỏi lịch sử"
                            >
                                <X size={14} strokeWidth={3} />
                            </button>

                            <Link href={`/xem-phim/${movie.slug}?tap=${movie.currentEpisode}`} className="block relative aspect-[2/3] overflow-hidden">
                                <Image
                                    src={imageUrl}
                                    alt={movie.name}
                                    fill
                                    className="object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                                    unoptimized
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />

                                {/* Center Play Button */}
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100">
                                    <div className="bg-red-600 rounded-full p-3 shadow-lg shadow-red-600/40 backdrop-blur-sm">
                                        <Play size={20} className="text-white fill-white translate-x-0.5" />
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="absolute bottom-0 left-0 w-full h-1 bg-gray-800/80 backdrop-blur">
                                    <div
                                        className="h-full bg-red-600 shadow-[0_0_8px_rgba(220,38,38,0.8)]"
                                        style={{ width: `${progressPercent}%` }}
                                    />
                                </div>
                            </Link>

                            <div className="p-3">
                                <Link href={`/xem-phim/${movie.slug}?tap=${movie.currentEpisode}`} className="block mb-1">
                                    <h3 className="text-sm font-bold text-gray-200 truncate group-hover:text-red-500 transition-colors">{movie.name}</h3>
                                </Link>

                                <div className="flex justify-between items-center text-[10px] sm:text-xs text-gray-400">
                                    <span>Tập {movie.currentEpisode}</span>
                                    <span className={progressPercent > 90 ? "text-green-500 font-medium" : "text-gray-500"}>
                                        {Math.round(progressPercent)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                    )
                })}
            </div>
        </section>
    );
}
