'use client';
import Link from 'next/link';
import Image from 'next/image';
import { Play, Info, ChevronLeft, ChevronRight } from 'lucide-react';
import { Movie } from '@/lib/api';
import { useState, useEffect } from 'react';

interface HeroSectionProps {
  movies: Movie[];
}

const HeroSection = ({ movies }: HeroSectionProps) => {
  const [currentIndex, setCurrentIndex] = useState(0);

  /* Parallax State */
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!movies || movies.length === 0) return;

    setProgress(0);
    const intervalTime = 6000;
    const updateFreq = 100;

    // Progress bar update
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) return 0;
        return prev + (100 / (intervalTime / updateFreq));
      });
    }, updateFreq);

    // Slide change
    const slideInterval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % movies.length);
      setProgress(0);
    }, intervalTime);

    // Clean up
    return () => {
      clearInterval(timer);
      clearInterval(slideInterval);
    };
  }, [movies, currentIndex]); // Reset whenever currentIndex changes by manual interaction too? Maybe better to just rely on interval.
  // The current dependency array [movies, currentIndex] effectively resets the timer on every slide change (auto or manual).
  // This is desired behavior: if I click next, I want the timer to restart for full 6 seconds.

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY, currentTarget } = e;
    const { width, height, left, top } = currentTarget.getBoundingClientRect();
    const x = (clientX - left) / width - 0.5;
    const y = (clientY - top) / height - 0.5;
    setMousePos({ x, y });
  };

  if (!movies || movies.length === 0) return null;

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev - 1 + movies.length) % movies.length);
    setProgress(0);
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev + 1) % movies.length);
    setProgress(0);
  };

  return (
    <div
      className="relative w-full h-[55vh] md:h-[75vh] rounded-2xl overflow-hidden mb-8 group shadow-2xl border border-gray-800/50 bg-[#0a0a0a]"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setMousePos({ x: 0, y: 0 })}
    >

      {movies.map((movie, index) => {
        const imagePrefix = process.env.NEXT_PUBLIC_IMAGE_PREFIX || 'https://phimimg.com/';
        const posterUrl = movie.poster_url.startsWith('http')
          ? movie.poster_url
          : `${imagePrefix}${movie.poster_url}`;

        // Use thumb for background (Landscape), fallback to poster
        const thumbUrl = movie.thumb_url.startsWith('http')
          ? movie.thumb_url
          : `${imagePrefix}${movie.thumb_url}`;

        const backgroundUrl = thumbUrl || posterUrl;
        const isActive = index === currentIndex;

        return (
          <div
            key={movie._id}
            className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${isActive ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
          >
            {/* Background Image with Parallax */}
            <div
              className="absolute inset-0 transition-transform duration-200 ease-out will-change-transform"
              style={{
                transform: isActive ? `scale(1.1) translate(${mousePos.x * -20}px, ${mousePos.y * -20}px)` : 'none'
              }}
            >
              <Image
                src={backgroundUrl}
                alt={movie.name}
                fill
                className="object-cover object-center"
                priority={index === 0}
                sizes="100vw"
              />

              {/* Complex Gradient Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-[#0e0e0e] via-black/40 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#0e0e0e] via-[#0e0e0e]/70 to-transparent" />
              <div className="absolute inset-0 bg-black/10" />
            </div>

            {/* Content with 3D-ish entry */}
            <div className="absolute bottom-0 left-0 p-6 md:p-16 w-full md:w-3/4 lg:w-2/3 flex flex-col justify-end h-full z-20">
              <div
                className={`flex items-center gap-3 mb-4 transition-all duration-700 delay-100 ${isActive ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-10 opacity-0 blur-sm'
                  }`}
                style={{
                  transform: isActive ? `translate(${mousePos.x * -10}px, ${mousePos.y * -10}px)` : undefined
                }}
              >
                <span className="px-3 py-1 bg-red-600 text-white text-xs font-bold rounded uppercase tracking-wider shadow-lg shadow-red-600/20 animate-pulse">
                  Phim Mới
                </span>
                <span className="px-3 py-1 bg-white/10 backdrop-blur text-white text-xs font-bold rounded border border-white/20">
                  {movie.year}
                </span>
                <span className="px-3 py-1 bg-yellow-500/20 text-yellow-400 text-xs font-bold rounded border border-yellow-500/20">
                  VIP
                </span>
              </div>

              <h2
                className={`text-3xl md:text-6xl lg:text-7xl font-extrabold text-white mb-2 md:mb-4 leading-snug drop-shadow-xl tracking-tight line-clamp-2 pb-1 transition-all duration-700 delay-200 ${isActive ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-10 opacity-0 blur-sm'
                  }`}
                style={{
                  transform: isActive ? `translate(${mousePos.x * -5}px, ${mousePos.y * -5}px)` : undefined
                }}
              >
                {movie.name}
              </h2>

              <h3
                className={`text-lg md:text-2xl text-gray-300 mb-4 md:mb-6 font-medium italic drop-shadow-md line-clamp-1 transition-all duration-700 delay-300 ${isActive ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-10 opacity-0 blur-sm'
                  }`}
              >
                {movie.origin_name}
              </h3>

              <div className={`flex flex-wrap gap-2 md:gap-3 lg:gap-4 mt-2 transition-all duration-700 delay-400 ${isActive ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
                <Link
                  href={`/phim/${movie.slug}`}
                  className="group/btn flex items-center gap-1.5 md:gap-2 lg:gap-2.5 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 md:px-5 md:py-2.5 lg:px-7 lg:py-3 rounded-full font-bold transition-all transform hover:-translate-y-1 shadow-lg shadow-red-600/30 text-[11px] md:text-sm lg:text-base tracking-wide"
                >
                  <div className="bg-white rounded-full p-1 group-hover/btn:scale-110 transition-transform">
                    <Play fill="red" className="text-red-600 w-3 h-3 md:w-3 md:h-3" />
                  </div>
                  XEM NGAY
                </Link>
                <Link
                  href={`/phim/${movie.slug}`}
                  className="flex items-center gap-1.5 md:gap-2 lg:gap-2.5 bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 md:px-5 md:py-2.5 lg:px-7 lg:py-3 rounded-full font-bold backdrop-blur-md border border-white/10 transition-all hover:border-white/30 text-[11px] md:text-sm lg:text-base tracking-wide"
                >
                  <Info size={12} className="md:w-4 md:h-4 lg:w-5 lg:h-5" />
                  CHI TIẾT
                </Link>
              </div>
            </div>
          </div>
        );
      })}

      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 w-full h-1 bg-white/10 z-50">
        <div
          className="h-full bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.8)] transition-all duration-100 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Navigation Buttons (Hidden on mobile, visible on group hover) */}
      <button
        onClick={handlePrev}
        className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 z-30 p-2 md:p-3 bg-black/30 hover:bg-red-600/80 text-white rounded-full backdrop-blur-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-300 block border border-white/10 hover:border-red-500 hover:shadow-lg hover:shadow-red-500/20"
      >
        <ChevronLeft size={24} />
      </button>

      <button
        onClick={handleNext}
        className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 z-30 p-2 md:p-3 bg-black/30 hover:bg-red-600/80 text-white rounded-full backdrop-blur-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-300 block border border-white/10 hover:border-red-500 hover:shadow-lg hover:shadow-red-500/20"
      >
        <ChevronRight size={24} />
      </button>

      {/* Pagination - Thumbnails (Desktop) */}
      <div className="absolute bottom-8 right-8 z-30 hidden md:flex gap-3 items-end">
        {movies.map((movie, idx) => {
          const isActive = idx === currentIndex;
          const imagePrefix = process.env.NEXT_PUBLIC_IMAGE_PREFIX || 'https://phimimg.com/';
          const thumb = movie.thumb_url.startsWith('http') ? movie.thumb_url : `${imagePrefix}${movie.thumb_url}`;

          return (
            <button
              key={idx}
              onClick={() => {
                setCurrentIndex(idx);
                setProgress(0);
              }}
              className={`relative overflow-hidden rounded-lg transition-all duration-300 border-2 group/thumb ${isActive
                ? 'w-28 h-16 border-red-600 shadow-lg shadow-red-600/50 scale-110 z-10'
                : 'w-16 h-10 border-white/30 grayscale hover:grayscale-0 hover:border-white opacity-70 hover:opacity-100'
                }`}
            >
              <Image
                src={thumb}
                alt={movie.name}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100px, 150px"
              />
              {/* Progress overlay on thumbnail */}
              {isActive && (
                <div className="absolute inset-0 bg-red-600/20" />
              )}
            </button>
          );
        })}
      </div>

      {/* Pagination - Dots (Mobile) */}
      <div className="absolute bottom-4 right-4 z-30 flex gap-2 md:hidden">
        {movies.map((_, idx) => (
          <button
            key={idx}
            onClick={() => {
              setCurrentIndex(idx);
              setProgress(0);
            }}
            className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? 'bg-red-600 w-6 shadow shadow-red-600' : 'bg-gray-500/50 w-2'
              }`}
          />
        ))}
      </div>
    </div>
  );
};

export default HeroSection;
