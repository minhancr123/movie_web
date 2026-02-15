'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import {
    Play, Pause, Maximize, Minimize, Volume2, VolumeX,
    RotateCcw, RotateCw, Settings, SkipForward, Loader2
} from 'lucide-react';
import { useWatchHistory } from '../hooks/useLocalStorage';

interface VideoPlayerProps {
    src: string;
    movie: {
        name: string;
        slug: string;
        poster_url: string;
        origin_name: string;
        quality: string;
    };
    episode: {
        name: string;
        slug: string;
    };
    onNextEpisode?: () => void;
}

export default function VideoPlayer({ src, movie, episode, onNextEpisode }: VideoPlayerProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [isPiP, setIsPiP] = useState(false);
    const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
    // State for Quality Options (mapped with original index)
    const [qualityOptions, setQualityOptions] = useState<{ height: number; width: number; bitrate: number; index: number; label: string }[]>([]);
    const [currentQuality, setCurrentQuality] = useState(-1); // -1 is Auto. Values >= 0 are indices in hls.levels
    const [buffered, setBuffered] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [skippedIntro, setSkippedIntro] = useState(false);

    const controlsTimeoutRef = useRef<NodeJS.Timeout>();
    const hlsRef = useRef<Hls | null>(null); // Keep reference to HLS instance
    const { history, addToHistory } = useWatchHistory();

    const toggleSettings = () => {
        setShowSettings(!showSettings);
    };

    const changePlaybackSpeed = (speed: number) => {
        if (videoRef.current) {
            videoRef.current.playbackRate = speed;
            setPlaybackSpeed(speed);
            setShowSettings(false);
        }
    };

    const changeQuality = (qualityIndex: number) => {
        if (hlsRef.current) {
            hlsRef.current.currentLevel = qualityIndex; // -1 is auto
            setCurrentQuality(qualityIndex);
            setShowSettings(false);
        }
    };

    const getQualityLabel = (level: any) => {
        const height = level.height;
        const width = level.width;

        if (width >= 3840 || height >= 2160) return '4K';
        if (width >= 2560 || height >= 1440) return '2K';
        if (width >= 1920 || height >= 1080) return '1080p';
        if (width >= 1280 || height >= 720) return '720p';
        if (height) return `${height}p`;

        if (level.bitrate) return `${Math.round(level.bitrate / 1000)}Kbps`;
        return 'Normal';
    };

    // Format time (seconds -> MM:SS)
    const formatTime = (time: number) => {
        if (!time || isNaN(time)) return "00:00";
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
    };

    // Initialize HLS
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        // Perform cleanup of previous HLS instance if it exists
        if (hlsRef.current) {
            hlsRef.current.destroy();
            hlsRef.current = null;
        }

        setError(null);
        setIsLoading(true);

        const initPlayer = () => {
            // Try to restore from history specifically for this movie/episode
            // We access the current history state directly. 
            // Since we removed history from deps, this uses the value at the time src changed.
            const saved = history.find(h => h.slug === movie.slug);
            if (saved && saved.currentEpisode === episode.slug && saved.progress) {
                // Only restore if we are close to the beginning (to avoid overriding user seek? No, this is init)
                // But wait, if user refreshes, we want to restore.
                video.currentTime = saved.progress;
            }
        };

        if (Hls.isSupported()) {
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false, // Better for VOD (allows larger buffer)
                maxBufferLength: 60,   // Stable buffer size
                maxMaxBufferLength: 600,
                capLevelToPlayerSize: true, // Limit quality based on screen size to save bandwidth
                startLevel: -1, // Auto quality start
                // Aggressive timeouts to recover from stuck segments faster
                fragLoadingTimeOut: 20000,
                manifestLoadingTimeOut: 20000,
                levelLoadingTimeOut: 20000,
            });
            hlsRef.current = hls;

            hls.loadSource(src);
            hls.attachMedia(video);

            hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                const levels = hls.levels;
                const options = levels.map((level, index) => ({
                    height: level.height,
                    width: level.width,
                    bitrate: level.bitrate,
                    index: index,
                    label: getQualityLabel(level)
                }));
                // Sort by resolution descending (width/height) for UI
                options.sort((a, b) => b.width - a.width);
                setQualityOptions(options);
                setCurrentQuality(-1);

                initPlayer();

                // Attempt to auto-play
                const playPromise = video.play();
                if (playPromise !== undefined) {
                    playPromise.catch(() => {
                        setIsPlaying(false);
                        // Auto-play blocked, user interaction required.
                    });
                }

                setIsLoading(false);
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
                console.warn("HLS Error:", data);
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.log("Trying to recover from network error...");
                            hls.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log("Trying to recover from media error...");
                            hls.recoverMediaError();
                            break;
                        default:
                            console.error("Fatal HLS error, cannot recover");
                            setError("Không thể phát video này.");
                            hls.destroy();
                            break;
                    }
                }
            });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = src;
            video.addEventListener('loadedmetadata', () => {
                initPlayer();
                video.play().catch(() => setIsPlaying(false));
                setIsLoading(false);
            });
        } else {
            setError("Trình duyệt không hỗ trợ HLS.");
        }

        return () => {
            if (hlsRef.current) {
                hlsRef.current.destroy();
                hlsRef.current = null;
            }
        };
        // Removed 'history' from dependency array to prevent re-init on auto-save
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [src, movie.slug, episode.slug]);

    // History Saver
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const saveProgress = async () => {
            if (video.currentTime > 5) {
                // Local save
                addToHistory({
                    id: movie.slug,
                    slug: movie.slug,
                    name: movie.name,
                    origin_name: movie.origin_name,
                    quality: movie.quality,
                    poster_url: movie.poster_url,
                    timeSaved: Date.now(),
                    currentEpisode: episode.slug,
                    progress: video.currentTime,
                    duration: video.duration
                });

                // API sync (fire and forget to avoid blocking)
                // Ideally we check session here, but VideoPlayer is a client component.
                // We can pass session status or check it.
                // Since VideoPlayer doesn't have session prop, let's assume we can fetch it or just try calling API 
                // and let interceptors handle auth (if valid token exists).
                // However, frequent API calls on every 5s might be heavy.
                // Let's debounce or use a different strategy? 
                // 5s is fine for simple heartbeat if users are not massive.
                // Better: only sync every 30s or on pause/end.

                // For now, let's rely on the fact that if auth cookie/token is there, api call works.
                // We will import watchHistoryAPI.
                try {
                    // We need to valid if we are logged in. 
                    // Checking localStorage 'token' or similar might be enough if we don't want to useSession hook here to avoid re-renders.
                    // But standard way is useSession.
                    // Let's import watchHistoryAPI at top.
                    await import('@/lib/api').then(({ watchHistoryAPI }) => {
                        watchHistoryAPI.add({
                            movieSlug: movie.slug,
                            movieData: {
                                name: movie.name,
                                originName: movie.origin_name,
                                posterUrl: movie.poster_url,
                                thumbUrl: movie.poster_url,
                                year: 2024
                            },
                            episode: episode.slug,
                            server: 'Vip', // Default or pass prop
                            currentTime: video.currentTime
                        }).catch(() => { }); // Ignore errors silently
                    });
                } catch (e) {
                    // ignore
                }
            }
        };
        const interval = setInterval(saveProgress, 10000); // 10s interval for API sync balance
        return () => clearInterval(interval);
    }, [movie, episode, addToHistory]);



    // Event Listeners
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;

        const handleTimeUpdate = () => {
            setCurrentTime(video.currentTime);
            if (video.buffered.length > 0) {
                const bufferedEnd = video.buffered.end(video.buffered.length - 1);
                const duration = video.duration;
                if (duration > 0) {
                    setBuffered((bufferedEnd / duration) * 100);
                }
            }
        };

        const handleDurationChange = () => setDuration(video.duration);
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleWaiting = () => setIsLoading(true);
        const handlePlaying = () => setIsLoading(false);
        const handleEnded = () => {
            setIsPlaying(false);
            if (onNextEpisode) {
                console.log("🎬 Auto playing next episode...");
                onNextEpisode();
            }
        };

        video.addEventListener('timeupdate', handleTimeUpdate);
        video.addEventListener('durationchange', handleDurationChange);
        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        video.addEventListener('waiting', handleWaiting);
        video.addEventListener('playing', handlePlaying);
        video.addEventListener('ended', handleEnded);

        return () => {
            video.removeEventListener('timeupdate', handleTimeUpdate);
            video.removeEventListener('durationchange', handleDurationChange);
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
            video.removeEventListener('waiting', handleWaiting);
            video.removeEventListener('playing', handlePlaying);
            video.removeEventListener('ended', handleEnded);
        }
    }, [onNextEpisode]);

    // Controls Visibility
    const handleMouseMove = () => {
        setShowControls(true);
        if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = setTimeout(() => {
            if (isPlaying) setShowControls(false);
        }, 3000);
    };

    const togglePlay = useCallback(() => {
        if (videoRef.current) {
            if (isPlaying) {
                videoRef.current.pause();
            } else {
                const playPromise = videoRef.current.play();
                if (playPromise !== undefined) {
                    playPromise.catch(error => {
                        console.error("❌ Play failed:", error);
                    });
                }
            }
        }
    }, [isPlaying]);

    const toggleFullscreen = useCallback(() => {
        const video = videoRef.current;

        // iOS Safari Support (Native Fullscreen)
        if (video && (video as any).webkitEnterFullscreen) {
            (video as any).webkitEnterFullscreen();
            return;
        }

        // Standard Desktop Support
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen().catch(err => {
                // Fallback to video fullscreen if container fails
                if (video && video.requestFullscreen) {
                    video.requestFullscreen();
                }
            });
            setIsFullscreen(true);
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
            setIsFullscreen(false);
        }
    }, []);

    // Toggle Picture-in-Picture
    const togglePiP = async () => {
        if (!videoRef.current) return;

        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                setIsPiP(false);
            } else {
                await videoRef.current.requestPictureInPicture();
                setIsPiP(true);
            }
        } catch (err) {
            console.error('PiP error:', err);
        }
    };

    // Auto PiP when page hidden (switch tab/minimize) or scroll out of view
    useEffect(() => {
        let pipTimeout: NodeJS.Timeout;

        const tryEnablePiP = async () => {
            if (!videoRef.current) return false;

            // Check if video is ready and playing
            if (videoRef.current.readyState < 2) {
                console.log('Video not ready for PiP');
                return false;
            }

            // Check if already in PiP
            if (document.pictureInPictureElement) {
                console.log('Already in PiP mode');
                return true;
            }

            try {
                await videoRef.current.requestPictureInPicture();
                setIsPiP(true);
                console.log('✅ PiP enabled successfully');
                return true;
            } catch (err: any) {
                console.error('❌ PiP failed:', err.message || err);
                return false;
            }
        };

        const tryDisablePiP = async () => {
            if (document.pictureInPictureElement) {
                try {
                    await document.exitPictureInPicture();
                    setIsPiP(false);
                    console.log('✅ PiP disabled');
                } catch (err) {
                    console.error('❌ PiP exit failed:', err);
                }
            }
        };

        const handleVisibilityChange = () => {
            const isHidden = document.hidden || document.visibilityState === 'hidden';
            console.log(`📄 Visibility changed: ${isHidden ? 'HIDDEN' : 'VISIBLE'}`);

            if (isHidden && isPlaying) {
                // Delay slightly to ensure video is ready
                pipTimeout = setTimeout(() => {
                    tryEnablePiP();
                }, 100);
            } else {
                clearTimeout(pipTimeout);
                tryDisablePiP();
            }
        };

        const handleBlur = () => {
            console.log('🔵 Window BLUR (minimize/switch app)');
            if (isPlaying) {
                pipTimeout = setTimeout(() => {
                    tryEnablePiP();
                }, 100);
            }
        };

        const handleFocus = () => {
            console.log('🟢 Window FOCUS (restore)');
            clearTimeout(pipTimeout);

            // Only exit PiP if video is in viewport
            if (document.pictureInPictureElement && containerRef.current) {
                const rect = containerRef.current.getBoundingClientRect();
                const isInView = rect.top < window.innerHeight && rect.bottom > 0;

                if (isInView) {
                    tryDisablePiP();
                }
            }
        };

        const handleScroll = () => {
            if (!isPlaying || !containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();
            const isOutOfView = rect.bottom < 0 || rect.top > window.innerHeight;

            if (isOutOfView) {
                console.log('📜 Video scrolled OUT of view');
                tryEnablePiP();
            } else if (document.pictureInPictureElement) {
                console.log('📜 Video scrolled INTO view');
                tryDisablePiP();
            }
        };

        const handleEnterPiP = () => {
            setIsPiP(true);
            console.log('🎬 ENTERED PiP mode');
        };

        const handleLeavePiP = () => {
            setIsPiP(false);
            console.log('🎬 LEFT PiP mode');
        };

        // Add all event listeners
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleBlur);
        window.addEventListener('focus', handleFocus);
        window.addEventListener('scroll', handleScroll, { passive: true });
        videoRef.current?.addEventListener('enterpictureinpicture', handleEnterPiP);
        videoRef.current?.addEventListener('leavepictureinpicture', handleLeavePiP);

        console.log('🎯 Auto PiP listeners registered. isPlaying:', isPlaying);

        return () => {
            clearTimeout(pipTimeout);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleBlur);
            window.removeEventListener('focus', handleFocus);
            window.removeEventListener('scroll', handleScroll);
            videoRef.current?.removeEventListener('enterpictureinpicture', handleEnterPiP);
            videoRef.current?.removeEventListener('leavepictureinpicture', handleLeavePiP);
        };
    }, [isPlaying]);

    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const time = Number(e.target.value);
        if (videoRef.current) {
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const vol = Number(e.target.value);
        setVolume(vol);
        if (videoRef.current) {
            videoRef.current.volume = vol;
            setIsMuted(vol === 0);
        }
    };

    const toggleMute = () => {
        if (videoRef.current) {
            const newMuted = !isMuted;
            setIsMuted(newMuted);
            videoRef.current.muted = newMuted;
            if (newMuted) {
                setVolume(0);
            } else {
                setVolume(1);
                videoRef.current.volume = 1;
            }
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

            switch (e.key.toLowerCase()) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'f':
                    e.preventDefault();
                    toggleFullscreen();
                    break;
                case 'arrowright':
                    e.preventDefault();
                    if (videoRef.current) videoRef.current.currentTime += 10;
                    break;
                case 'arrowleft':
                    e.preventDefault();
                    if (videoRef.current) videoRef.current.currentTime -= 10;
                    break;
                case 'm':
                    toggleMute();
                    break;
                case 'i':
                    e.preventDefault();
                    togglePiP();
                    break;
                case '?':
                    e.preventDefault();
                    setShowKeyboardHelp(true);
                    break;
                case 's':
                    if (videoRef.current && videoRef.current.currentTime < 300) {
                        setSkippedIntro(true);
                        videoRef.current.currentTime += 90;
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [togglePlay, toggleFullscreen]);

    if (error) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-gray-900 border border-red-900/50 rounded-lg">
                <div className="text-center">
                    <p className="text-red-500 font-bold mb-2">Đã có lỗi xảy ra</p>
                    <p className="text-gray-400 text-sm">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full bg-black group overflow-hidden select-none"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => isPlaying && setShowControls(false)}
            onClick={togglePlay}
            onDoubleClick={toggleFullscreen}
        >
            {/* Keyboard Shortcuts Help Modal */}
            {showKeyboardHelp && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={() => setShowKeyboardHelp(false)}>
                    <div className="bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-white/10" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-white text-xl font-bold flex items-center gap-2">
                                <span>⌨️</span>
                                Phím tắt
                            </h3>
                            <button onClick={() => setShowKeyboardHelp(false)} className="text-gray-400 hover:text-white transition">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Play / Pause</span>
                                <div className="flex gap-2">
                                    <kbd className="bg-white/10 px-3 py-1 rounded text-white">Space</kbd>
                                    <kbd className="bg-white/10 px-3 py-1 rounded text-white">K</kbd>
                                </div>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Toàn màn hình</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">F</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Picture-in-Picture</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">I</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Tắt / Bật âm</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">M</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Tua 10s</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">→</kbd>
                            </div>
                            <div className="flex justify-between items-center text-sm">
                                <span className="text-gray-300">Lùi 10s</span>
                                <kbd className="bg-white/10 px-3 py-1 rounded text-white">←</kbd>
                            </div>
                        </div>

                        <div className="mt-6 text-center">
                            <button onClick={() => setShowKeyboardHelp(false)} className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-full font-semibold transition">
                                Đóng
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Keyboard Help Hint */}
            <div className={`absolute top-4 right-4 z-20 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 text-white text-xs transition-opacity ${showControls ? 'opacity-100' : 'opacity-0'}`}>
                <button onClick={(e) => { e.stopPropagation(); setShowKeyboardHelp(true); }} className="hover:text-red-400 transition">
                    Press <kbd className="bg-white/20 px-1.5 py-0.5 rounded mx-1">?</kbd> for shortcuts
                </button>
            </div>

            <video
                ref={videoRef}
                className="w-full h-full object-contain"
                playsInline
                onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                onDoubleClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
            />

            {/* Loading Spinner */}
            {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-20">
                    <Loader2 className="w-12 h-12 text-red-600 animate-spin" />
                </div>
            )}

            {/* Big Play Button (when paused) */}
            {!isPlaying && !isLoading && (
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                    <button
                        onClick={(e) => {
                            e.stopPropagation(); // Stop propagation to avoid double-toggling if container also handles click
                            togglePlay();
                        }}
                        className="w-20 h-20 bg-black/60 rounded-full flex items-center justify-center pl-2 shadow-2xl border border-white/10 group-hover:scale-110 transition-transform duration-300 cursor-pointer hover:bg-white/20"
                    >
                        <Play className="text-white w-10 h-10 fill-white" />
                    </button>
                </div>
            )}

            {/* Skip Intro Button */}
            {currentTime < 300 && !skippedIntro && !isLoading && isPlaying && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        setSkippedIntro(true); // Hide after one use
                        if (videoRef.current) {
                            videoRef.current.currentTime += 90; // Standard Intro (1m30s)
                        }
                    }}
                    className="absolute bottom-24 right-6 z-40 bg-white/10 hover:bg-red-600 text-white px-5 py-2.5 rounded-lg backdrop-blur-md border border-white/10 transition-all duration-300 hover:scale-105 flex items-center gap-2 font-bold text-sm group animate-in slide-in-from-right-10 fade-in shadow-lg"
                >
                    <span>Bỏ qua Mở đầu</span>
                    <SkipForward size={18} className="group-hover:translate-x-1 transition-transform" />
                </button>
            )}

            {/* Controls Overlay */}
            <div
                className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-4 pt-16 transition-opacity duration-300 z-30 ${showControls ? 'opacity-100' : 'opacity-0'}`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Progress Bar */}
                <div className="relative w-full h-1.5 group/progress cursor-pointer mb-4 flex items-center">
                    <div className="absolute top-0 left-0 h-full w-full bg-gray-600/40 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-gray-400/40"
                            style={{ width: `${buffered}%` }}
                        />
                    </div>
                    <div
                        className="absolute top-0 left-0 h-full bg-red-600 rounded-full"
                        style={{ width: `${(currentTime / duration) * 100}%` }}
                    />
                    {/* Draggable Knob */}
                    <div
                        className="absolute w-4 h-4 bg-red-600 rounded-full shadow-lg scale-0 group-hover/progress:scale-100 transition-transform duration-200 pointer-events-none"
                        style={{ left: `calc(${(currentTime / duration) * 100}% - 8px)` }}
                    />
                    <input
                        type="range"
                        min={0}
                        max={duration || 100}
                        step="0.1"
                        value={currentTime}
                        onChange={handleSeek}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                </div>

                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <button onClick={togglePlay} className="text-white hover:text-red-500 transition-colors">
                            {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" />}
                        </button>

                        <div className="flex items-center gap-2 group/volume">
                            <button onClick={toggleMute} className="text-white hover:text-gray-300 transition-colors">
                                {isMuted || volume === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />}
                            </button>
                            <div className="w-0 overflow-hidden group-hover/volume:w-24 transition-all duration-300 flex items-center">
                                <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.1}
                                    value={isMuted ? 0 : volume}
                                    onChange={handleVolumeChange}
                                    className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-red-600 ml-2"
                                />
                            </div>
                        </div>

                        <div className="text-sm font-medium text-gray-300 font-mono tracking-wider">
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        {onNextEpisode && (
                            <button
                                onClick={onNextEpisode}
                                className="flex items-center gap-2 bg-white/10 hover:bg-red-600 text-white text-sm px-2 sm:px-4 py-1.5 rounded-lg backdrop-blur-sm transition-all border border-white/10"
                            >
                                <SkipForward size={16} fill="white" />
                                <span className="font-bold hidden sm:inline"> Tập Tiếp</span>
                            </button>
                        )}

                        {/* Max Quality Badge */}
                        {qualityOptions.length > 0 && (
                            <div className="hidden sm:flex items-center px-2 py-1 rounded bg-white/5 text-[10px] font-bold text-gray-400 border border-white/5 uppercase tracking-wider backdrop-blur-sm select-none">
                                {qualityOptions[0].label === '4K' ? <span className="text-yellow-500 drop-shadow-sm">4K ULTRA</span> :
                                    qualityOptions[0].label === '2K' ? <span className="text-blue-400 drop-shadow-sm">2K QHD</span> :
                                        qualityOptions[0].label === '1080p' ? <span className="text-red-500 drop-shadow-sm">FHD</span> :
                                            <span className="text-white">{qualityOptions[0].label}</span>}
                            </div>
                        )}

                        <div className="relative group/settings">
                            <button
                                onClick={toggleSettings}
                                className={`text-white hover:text-red-500 transition-colors p-2 rounded-full hover:bg-white/10 ${showSettings ? 'text-red-500 bg-white/10' : ''}`}
                            >
                                <Settings size={22} className={`transition-transform duration-500 ease-out ${showSettings ? 'rotate-90' : 'group-hover/settings:rotate-45'}`} />
                            </button>

                            {/* Settings Menu Popup */}
                            {showSettings && (
                                <div className="absolute bottom-full right-0 mb-4 bg-black/90 backdrop-blur-md rounded-xl border border-white/10 p-4 w-64 shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-200 z-50">
                                    <h4 className="text-white font-bold text-sm mb-3 border-b border-gray-700/50 pb-2 flex items-center gap-2">
                                        <Settings size={14} className="text-red-500" /> Cài đặt phát
                                    </h4>

                                    <div className="space-y-4">
                                        {/* Speed Controller */}
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Tốc độ</p>
                                                <span className="text-xs text-red-500 font-bold">{playbackSpeed}x</span>
                                            </div>
                                            <div className="grid grid-cols-5 gap-1.5">
                                                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
                                                    <button
                                                        key={speed}
                                                        onClick={() => changePlaybackSpeed(speed)}
                                                        className={`
                                                            px-1 py-1.5 rounded-md text-[10px] font-bold transition-all border
                                                            ${playbackSpeed === speed
                                                                ? 'bg-red-600 text-white border-red-500 shadow-lg shadow-red-900/50 scale-105'
                                                                : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-white hover:border-gray-500'}
                                                        `}
                                                    >
                                                        {speed}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Quality Controller */}
                                        <div>
                                            <div className="flex justify-between items-center mb-2">
                                                <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Chất lượng</p>
                                                <span className="text-xs text-blue-500 font-bold">
                                                    {currentQuality === -1 ? 'Auto' : qualityOptions.find(q => q.index === currentQuality)?.label || 'Unknown'}
                                                </span>
                                            </div>

                                            {qualityOptions.length > 0 ? (
                                                <div className="grid grid-cols-3 gap-1.5">
                                                    <button
                                                        onClick={() => changeQuality(-1)}
                                                        className={`
                                                            px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border flex items-center justify-center gap-1
                                                            ${currentQuality === -1
                                                                ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/50'
                                                                : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-white'}
                                                        `}
                                                    >
                                                        Auto
                                                    </button>
                                                    {qualityOptions.map((q) => (
                                                        <button
                                                            key={q.index}
                                                            onClick={() => changeQuality(q.index)}
                                                            className={`
                                                                px-2 py-1.5 rounded-md text-[10px] font-bold transition-all border
                                                                ${currentQuality === q.index
                                                                    ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-900/50'
                                                                    : 'bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-white'}
                                                            `}
                                                        >
                                                            {q.label}
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-gray-500 text-center italic py-2 bg-gray-800/30 rounded border border-gray-800">
                                                    Mặc định (Auto)
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <button onClick={toggleFullscreen} className="text-white hover:text-gray-300 transition-colors p-2 hover:bg-white/10 rounded-full">
                            {isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
