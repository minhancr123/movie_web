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
  const [playerType, setPlayerType] = useState<'embed' | 'direct'>('embed');
  const router = useRouter();

  const handleNextEpisode = () => {
      if (nextEpisodeSlug) {
          router.push(`/xem-phim/${movie.slug}?tap=${nextEpisodeSlug}`);
      }
  };

  return (
    <div className="space-y-4">
      {/* Player Container */}
      <div className="aspect-video w-full bg-black rounded-lg overflow-hidden relative shadow-2xl border border-gray-800">
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
             <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <p>Không có link Embed.</p>
                <button 
                  onClick={() => setPlayerType('direct')}
                  className="mt-2 text-red-500 underline"
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
      <div className="bg-gray-800/50 p-4 rounded flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="text-sm text-gray-400">
              <span className="font-bold text-gray-200">Đang dùng:</span> {playerType === 'embed' ? 'Server gốc (Embed)' : 'Player dự phòng (HLS)'}
          </div>
          
          <div className="flex gap-2">
            <button
                onClick={() => setPlayerType('embed')}
                className={`px-3 py-1 rounded text-sm font-bold transition-colors ${
                    playerType === 'embed' 
                    ? 'bg-red-600 text-white' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
            >
                Server Gốc
            </button>
            <button
                onClick={() => setPlayerType('direct')}
                className={`px-3 py-1 rounded text-sm font-bold transition-colors ${
                    playerType === 'direct' 
                    ? 'bg-red-600 text-white' 
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
            >
                Server Dự Phòng
            </button>
            {m3u8Url && (
              <a 
                href={m3u8Url} 
                target="_blank" 
                rel="noopener noreferrer"
                className="px-3 py-1 rounded text-sm font-bold bg-gray-700 text-gray-300 hover:bg-gray-600"
              >
                Tải M3U8
              </a>
            )}
          </div>
      </div>
      
      <div className="text-xs text-gray-500 mt-2">
        <p>Nếu server này lỗi, hãy thử chuyển sang server khác hoặc đổi Tập phim.</p>
      </div>
    </div>
  );
}
