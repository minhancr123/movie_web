'use client';
import { Play, Pause, Maximize, Volume2, VolumeX, RotateCcw } from 'lucide-react';

interface CustomControlsProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isPlaying: boolean;
  setIsPlaying: (playing: boolean) => void;
  onNextEpisode?: () => void;
  onSkipIntro?: () => void;
}

export const CustomControls = ({ videoRef, isPlaying, setIsPlaying, onNextEpisode, onSkipIntro }: CustomControlsProps) => {
  const togglePlay = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
        if (!document.fullscreenElement) {
            videoRef.current.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    }
  };

  return (
    <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-black/80 to-transparent p-4 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-300">
       <div className="flex gap-4">
          <button onClick={togglePlay} className="text-white hover:text-red-500">
             {isPlaying ? <Pause size={24} /> : <Play size={24} />}
          </button>
          <button onClick={() => { if(videoRef.current) videoRef.current.currentTime -= 10; }} className="text-white hover:text-gray-300">
             <RotateCcw size={20} /> <span className="text-xs">10s</span>
          </button>
       </div>
       
       <div className="flex gap-4">
          {onSkipIntro && (
              <button 
                onClick={onSkipIntro}
                className="bg-white/20 hover:bg-white/40 text-white text-xs px-3 py-1 rounded backdrop-blur-sm transition-colors"
                >
                Bỏ qua Intro
              </button>
          )}

          {onNextEpisode && (
              <button 
                onClick={onNextEpisode}
                className="bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1 rounded transition-colors"
                >
                Tập Tiếp
              </button>
          )}

          <button onClick={toggleFullscreen} className="text-white hover:text-gray-300">
             <Maximize size={24} />
          </button>
       </div>
    </div>
  );
}
