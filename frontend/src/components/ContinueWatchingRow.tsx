'use client';

import { useWatchHistory } from '@/hooks/useLocalStorage';
import { useMissingPosters, searchPosters, resolveResumeHref, isResolvableSlug } from '@/hooks/usePosterBackfill';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Play, X, ImagePlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { IMAGE_PREFIX } from '@/lib/api';

export default function ContinueWatchingRow() {
    const { history, removeFromHistory, patchHistoryPosters } = useWatchHistory();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Heal rows saved before artwork was recorded (poster_url ''): exact
    // match on contentRef first, title-search fallback, then persist.
    const missing = useMemo(
        () => history.filter(h => !h.poster_url).map(h => ({ name: h.name, ref: h.id })),
        [history]
    );
    const backfilled = useMissingPosters(missing);
    const patches = useMemo(() => {
        const p: Record<string, string> = {};
        history.forEach(h => {
            if (!h.poster_url) {
                const poster = backfilled[h.id] || backfilled[(h.name || '').toLowerCase()];
                if (poster) p[h.slug] = poster;
            }
        });
        return p;
    }, [history, backfilled]);
    useEffect(() => {
        patchHistoryPosters(patches);
    }, [patches, patchHistoryPosters]);
    const posterOf = (h: { id: string; name: string; poster_url: string }) =>
        h.poster_url || backfilled[h.id] || backfilled[(h.name || '').toLowerCase()] || '';

    // Legacy (pre-cutover) slugs 404 on the watch route — resolve them by
    // title before navigating. New tmdb: slugs use the plain Link href.
    const router = useRouter();
    const [resolving, setResolving] = useState<Record<string, boolean>>({});
    const goResume = async (
        e: React.MouseEvent,
        movie: { slug: string; name: string; currentEpisode?: string }
    ) => {
        if (isResolvableSlug(movie.slug)) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        if (resolving[movie.slug]) return;
        setResolving((prev) => ({ ...prev, [movie.slug]: true }));
        try {
            router.push(await resolveResumeHref(movie.slug, movie.name, movie.currentEpisode));
        } finally {
            setResolving((prev) => ({ ...prev, [movie.slug]: false }));
        }
    };

    // Manual fix for fuzzy-matched artwork: cycle through same-title
    // candidates and persist the chosen one.
    const [cycling, setCycling] = useState<Record<string, boolean>>({});
    const cyclePoster = async (slug: string, name: string, current: string) => {
        if (cycling[slug]) return;
        setCycling((prev) => ({ ...prev, [slug]: true }));
        try {
            const candidates = await searchPosters(name);
            if (candidates.length === 0) return;
            const idx = candidates.indexOf(current);
            const next = candidates[(idx + 1) % candidates.length];
            if (next && next !== current) patchHistoryPosters({ [slug]: next });
        } finally {
            setCycling((prev) => ({ ...prev, [slug]: false }));
        }
    };

    if (!mounted || history.length === 0) return null;

    // Filter valid entries
    const ongoing = history.filter(h => h.progress && h.progress > 0 && h.currentEpisode);

    if (ongoing.length === 0) return null;

    return (
        <section className="mb-10">
            <h2 className="text-xl md:text-2xl font-bold text-white border-l-4 border-primary pl-3 uppercase tracking-wider mb-6 flex items-center gap-3 text-glow">
                Đang xem dở <span className="text-sm font-semibold text-cinema-subtle glass-panel px-3 py-1 rounded-full border border-white/10">({ongoing.length})</span>
            </h2>

            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {ongoing.map((movie) => {
                    const duration = movie.duration || 2700;
                    const progressPercent = Math.min(((movie.progress || 0) / duration) * 100, 100);

                    const rawPoster = posterOf(movie);
                    const posterUrl = rawPoster
                        ? rawPoster.startsWith('http')
                            ? rawPoster
                            : `${IMAGE_PREFIX}${rawPoster}`
                        : '';

                    const imageUrl = posterUrl;

                    return (
                        <div key={movie.slug} className="group relative glass-panel rounded-2xl overflow-hidden border border-white/5 shadow-glass hover:shadow-glow hover:border-primary/50 transition-all duration-300 hover:-translate-y-1">
                            {/* Remove + Fix-artwork Buttons */}
                            <div className="absolute top-2 right-2 z-20 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        cyclePoster(movie.slug, movie.name, imageUrl);
                                    }}
                                    className="p-2 glass-button hover:bg-primary text-cinema-muted hover:text-white rounded-full transition-all hover:scale-110 disabled:opacity-50"
                                    title="Đổi ảnh khác (khi sai poster)"
                                    disabled={!!cycling[movie.slug]}
                                >
                                    <ImagePlus size={14} strokeWidth={2.5} />
                                </button>
                                <button
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        removeFromHistory(movie.slug);
                                    }}
                                    className="p-2 glass-button hover:bg-primary text-cinema-muted hover:text-white rounded-full transition-all hover:scale-110"
                                    title="Xóa khỏi lịch sử"
                                >
                                    <X size={14} strokeWidth={3} />
                                </button>
                            </div>

                            <Link href={`/xem-phim/${movie.slug}?tap=${movie.currentEpisode}`} onClick={(e) => goResume(e, movie)} className="block relative aspect-[2/3] overflow-hidden">
                                {imageUrl ? (
                                    <Image
                                        src={imageUrl}
                                        alt={movie.name}
                                        fill
                                        className="object-cover opacity-90 group-hover:opacity-100 group-hover:scale-105 transition-all duration-500"
                                        unoptimized
                                    />
                                ) : (
                                    <div className="flex h-full w-full items-center justify-center bg-surface-container px-3 text-center text-body-sm font-semibold text-cinema-muted">
                                        {movie.name}
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-80" />

                                {/* Center Play Button */}
                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 scale-75 group-hover:scale-100">
                                    <div className="bg-primary rounded-full p-3 shadow-glow backdrop-blur-sm">
                                        <Play size={24} className="text-white fill-white translate-x-0.5" />
                                    </div>
                                </div>

                                {/* Progress Bar */}
                                <div className="absolute bottom-0 left-0 w-full h-1 bg-black/50 backdrop-blur">
                                    <div
                                        className="h-full bg-primary shadow-glow"
                                        style={{ width: `${progressPercent}%` }}
                                    />
                                </div>
                            </Link>

                            <div className="p-4 bg-surface">
                                <Link href={`/xem-phim/${movie.slug}?tap=${movie.currentEpisode}`} onClick={(e) => goResume(e, movie)} className="block mb-1.5">
                                    <h3 className="text-sm font-bold text-cinema-text truncate group-hover:text-primary transition-colors">{movie.name}</h3>
                                </Link>

                                <div className="flex justify-between items-center text-[10px] sm:text-xs text-cinema-subtle">
                                    <span>Tập {movie.currentEpisode}</span>
                                    <span className={progressPercent > 90 ? "text-green-500 font-medium" : "text-cinema-subtle"}>
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
