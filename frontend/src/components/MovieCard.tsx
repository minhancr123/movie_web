'use client';

import Link from 'next/link';
import Image from 'next/image';
import { PlayCircle, Star, Calendar, Eye } from 'lucide-react';
import { Movie, getMovieDetail, MovieDetail, IMAGE_PREFIX } from '@/lib/api';
import { useState, useRef, useEffect } from 'react';
import Hls from 'hls.js';
import { useWatchHistory } from '@/hooks/useLocalStorage';

interface MovieCardProps {
    movie: Movie;
}

const MovieCard = ({ movie }: MovieCardProps) => {
    const [isHovered, setIsHovered] = useState(false);
    const [hasHovered, setHasHovered] = useState(false); // Only render popup after first hover
    const [isPlaying, setIsPlaying] = useState(false);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const [popupPosition, setPopupPosition] = useState<'left' | 'center' | 'right'>('center'); // New state for popup alignment
    const [details, setDetails] = useState<MovieDetail | null>(null);
    const [views, setViews] = useState(0); // State for view count
    const videoRef = useRef<HTMLVideoElement>(null);
    const hlsRef = useRef<Hls | null>(null);
    const cardRef = useRef<HTMLDivElement>(null); // Ref for the card container
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const { history } = useWatchHistory();
    const savedData = history.find(h => h.slug === movie.slug);
    const savedProgress = savedData?.progress || 0;
    const savedDuration = savedData?.duration || (45 * 60);

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
            if (hlsRef.current) {
                hlsRef.current.destroy();
            }
        };
    }, []);

    // Fetch view count
    // Fetch view count - Optimized with Intersection Observer
    useEffect(() => {
        let observer: IntersectionObserver;
        const currentRef = cardRef.current;

        const fetchViews = async () => {
            try {
                const envUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:5000';
                const apiUrl = envUrl.endsWith('/api/movies') ? envUrl : `${envUrl}/api/movies`;
                const res = await fetch(`${apiUrl}/views/${movie.slug}`, { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    setViews(data.views);
                }
            } catch (e) {
                // Silent error
            }
        };

        if (currentRef) {
            // Check if IntersectionObserver is supported (Client side)
            if ('IntersectionObserver' in window) {
                observer = new IntersectionObserver((entries) => {
                    if (entries[0].isIntersecting) {
                        fetchViews();
                        observer.disconnect(); // Only fetch once
                    }
                }, { rootMargin: '50px' }); // Load slightly before view
                observer.observe(currentRef);
            } else {
                // Fallback for older browsers
                fetchViews();
            }
        }

        return () => {
            if (observer) observer.disconnect();
        };
    }, [movie.slug]);



    // Handle playing video when details are loaded and isPlaying is true
    useEffect(() => {
        if (isPlaying && details && videoRef.current) {
            // Find first episode m3u8
            // Data structure check: episodes might be directly on details, or nested
            // My fix ensures details has episodes array merged in.

            let m3u8Url = "";

            if (details.episodes && details.episodes.length > 0) {
                const firstServer = details.episodes[0];
                if (firstServer.server_data && firstServer.server_data.length > 0) {
                    m3u8Url = firstServer.server_data[0].link_m3u8;
                }
            }

            if (m3u8Url) {
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
                        if (data.fatal) {
                            console.error("HLS Error:", data);
                            setIsPlaying(false); // Revert on error
                            setIsVideoReady(false);
                        }
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
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
            if (videoRef.current) {
                videoRef.current.pause();
                videoRef.current.removeAttribute('src');
                videoRef.current.load();
            }
            setIsVideoReady(false);
        }
    }, [isPlaying, details]);

    // Handle hover to fetch details and play trailer
    const handleMouseEnter = async () => {
        // Disable popup/video logic on mobile to save data
        if (typeof window !== 'undefined' && window.innerWidth < 768) return;

        setIsHovered(true);
        setHasHovered(true); // Mark as hovered to start rendering popup

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

        // Start playing immediately - no delay
        setIsPlaying(true);

        // Re-fetch views on hover to ensure freshness
        const envUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:5000';
        const apiUrl = envUrl.endsWith('/api/movies') ? envUrl : `${envUrl}/api/movies`;
        fetch(`${apiUrl}/views/${movie.slug}`, { cache: 'no-store' })
            .then(res => res.json())
            .then(data => setViews(data.views))
            .catch(() => { });

        // Fetch details if not already loaded
        if (!details) {
            try {
                const data = await getMovieDetail(movie.slug);
                if (data?.movie) {
                    const enhancedDetails = { ...data.movie };
                    if (data.episodes) {
                        enhancedDetails.episodes = data.episodes;
                    }
                    setDetails(enhancedDetails);
                } else if (data) {
                    setDetails(data);
                } else {
                    setIsPlaying(false);
                }
            } catch (error) {
                console.error("Failed to fetch movie details", error);
                setIsPlaying(false);
            }
        }
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        setIsPlaying(false);
        setIsVideoReady(false);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
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

            {/* Pop-up Video Preview (Lazy Loaded) */}
            {hasHovered && (
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
                        {/* ... existing video setup ... */}
                        <video
                            ref={videoRef}
                            className={`w-full h-full object-cover transition-opacity duration-300 ${isVideoReady ? 'opacity-100' : 'opacity-0'}`}
                            muted
                            loop
                            playsInline
                            preload="metadata"
                            onPlaying={() => setIsVideoReady(true)}
                        />

                        {/* Loading / Poster Fallback in Popup */}
                        <div className={`absolute inset-0 transition-opacity duration-300 z-10 ${isVideoReady ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                            <Image
                                src={popupImageUrl} // Use Landscape thumb for popup
                                alt={movie.name}
                                fill
                                className="object-cover opacity-60"
                                sizes="(max-width: 768px) 100vw, 400px"
                                priority={false} // Lazy load popup image
                            />
                            {isPlaying && !isVideoReady && (
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin"></div>
                                </div>
                            )}
                        </div>

                        {isPlaying && (
                            <div className="absolute top-2 right-2 z-20">
                                <div className="w-6 h-6 rounded-full bg-black/60 flex items-center justify-center border border-white/20">
                                    {!isVideoReady ? (
                                        <div className="w-4 h-4 rounded-full border-2 border-white/40 border-t-transparent animate-spin" />
                                    ) : (
                                        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Overlay Info inside Popup */}
                    <div className="p-3 bg-[#111] flex flex-col gap-1.5 min-h-[80px]">
                        <h4 className="text-white font-bold text-sm line-clamp-1 drop-shadow-md">{movie.name}</h4>
                        <div className="flex items-center gap-2 text-[10px] text-gray-400 font-medium">
                            <span className="text-green-500 font-bold">98% Phù hợp</span>
                            <span className="border border-gray-700 px-1 rounded bg-gray-800">{movie.year}</span>
                            <span className="border border-gray-700 px-1 rounded bg-gray-800">HD</span>
                        </div>

                        <div className="flex gap-2 mt-1">
                            <Link href={`/phim/${movie.slug}`} className="flex-1 bg-white text-black py-1.5 rounded text-[10px] font-bold flex items-center justify-center gap-1 hover:bg-gray-200 transition-colors uppercase tracking-wide">
                                <PlayCircle size={12} fill="black" /> XEM NGAY
                            </Link>
                            <button className="border border-gray-600 rounded-full p-1.5 hover:border-white hover:bg-white/10 transition-colors text-white">
                                <Star size={12} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MovieCard;

