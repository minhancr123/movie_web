'use client';

import { useWatchHistory } from '@/hooks/useLocalStorage';
import Link from 'next/link';
import Image from 'next/image';
import { Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { IMAGE_PREFIX } from '@/lib/api';

export default function ContinueWatchingRow() {
    const { history } = useWatchHistory();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted || history.length === 0) return null;

    // Filter valid entries
    const ongoing = history.filter(h => h.progress && h.progress > 0 && h.currentEpisode);

    if (ongoing.length === 0) return null;

    return (
        <section className="mb-8">
            <h2 className="text-xl md:text-2xl font-bold text-white border-l-4 border-red-600 pl-3 uppercase tracking-wide mb-6 flex items-center gap-3">
                Đang xem dở <span className="text-sm font-semibold text-gray-400 bg-white/10 px-2 py-0.5 rounded-md border border-white/5">({ongoing.length})</span>
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
                {ongoing.map((movie) => {
                     // Calculate progress (mock duration if missing)
                     const duration = movie.duration || 2700; 
                     const progressPercent = Math.min(((movie.progress || 0) / duration) * 100, 100);
                     
                     const posterUrl = movie.poster_url?.startsWith('http') 
                        ? movie.poster_url 
                        : `${IMAGE_PREFIX}${movie.poster_url}`;

                     // Use poster since thumb_url is not in history
                     const imageUrl = posterUrl;

                     return (
                        <div key={movie.slug} className="group relative bg-[#111] rounded-xl overflow-hidden border border-gray-800 shadow-lg hover:shadow-red-900/20 transition-all hover:-translate-y-1">
                            <Link href={`/xem-phim/${movie.slug}?tap=${movie.currentEpisode}`} className="block relative aspect-video overflow-hidden">
                                <Image 
                                    src={imageUrl} 
                                    alt={movie.name} 
                                    fill 
                                    className="object-cover opacity-80 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                                    unoptimized
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />
                                
                                {/* Center Play Button */}
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100">
                                    <div className="bg-red-600 rounded-full p-4 shadow-lg shadow-red-600/40">
                                        <Play size={24} className="text-white fill-white translate-x-0.5" />
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="absolute bottom-0 left-0 w-full h-1 bg-gray-800/50 backdrop-blur">
                                    <div 
                                        className="h-full bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.8)]" 
                                        style={{ width: `${progressPercent}%` }} 
                                    />
                                </div>
                            </Link>

                            <div className="p-4 flex flex-col justify-between h-24">
                                <div>
                                    <Link href={`/xem-phim/${movie.slug}?tap=${movie.currentEpisode}`} className="block">
                                        <h3 className="text-base font-bold text-gray-100 truncate group-hover:text-red-500 transition-colors">{movie.name}</h3>
                                    </Link>
                                    <p className="text-xs text-gray-400 mt-1 truncate">
                                        {movie.origin_name || 'Đang cập nhật'}
                                    </p>
                                </div>
                                <div className="mt-auto flex justify-between items-center text-xs">
                                    <span className="text-gray-400">Đã xem {Math.round(progressPercent)}%</span>
                                    <span className="text-red-400 font-medium bg-red-400/10 px-2 py-1 rounded border border-red-400/20">
                                        Tập {movie.currentEpisode}
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
