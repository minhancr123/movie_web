'use client';

import { useEffect, useRef, useState } from 'react';

interface EmbedPlayerProps {
  embedUrl: string;
  m3u8Url: string;
  movieName: string;
  startTime: number;
}

export default function EmbedPlayer({ embedUrl, m3u8Url, movieName, startTime }: EmbedPlayerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [playerType, setPlayerType] = useState<'embed' | 'direct'>('embed');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Try to load player
    const timer = setTimeout(() => {
      setLoading(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  // Auto-play when loaded
  useEffect(() => {
    if (!loading && iframeRef.current) {
      try {
        // Try to send play command to iframe
        iframeRef.current.contentWindow?.postMessage({ 
          type: 'PLAY',
          time: startTime 
        }, '*');
      } catch (error) {
        console.error('Cannot control iframe player:', error);
      }
    }
  }, [loading, startTime]);

  return (
    <div className="w-screen h-screen bg-black relative">
      {/* Loading indicator */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center z-50 bg-black">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-white text-lg">Đang tải player...</p>
          </div>
        </div>
      )}

      {/* Time sync indicator */}
      {startTime > 0 && !loading && (
        <div className="absolute top-4 left-4 bg-red-600/90 backdrop-blur-sm px-4 py-2 rounded-lg z-40">
          <p className="text-white text-xs font-bold">
            ⏱ Đồng bộ: {Math.floor(startTime / 60)}:{String(startTime % 60).padStart(2, '0')}
          </p>
        </div>
      )}

      {/* Player type toggle */}
      <div className="absolute top-4 right-4 z-40 flex gap-2">
        <button
          onClick={() => setPlayerType('embed')}
          className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
            playerType === 'embed' 
              ? 'bg-red-600 text-white' 
              : 'bg-white/20 text-white hover:bg-white/30'
          }`}
        >
          Embed
        </button>
        {m3u8Url && (
          <button
            onClick={() => setPlayerType('direct')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
              playerType === 'direct' 
                ? 'bg-red-600 text-white' 
                : 'bg-white/20 text-white hover:bg-white/30'
            }`}
          >
            Direct
          </button>
        )}
      </div>

      {/* Video Player */}
      {playerType === 'embed' && embedUrl ? (
        <iframe
          ref={iframeRef}
          src={`${embedUrl}${startTime > 0 ? `#t=${startTime}` : ''}`}
          className="w-full h-full border-0"
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media; accelerometer; gyroscope"
          title={movieName}
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
        />
      ) : m3u8Url ? (
        <video
          className="w-full h-full"
          controls
          autoPlay
          playsInline
          onLoadedMetadata={(e) => {
            const video = e.currentTarget;
            if (startTime > 0) {
              video.currentTime = startTime;
            }
            video.play().catch(err => console.error('Auto-play failed:', err));
          }}
        >
          <source src={m3u8Url} type="application/x-mpegURL" />
          Trình duyệt không hỗ trợ video này
        </video>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white">
          <p>Không có nguồn video khả dụng</p>
        </div>
      )}
    </div>
  );
}
