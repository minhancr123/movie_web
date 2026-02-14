'use client';

import { useEffect, useState, useRef } from 'react';
import { getMovieDetail } from '@/lib/api';
import Hls from 'hls.js';

interface LiveVideoPlayerProps {
  movieSlug: string;
  premiereStartTime: string;
  movieName: string;
}

interface Episode {
  server_name: string;
  server_data: Array<{
    name: string;
    slug: string;
    filename: string;
    link_embed: string;
    link_m3u8: string;
  }>;
}

export default function LiveVideoPlayer({ movieSlug, premiereStartTime, movieName }: LiveVideoPlayerProps) {
  const [elapsedTime, setElapsedTime] = useState(0);
  const [videoData, setVideoData] = useState<{
    embedUrl: string;
    m3u8Url: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [videoError, setVideoError] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentQuality, setCurrentQuality] = useState<number>(-1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isMuted, setIsMuted] = useState(true); // Start muted for autoplay
  const [isPiP, setIsPiP] = useState(false);
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout>();
  const containerRef = useRef<HTMLDivElement>(null);
  const hideControlsTimeoutRef = useRef<NodeJS.Timeout>();

  // Calculate elapsed time since premiere started
  useEffect(() => {
    const calculateElapsed = () => {
      const startTime = new Date(premiereStartTime).getTime();
      const now = Date.now();
      const elapsed = Math.max(0, Math.floor((now - startTime) / 1000));
      setElapsedTime(elapsed);
    };

    calculateElapsed();
    const interval = setInterval(calculateElapsed, 1000);
    return () => clearInterval(interval);
  }, [premiereStartTime]);

  // Fetch movie data
  useEffect(() => {
    const fetchMovie = async () => {
      try {
        const movie = await getMovieDetail(movieSlug);

        console.log('Full movie data:', movie);
        console.log('All episodes:', movie?.episodes);

        if (movie?.episodes && movie.episodes.length > 0) {
          // Thử tìm server có link m3u8 hoặc embed tốt nhất
          let bestEpisode = null;

          for (const server of movie.episodes as Episode[]) {
            console.log('Server:', server.server_name, server.server_data);

            if (server.server_data && server.server_data.length > 0) {
              const episode = server.server_data[0];

              // Ưu tiên server có m3u8 URL khác hoặc embed URL tốt
              if (episode.link_m3u8 && !episode.link_m3u8.includes('phim1280.tv')) {
                bestEpisode = episode;
                console.log('Found better server:', server.server_name);
                break;
              }

              if (!bestEpisode) {
                bestEpisode = episode;
              }
            }
          }

          if (bestEpisode) {
            console.log('Using video source:', {
              embed: bestEpisode.link_embed,
              m3u8: bestEpisode.link_m3u8
            });

            // Kiểm tra nếu link có chứa domain đã biết bị lỗi
            const isBrokenSource = bestEpisode.link_m3u8?.includes('phim1280.tv');

            if (isBrokenSource) {
              console.warn('⚠️ Video source từ phim1280.tv có thể không hoạt động');
            }

            setVideoData({
              embedUrl: bestEpisode.link_embed || '',
              m3u8Url: bestEpisode.link_m3u8 || ''
            });
          } else {
            setVideoError(true);
          }
        }
      } catch (error) {
        console.error('Error fetching movie:', error);
        setVideoError(true);
      } finally {
        setLoading(false);
      }
    };

    fetchMovie();
  }, [movieSlug]);

  // Setup HLS player and sync time
  useEffect(() => {
    if (!videoData?.m3u8Url || !videoRef.current) return;

    const video = videoRef.current;

    // Cleanup previous HLS instance
    if (hlsRef.current) {
      hlsRef.current.destroy();
    }

    if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 90,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });

      hlsRef.current = hls;
      hls.loadSource(videoData.m3u8Url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        console.log('✅ HLS manifest loaded, levels:', hls.levels.length);

        // Start muted for autoplay to work
        video.muted = true;

        // Auto play
        video.play()
          .then(() => {
            setIsPlaying(true);
            // Auto unmute after user has "interacted"
            setTimeout(() => {
              if (video) {
                video.muted = false;
                setIsMuted(false);
              }
            }, 100);
          })
          .catch(err => {
            console.warn('⚠️ Autoplay blocked:', err);
            setIsPlaying(false);
          });
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error('❌ HLS Fatal Error:', data);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.log('🔄 Network error, recovering...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.log('🔄 Media error, recovering...');
              hls.recoverMediaError();
              break;
            default:
              setVideoError(true);
              hls.destroy();
              break;
          }
        }
      });

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari)
      video.src = videoData.m3u8Url;
      video.addEventListener('loadedmetadata', () => {
        video.play()
          .then(() => {
            setIsPlaying(true);
            syncToLiveTime();
          })
          .catch(err => {
            console.warn('Autoplay blocked:', err);
            setIsPlaying(false);
          });
      });
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [videoData, premiereStartTime]);

  // Sync video to live time every 10 seconds
  const syncToLiveTime = () => {
    if (!videoRef.current) return;

    const video = videoRef.current;
    const targetTime = Math.max(0, Math.floor((Date.now() - new Date(premiereStartTime).getTime()) / 1000));

    // Check if premiere ended
    if (video.duration && video.duration > 0 && targetTime >= video.duration) {
      if (!isEnded) {
        setIsEnded(true);
        setIsPlaying(false);
        video.pause();
        console.log('🏁 Premiere ended');
      }
      return;
    }

    // Only sync if video is more than 5 seconds behind
    const timeDiff = Math.abs(video.currentTime - targetTime);
    if (timeDiff > 5) {
      video.currentTime = targetTime;
      console.log(`⏩ Synced to ${targetTime}s (diff: ${timeDiff.toFixed(1)}s)`);
    }

    // Setup interval to auto-sync every 10 seconds
    if (syncIntervalRef.current) {
      clearInterval(syncIntervalRef.current);
    }
    syncIntervalRef.current = setInterval(() => {
      const currentTargetTime = Math.max(0, Math.floor((Date.now() - new Date(premiereStartTime).getTime()) / 1000));

      if (video.duration && video.duration > 0 && currentTargetTime >= video.duration) {
        setIsEnded(true);
        setIsPlaying(false);
        video.pause();
        clearInterval(syncIntervalRef.current);
        return;
      }

      const currentDiff = Math.abs(video.currentTime - currentTargetTime);
      if (currentDiff > 5 && !video.paused) {
        video.currentTime = currentTargetTime;
        console.log(`🔄 Auto-synced to ${currentTargetTime}s`);
      }
    }, 10000);
  };

  // Handle play/pause
  const togglePlay = () => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
        syncToLiveTime(); // Re-sync when resuming
      });
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  };

  // Handle volume change
  const handleVolumeChange = (newVolume: number) => {
    if (!videoRef.current) return;
    videoRef.current.volume = newVolume;
    videoRef.current.muted = false;
    setVolume(newVolume);
    setIsMuted(false);
  };

  // Handle quality change
  const changeQuality = (levelIndex: number) => {
    if (!hlsRef.current) return;
    hlsRef.current.currentLevel = levelIndex;
    setCurrentQuality(levelIndex);
    console.log(`📺 Quality changed to level ${levelIndex}`);
  };

  // Resync to live (for user manual sync button)
  const resyncToLive = () => {
    syncToLiveTime();
  };

  // Prevent seeking
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const preventSeek = (e: Event) => {
      e.preventDefault();
      syncToLiveTime(); // Force sync back to live time
    };

    video.addEventListener('seeking', preventSeek);
    return () => video.removeEventListener('seeking', preventSeek);
  }, [premiereStartTime]);

  // Handle fullscreen change
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error('Error entering fullscreen:', err);
      });
    } else {
      document.exitFullscreen();
    }
  };

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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key.toLowerCase()) {
        case '?':
          e.preventDefault();
          setShowKeyboardHelp(!showKeyboardHelp);
          break;
        case ' ':
        case 'k':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          handleVolumeChange(volume === 0 ? 1 : 0);
          break;
        case 'i':
          e.preventDefault();
          togglePiP();
          break;
        case 'arrowup':
          e.preventDefault();
          handleVolumeChange(Math.min(1, volume + 0.1));
          break;
        case 'arrowdown':
          e.preventDefault();
          handleVolumeChange(Math.max(0, volume - 0.1));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [volume, isPlaying, showKeyboardHelp]);

  // Auto-hide controls after 3 seconds of inactivity
  const handleMouseMove = () => {
    setShowControls(true);

    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
    }

    hideControlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 3000);
  };

  // Show controls when paused
  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      if (hideControlsTimeoutRef.current) {
        clearTimeout(hideControlsTimeoutRef.current);
      }
    }
  }, [isPlaying]);

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white text-lg">Đang tải video...</p>
        </div>
      </div>
    );
  }

  if (!videoData) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center">
        <p className="text-white">Không tìm thấy video</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-black"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => isPlaying && setShowControls(false)}
    >
      {/* Keyboard Shortcuts Help Modal */}
      {showKeyboardHelp && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-gray-900 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-white/10">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white text-xl font-bold flex items-center gap-2">
                <span>⌨️</span>
                Phím tắt
              </h3>
              <button
                onClick={() => setShowKeyboardHelp(false)}
                className="text-gray-400 hover:text-white transition"
              >
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
                <span className="text-gray-300">Tắt / Bật âm thanh</span>
                <kbd className="bg-white/10 px-3 py-1 rounded text-white">M</kbd>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-300">Tăng âm lượng</span>
                <kbd className="bg-white/10 px-3 py-1 rounded text-white">↑</kbd>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-300">Giảm âm lượng</span>
                <kbd className="bg-white/10 px-3 py-1 rounded text-white">↓</kbd>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-gray-300">Hiện bảng này</span>
                <kbd className="bg-white/10 px-3 py-1 rounded text-white">?</kbd>
              </div>
            </div>

            <div className="mt-6 text-center">
              <button
                onClick={() => setShowKeyboardHelp(false)}
                className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-full font-semibold transition"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Help Hint */}
      <div className={`absolute top-4 right-4 z-20 bg-black/60 backdrop-blur-sm rounded-lg px-3 py-1.5 text-white text-xs transition-opacity ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <button
          onClick={() => setShowKeyboardHelp(true)}
          className="hover:text-red-400 transition"
        >
          Press <kbd className="bg-white/20 px-1.5 py-0.5 rounded mx-1">?</kbd> for shortcuts
        </button>
      </div>

      {/* Time indicator - Always visible */}
      <div className={`absolute top-4 right-4 z-50 bg-black/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-red-500/50 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0'}`}>
        <p className="text-white text-sm font-mono">
          <span className="text-red-500 animate-pulse">●</span> LIVE • {formatTime(elapsedTime)}
        </p>
      </div>

      {/* Error overlay */}
      {videoError && (
        <div className="absolute inset-0 z-40 bg-black/90 flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <div className="text-red-500 text-6xl mb-4">⚠️</div>
            <h3 className="text-white text-xl font-bold mb-2">Nguồn video không khả dụng</h3>
            <p className="text-gray-400 mb-4">
              Video không thể phát. Vui lòng thử lại sau hoặc liên hệ quản trị viên.
            </p>
            <div className="flex gap-2 justify-center">
              <button
                onClick={() => window.location.reload()}
                className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg transition"
              >
                Tải lại
              </button>
              <button
                onClick={() => window.history.back()}
                className="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded-lg transition"
              >
                Quay lại
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Premiere Ended Overlay */}
      {isEnded && (
        <div className="absolute inset-0 z-50 bg-black/95 flex items-center justify-center p-8">
          <div className="text-center max-w-md animate-in fade-in zoom-in duration-500">
            <div className="text-gray-500 text-6xl mb-6">🏁</div>
            <h3 className="text-3xl md:text-4xl font-bold text-white mb-4">Buổi công chiếu đã kết thúc</h3>
            <p className="text-gray-400 text-lg mb-8">
              Cảm ơn bạn đã tham gia buổi công chiếu phim
              <span className="text-red-500 font-bold block mt-2">"{movieName}"</span>
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => window.location.href = `/phim/${movieSlug}`}
                className="bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded-full font-bold text-lg transition shadow-lg shadow-red-900/50 hover:scale-105"
              >
                Xem lại phim
              </button>
              <button
                onClick={() => window.location.href = '/cong-chieu'}
                className="text-gray-400 hover:text-white text-sm mt-2 transition"
              >
                Xem các sự kiện khác
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HLS Video Player - NO NATIVE CONTROLS */}
      {videoData && !videoError && (
        <>
          <video
            ref={videoRef}
            className="w-full h-full object-contain bg-black"
            playsInline
            autoPlay
            onLoadedMetadata={() => {
              console.log('🎬 Metadata loaded, forcing sync...');
              syncToLiveTime();
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          >
            <source src={videoData.m3u8Url} type="application/x-mpegURL" />
          </video>

          {/* Custom Controls Overlay - Auto-hide */}
          <div className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black via-black/80 to-transparent p-4 z-30 transition-all duration-300 ${showControls ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`}>
            <div className="flex items-center justify-between gap-4">
              {/* Left: Play/Pause & Resync */}
              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlay}
                  className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center transition"
                  title={isPlaying ? 'Tạm dừng' : 'Phát'}
                >
                  {isPlaying ? (
                    <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M5 4h3v12H5V4zm7 0h3v12h-3V4z" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M6 4l10 6-10 6V4z" />
                    </svg>
                  )}
                </button>

                <button
                  onClick={resyncToLive}
                  className="px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 backdrop-blur-sm text-white text-xs font-semibold transition flex items-center gap-1.5"
                  title="Đồng bộ lại với phát trực tiếp"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="hidden sm:inline">Đồng bộ</span>
                </button>
              </div>

              {/* Center: Live indicator */}
              <div className="flex-1 text-center">
                <span className="text-red-500 text-xs font-semibold">🔴 ĐANG PHÁT TRỰC TIẾP</span>
              </div>

              {/* Right: Volume & Quality */}
              <div className="flex items-center gap-3">
                {/* Unmute button if muted */}
                {isMuted && (
                  <button
                    onClick={() => {
                      if (videoRef.current) {
                        videoRef.current.muted = false;
                        setIsMuted(false);
                        setVolume(1);
                        videoRef.current.volume = 1;
                      }
                    }}
                    className="px-3 py-2 rounded-lg bg-yellow-600/80 hover:bg-yellow-600 backdrop-blur-sm text-white text-xs font-semibold transition flex items-center gap-1.5 animate-pulse"
                    title="Bật âm thanh"
                  >
                    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" />
                    </svg>
                    <span>Bật âm thanh</span>
                  </button>
                )}

                {/* Volume */}
                <div className="hidden md:flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-lg px-3 py-2">
                  <button onClick={() => handleVolumeChange(volume === 0 ? 1 : 0)}>
                    {volume === 0 ? (
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" />
                      </svg>
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-20 accent-red-600"
                  />
                </div>

                {/* Quality Selector */}
                {hlsRef.current && hlsRef.current.levels.length > 1 && (
                  <select
                    value={currentQuality}
                    onChange={(e) => changeQuality(parseInt(e.target.value))}
                    className="bg-white/10 backdrop-blur-sm text-white text-xs rounded-lg px-2 py-1.5 border border-white/20 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value={-1}>Tự động</option>
                    {hlsRef.current.levels.map((level, index) => (
                      <option key={index} value={index}>
                        {level.height}p
                      </option>
                    ))}
                  </select>
                )}

                {/* Fullscreen */}
                <button
                  onClick={toggleFullscreen}
                  className="w-10 h-10 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center transition"
                  title={isFullscreen ? 'Thoát toàn màn hình (F)' : 'Toàn màn hình (F)'}
                >
                  {isFullscreen ? (
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                    </svg>
                  )}
                </button>

                {/* Picture-in-Picture */}
                <button
                  onClick={togglePiP}
                  className={`w-10 h-10 rounded-full backdrop-blur-sm flex items-center justify-center transition ${isPiP ? 'bg-blue-600/80 hover:bg-blue-600' : 'bg-white/20 hover:bg-white/30'}`}
                  title={isPiP ? 'Thoát PiP (I)' : 'Picture-in-Picture (I)'}
                >
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zm12.553 1.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
