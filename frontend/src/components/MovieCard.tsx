'use client';

import Link from 'next/link';
import Image from 'next/image';
import { PlayCircle, Eye } from 'lucide-react';
import { Movie, getMovieDetail, MovieDetail, IMAGE_PREFIX } from '@/lib/api';
import { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';
import { useWatchHistory } from '@/hooks/useLocalStorage';

interface MovieCardProps {
    movie: Movie;
}

const detailCache = new Map<string, MovieDetail | null>();
const pendingDetailRequests = new Map<string, Promise<MovieDetail | null>>();

const normalizeMovieDetail = (data: any): MovieDetail | null => {
    if (!data) return null;

    if (data?.movie) {
        const enhancedDetails = { ...data.movie };
        if (data.episodes) {
            enhancedDetails.episodes = data.episodes;
        }
        return enhancedDetails as MovieDetail;
    }

    return data as MovieDetail;
};

const getMovieDetailCached = async (slug: string): Promise<MovieDetail | null> => {
    if (detailCache.has(slug)) {
        return detailCache.get(slug) ?? null;
    }

    const pending = pendingDetailRequests.get(slug);
    if (pending) {
        return pending;
    }

    const request = getMovieDetail(slug)
        .then((data) => {
            const normalized = normalizeMovieDetail(data);
            detailCache.set(slug, normalized);
            return normalized;
        })
        .catch(() => {
            detailCache.set(slug, null);
            return null;
        })
        .finally(() => {
            pendingDetailRequests.delete(slug);
        });

    pendingDetailRequests.set(slug, request);
    return request;
};

const getPreviewM3u8Url = (detail: MovieDetail | null): string => {
    if (!detail?.episodes?.length) return '';

    for (const server of detail.episodes) {
        const first = server.server_data?.[0];
        if (first?.link_m3u8) {
            return first.link_m3u8;
        }
    }

    return '';
};

const getYoutubeVideoId = (url: string): string => {
    if (!url) return '';

    const short = url.match(/youtu\.be\/([^?&/]+)/i);
    if (short?.[1]) return short[1];

    const watch = url.match(/[?&]v=([^?&/]+)/i);
    if (watch?.[1]) return watch[1];

    const embed = url.match(/youtube\.com\/embed\/([^?&/]+)/i);
    if (embed?.[1]) return embed[1];

    return '';
};

const getTrailerSource = (detail: MovieDetail | null) => {
    const trailerUrl = detail?.trailer_url || '';
    if (!trailerUrl) {
        return { type: 'none' as const, url: '' };
    }

    const youtubeId = getYoutubeVideoId(trailerUrl);
    if (youtubeId) {
        const embedUrl = `https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=1&controls=0&rel=0&playsinline=1&loop=1&playlist=${youtubeId}&modestbranding=1`;
        return { type: 'youtube' as const, url: embedUrl };
    }

    const normalized = trailerUrl.toLowerCase();
    if (normalized.includes('.m3u8')) {
        return { type: 'm3u8' as const, url: trailerUrl };
    }

    if (normalized.includes('.mp4') || normalized.includes('.webm') || normalized.includes('.mov')) {
        return { type: 'video' as const, url: trailerUrl };
    }

    return { type: 'none' as const, url: '' };
};

const MovieCard = ({ movie }: MovieCardProps) => {
    const [isHovered, setIsHovered] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const [popupPosition, setPopupPosition] = useState<'left' | 'center' | 'right'>('center'); // New state for popup alignment
    const [details, setDetails] = useState<MovieDetail | null>(null);
    const [views, setViews] = useState(0); // State for view count
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const cardRef = useRef<HTMLDivElement>(null); // Ref for the card container
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hoverActiveRef = useRef(false);
    const previewFallbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [youtubePreviewUrl, setYoutubePreviewUrl] = useState('');

    const { history } = useWatchHistory();
    const savedData = history.find(h => h.slug === movie.slug);
    const savedProgress = savedData?.progress || 0;
    const savedDuration = savedData?.duration || (45 * 60);

    const markPreviewReady = () => {
        if (previewFallbackTimeoutRef.current) {
            clearTimeout(previewFallbackTimeoutRef.current);
            previewFallbackTimeoutRef.current = null;
        }
        setIsVideoReady(true);
    };

    const posterUrl = movie.poster_url || '';
    const imageUrl = posterUrl
        ? (posterUrl.startsWith('http') ? posterUrl : `${IMAGE_PREFIX}${posterUrl}`)
        : '/icon.svg';

    const thumbUrlValue = movie.thumb_url || movie.poster_url || '';
    const popupImageUrl = thumbUrlValue
        ? (thumbUrlValue.startsWith('http') ? thumbUrlValue : `${IMAGE_PREFIX}${thumbUrlValue}`)
        : '/icon.svg';

    // Clean up HLS on unmount
    useEffect(() => {
        return () => {
            hoverActiveRef.current = false;
            if (hlsRef.current) {
                hlsRef.current.destroy();
            }
            if (previewFallbackTimeoutRef.current) {
                clearTimeout(previewFallbackTimeoutRef.current);
                previewFallbackTimeoutRef.current = null;
            }
        };
    }, []);

    // Fetch view count
    useEffect(() => {
        const fetchViews = async () => {
            try {
                const envUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:5291/api/movies';
                const apiUrl = envUrl.endsWith('/api/movies') ? envUrl : `${envUrl.replace(/\/$/, '')}/api/movies`;
                const res = await fetch(`${apiUrl}/views/${movie.slug}`);
                if (res.ok) {
                    const data = await res.json();
                    setViews(data.views);
                }
            } catch (e) { console.error("Error fetching views", e); }
        };
        // Fetch lazily or instantly? Instantly for now.
        fetchViews();
    }, [movie.slug]);



    // Handle playing video when details are loaded and isPlaying is true
    useEffect(() => {
        if (isPlaying && details && videoRef.current) {
            const trailer = getTrailerSource(details);
            const m3u8Url = trailer.type === 'm3u8' ? trailer.url : getPreviewM3u8Url(details);
            const directVideoUrl = trailer.type === 'video' ? trailer.url : '';

            if (trailer.type === 'youtube') {
                setYoutubePreviewUrl(trailer.url);
                setIsVideoReady(false);
                return;
            }

            setYoutubePreviewUrl('');

            setIsVideoReady(false);

            if (previewFallbackTimeoutRef.current) {
                clearTimeout(previewFallbackTimeoutRef.current);
                previewFallbackTimeoutRef.current = null;
            }

            previewFallbackTimeoutRef.current = setTimeout(() => {
                setIsPlaying(false);
                setIsVideoReady(false);
            }, 5000);

            if (m3u8Url || directVideoUrl) {
                if (directVideoUrl) {
                    if (hlsRef.current) {
                        hlsRef.current.destroy();
                        hlsRef.current = null;
                    }

                    videoRef.current.src = directVideoUrl;
                    videoRef.current.load();
                    videoRef.current.play().catch(() => setIsPlaying(false));
                    return;
                }

                if (Hls.isSupported()) {
                    if (hlsRef.current) hlsRef.current.destroy();

                    const hls = new Hls({
                        enableWorker: true,
                        startLevel: 0, // Start with lowest quality for faster load
                        maxMaxBufferLength: 10, // Only buffer 10 seconds max
                        maxBufferSize: 2 * 1000 * 1000, // 2MB buffer limit
                        maxBufferLength: 5, // Only buffer 5 seconds ahead
                        capLevelToPlayerSize: true, // Limit quality to player size
                        autoStartLoad: true,
                        backBufferLength: 0 // Don't keep old segments
                    });

                    hls.loadSource(m3u8Url);
                    hls.attachMedia(videoRef.current);

                    hls.on(Hls.Events.MANIFEST_PARSED, () => {
                        videoRef.current?.play().catch(e => {
                            console.error("Auto-play blocked:", e);
                            setIsPlaying(false); // Revert if autoplay fails
                        });
                    });

                    hls.on(Hls.Events.ERROR, (event, data) => {
                        if (!data.fatal) return;

                        console.error("HLS Error:", data);
                        setIsPlaying(false); // Revert on error
                        setIsVideoReady(false);
                    });

                    hlsRef.current = hls;
                } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
                    videoRef.current.src = m3u8Url;
                    videoRef.current.addEventListener('loadedmetadata', () => {
                        videoRef.current?.play().catch(() => setIsPlaying(false));
                    });
                }
            } else {
                setIsPlaying(false); // No source found
            }
        } else {
            // Stop playing
            setYoutubePreviewUrl('');
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.removeAttribute('src');
                videoRef.current.load();
            }
            if (previewFallbackTimeoutRef.current) {
                clearTimeout(previewFallbackTimeoutRef.current);
                previewFallbackTimeoutRef.current = null;
            }
            setIsVideoReady(false);
        }
    }, [isPlaying, details]);

    // Handle hover to fetch details and play trailer
    const handleMouseEnter = async () => {
        // Disable popup/video logic on mobile to save data
        if (typeof window !== 'undefined' && window.innerWidth < 768) return;

        hoverActiveRef.current = true;
        setIsHovered(true);

        // Calculate position
        if (cardRef.current) {
            const rect = cardRef.current.getBoundingClientRect();
            const screenWidth = window.innerWidth;
            const cardWidth = rect.width;

            // Use a larger buffer (70% of card width) to force side alignment for cards near edges
            // This prevents the "center" alignment from pushing the popup off-screen
            const spaceNeeded = cardWidth * 0.7;

            if (rect.left < spaceNeeded) {
                setPopupPosition('left');
            } else if (screenWidth - rect.right < spaceNeeded) {
                setPopupPosition('right');
            } else {
                setPopupPosition('center');
            }
        }

        // Clear any existing timeout
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        // Fetch details if not already loaded
        let nextDetails = details;

        if (!nextDetails) {
            try {
                nextDetails = await getMovieDetailCached(movie.slug);
                if (nextDetails && hoverActiveRef.current) {
                    setDetails(nextDetails);
                }
            } catch (error) {
                console.error("Failed to fetch movie details", error);
                setIsPlaying(false);
            }
        }

        if (!hoverActiveRef.current) {
            return;
        }

        const trailer = getTrailerSource(nextDetails);
        const streamPreviewUrl = getPreviewM3u8Url(nextDetails);
        if (trailer.type !== 'none' || streamPreviewUrl) {
            setIsPlaying(true);
        } else {
            setIsPlaying(false);
        }
    };

    const handleMouseLeave = () => {
        hoverActiveRef.current = false;
        setIsHovered(false);
        setIsPlaying(false);
        setIsVideoReady(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (previewFallbackTimeoutRef.current) {
            clearTimeout(previewFallbackTimeoutRef.current);
            previewFallbackTimeoutRef.current = null;
        }
    };

    return (
        <div
            ref={cardRef}
            className="group relative block overflow-visible z-10 hover:z-50"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* Base Card (Always Visible) */}
            <Link href={`/phim/${movie.slug}`} className="block h-full overflow-hidden rounded-xl bg-[#0f0f0f] border border-gray-800/50 transition-all duration-300">
                <div className="aspect-[2/3] w-full relative overflow-hidden bg-gray-900">
                    <Image
                        src={imageUrl}
                        alt={movie.name}
                        fill
                        className="object-cover transition-transform duration-300"
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
                        quality={60}
                        loading="lazy"
                    />

                    {/* Continue Watching Progress Bar */}
                    {savedProgress > 0 && (
                        <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gray-800/80 z-20">
                            <div
                                className="h-full bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.8)]"
                                style={{ width: `${Math.min((savedProgress / savedDuration) * 100, 100)}%` }}
                            />
                        </div>
                    )}

                    {/* Base Card Overlay - Visible on Mobile or when popup is hidden */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col items-center justify-center backdrop-blur-[2px] gap-2">
                        <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center shadow-lg shadow-red-600/40 transform scale-0 group-hover:scale-100 transition-transform duration-300">
                            <PlayCircle size={24} className="text-white fill-white" />
                        </div>
                        <span className="text-white font-bold text-xs tracking-widest uppercase transform translate-y-4 group-hover:translate-y-0 transition-transform duration-300">Xem ngay</span>
                    </div>

                    <div className="absolute top-2 left-2 flex gap-1 z-10">
                        <span className="bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-sm shadow-sm tracking-wider">FHD</span>
                        <span className="bg-yellow-500 text-black text-[10px] font-bold px-2 py-0.5 rounded-sm shadow-sm tracking-wider">VIP</span>
                    </div>

                    {/* View Count Badge */}
                    <div className="absolute top-2 right-2 z-10">
                        <div className="bg-black/60 text-gray-200 text-[10px] font-bold px-1.5 py-0.5 rounded-sm shadow-sm flex items-center gap-1 backdrop-blur-md border border-white/5">
                            <Eye size={10} className="text-emerald-400" /> {views > 0 ? views.toLocaleString() : '0'}
                        </div>
                    </div>
                </div>

                <div className="p-3 bg-[#0f0f0f]">
                    <h3 className="text-sm font-bold text-gray-100 truncate">{movie.name}</h3>
                    <p className="text-xs text-gray-500 truncate mt-1 font-medium">{movie.origin_name}</p>
                </div>
            </Link>

            {/* Pop-up Video Preview (Appears on Hover) - Positioning refinement */}
            <div className={`
          absolute z-[60] top-1/2 -translate-y-1/2
          w-[150%] bg-[#111] rounded-xl overflow-hidden shadow-2xl shadow-red-900/40 border border-gray-700
          transition-[transform,opacity,visibility] duration-150 hidden md:flex flex-col pointer-events-none
          ${popupPosition === 'left' ? 'left-0 origin-left' : ''}
          ${popupPosition === 'right' ? 'right-0 origin-right' : ''}
          ${popupPosition === 'center' ? 'left-1/2 -translate-x-1/2 origin-center' : ''}
          ${isHovered
                    ? 'scale-110 opacity-100 visible pointer-events-auto'
                    : 'scale-90 opacity-0 invisible'
                }
      `}>
                <div className="relative w-full aspect-video bg-black">
                    {/* Video Player */}
                    {youtubePreviewUrl && isPlaying ? (
                        <iframe
                            src={youtubePreviewUrl}
                            className={`w-full h-full transition-opacity duration-300 ${isVideoReady ? 'opacity-100' : 'opacity-0'}`}
                            allow="autoplay; encrypted-media; picture-in-picture"
                            allowFullScreen
                            onLoad={markPreviewReady}
                        />
                    ) : (
                        <video
                            ref={videoRef}
                            className={`w-full h-full object-cover transition-opacity duration-300 ${isVideoReady ? 'opacity-100' : 'opacity-0'}`}
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            onLoadedData={markPreviewReady}
                            onPlaying={markPreviewReady}
                            onError={() => {
                                setIsPlaying(false);
                                setIsVideoReady(false);
                            }}
                        />
                    )}

                    {/* Loading / Poster Fallback in Popup */}
                    <div className={`absolute inset-0 transition-opacity duration-300 z-10 ${isVideoReady ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                        <Image
                            src={popupImageUrl} // Use Landscape thumb for popup
                            alt={movie.name}
                            fill
                            className="object-cover opacity-60"
                            sizes="(max-width: 768px) 100vw, 400px"
                            priority
                        />
                        {isPlaying && !isVideoReady && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MovieCard;

