'use client';

import React, { useState } from 'react';
import VideoPlayer from './VideoPlayer';
import { useRouter } from 'next/navigation';

interface WatchSectionProps {
  embedUrl: string;
  m3u8Url: string;
  nextEpisodeSlug?: string | null;
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
}

export default function WatchSection({ embedUrl, m3u8Url, nextEpisodeSlug, movie, episode }: WatchSectionProps) {
  // Prefer HLS (direct) player for better features (Auto Next, Quality, Speed, Shortcuts)
  const [playerType, setPlayerType] = useState<'embed' | 'direct'>(m3u8Url ? 'direct' : 'embed');
  const router = useRouter();

  const handleNextEpisode = () => {
    if (nextEpisodeSlug) {
      router.push(`/xem-phim/${movie.slug}?tap=${nextEpisodeSlug}`);
    }
  };

  return (
    <div className="space-y-4">
      {/* Player Container */}
      <div className="w-full bg-black rounded-lg overflow-hidden relative shadow-2xl border border-white/10 aspect-video">
        {playerType === 'embed' ? (
          embedUrl ? (
            <iframe
              src={embedUrl}
              className="w-full h-full absolute top-0 left-0"
              frameBorder="0"
              allowFullScreen
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              referrerPolicy="no-referrer"
            ></iframe>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-cinema-subtle">
              <p>Không có link Embed.</p>
              <button
                onClick={() => setPlayerType('direct')}
                className="mt-2 text-amber-gold underline"
              >
                Thử player dự phòng
              </button>
            </div>
          )
        ) : (
          <VideoPlayer
            src={m3u8Url}
            movie={movie}
            episode={episode}
            onNextEpisode={nextEpisodeSlug ? handleNextEpisode : undefined}
          />
        )}
      </div>

      {/* Control / Info Bar */}
      <div className="bg-surface-container/50 p-4 rounded flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="text-sm text-cinema-subtle">
          <span className="font-bold text-cinema-text">Đang dùng:</span> {playerType === 'embed' ? 'Server gốc (Embed)' : 'Player dự phòng (HLS)'}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setPlayerType('embed')}
            className={`px-3 py-1 rounded text-sm font-bold transition-colors ${playerType === 'embed'
                ? 'bg-amber-primary text-black'
                : 'bg-surface-container-high text-cinema-muted hover:bg-surface-container-highest'
              }`}
          >
            Server Gốc
          </button>
          <button
            onClick={() => setPlayerType('direct')}
            className={`px-3 py-1 rounded text-sm font-bold transition-colors ${playerType === 'direct'
                ? 'bg-amber-primary text-black'
                : 'bg-surface-container-high text-cinema-muted hover:bg-surface-container-highest'
              }`}
          >
            Server Dự Phòng
          </button>
        </div>
      </div>

      <div className="text-xs text-cinema-subtle mt-2">
        <p>Nếu server này lỗi, hãy thử chuyển sang server khác hoặc đổi Tập phim.</p>
      </div>
    </div>
  );
}
