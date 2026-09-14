'use client';
import Link from 'next/link';
import Image from 'next/image';
import { Play, Info, ChevronLeft, ChevronRight } from 'lucide-react';
import { Movie } from '@/lib/api';
import { useState, useEffect } from 'react';

// `href` lets the caller supply the canonical URL. The TMDB catalog uses
// /phim/{type}/{tmdbId}/{slug}, which cannot be derived from a slug alone.
export type HeroMovie = Movie & { href?: string };

interface HeroSectionProps {
  movies: HeroMovie[];
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
      className="spatial-stage relative w-full h-[60vh] md:h-[80vh] rounded-3xl overflow-hidden mb-12 group shadow-glass-card border border-white/10 bg-surface"
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

              {/* Cinematic Vignette Overlay */}
              <div className="absolute inset-0 hero-vignette" />
              <div className="absolute inset-0 bg-black/20 mix-blend-overlay" />
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
                <span className="px-4 py-1.5 bg-amber-primary/20 text-amber-gold font-mono text-label-md rounded-full uppercase border border-amber-primary/40 shadow-amber-glow animate-pulse-slow">
                  Phim Mới
                </span>
                <span className="px-4 py-1.5 glass-panel text-cinema-text font-mono text-label-md rounded-full">
                  {movie.year}
                </span>
                <span className="px-4 py-1.5 bg-cyan-accent/10 text-cyan-accent font-mono text-label-md rounded-full border border-cyan-accent/30 uppercase">
                  4K HDR
                </span>
              </div>

              <h2
                className={`font-syne text-display-hero-mobile md:text-display-hero lg:text-7xl text-white mb-2 md:mb-4 drop-shadow-xl line-clamp-2 pb-1 transition-all duration-700 delay-200 ${isActive ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-10 opacity-0 blur-sm'
                  }`}
                style={{
                  transform: isActive ? `translate(${mousePos.x * -5}px, ${mousePos.y * -5}px)` : undefined
                }}
              >
                {movie.name}
              </h2>

              <h3
                className={`text-body-lg md:text-headline-md text-cinema-muted mb-4 md:mb-6 font-medium drop-shadow-md line-clamp-1 transition-all duration-700 delay-300 ${isActive ? 'translate-y-0 opacity-100 blur-0' : 'translate-y-10 opacity-0 blur-sm'
                  }`}
              >
                {movie.origin_name}
              </h3>

              <div className={`flex flex-wrap gap-3 md:gap-4 lg:gap-5 mt-4 transition-all duration-700 delay-400 ${isActive ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
                <Link
                  href={movie.href ?? `/phim/${movie.slug}`}
                  className="group/btn flex items-center gap-2 md:gap-3 bg-amber-primary text-black px-5 py-2.5 md:px-6 md:py-3 lg:px-8 lg:py-3.5 rounded-full font-mono text-label-md md:text-label-lg uppercase transition-all transform hover:-translate-y-1 shadow-amber-button hover:shadow-glow-lg"
                >
                  <div className="bg-black rounded-full p-1.5 group-hover/btn:scale-110 transition-transform">
                    <Play fill="currentColor" className="text-amber-gold w-4 h-4 md:w-5 md:h-5" />
                  </div>
                  XEM NGAY
                </Link>
                <Link
                  href={movie.href ?? `/phim/${movie.slug}`}
                  className="flex items-center gap-2 md:gap-3 glass-panel text-cinema-text px-5 py-2.5 md:px-6 md:py-3 lg:px-8 lg:py-3.5 rounded-full font-mono text-label-md md:text-label-lg uppercase hover:-translate-y-1 hover:border-amber-primary/50 transition-all"
                >
                  <Info className="w-5 h-5 md:w-6 md:h-6" />
                  CHI TIẾT
                </Link>
              </div>
            </div>
          </div>
        );
      })}

      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 w-full h-1.5 bg-white/5 z-50">
        <div
          className="h-full bg-amber-primary shadow-[0_0_15px_rgba(245,158,11,0.8)] transition-all duration-100 ease-linear"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Navigation Buttons (Hidden on mobile, visible on group hover) */}
      <button
        onClick={handlePrev}
        className="absolute left-2 md:left-4 top-1/2 -translate-y-1/2 z-30 p-2 md:p-3 bg-black/40 hover:bg-amber-primary text-cinema-text hover:text-black rounded-full backdrop-blur-xl opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-300 block border border-white/10 hover:border-amber-primary hover:shadow-amber-glow"
      >
        <ChevronLeft size={24} />
      </button>

      <button
        onClick={handleNext}
        className="absolute right-2 md:right-4 top-1/2 -translate-y-1/2 z-30 p-2 md:p-3 bg-black/40 hover:bg-amber-primary text-cinema-text hover:text-black rounded-full backdrop-blur-xl opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all duration-300 block border border-white/10 hover:border-amber-primary hover:shadow-amber-glow"
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
              className={`relative overflow-hidden rounded-2xl transition-all duration-500 border group/thumb ${isActive
                ? 'w-32 h-20 border-amber-primary shadow-amber-glow scale-110 z-10'
                : 'w-20 h-12 border-white/10 hover:border-amber-primary/50 opacity-50 hover:opacity-100'
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
                <div className="absolute inset-0 bg-amber-primary/20" />
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
            className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? 'bg-amber-primary w-6 shadow-amber-glow' : 'bg-white/30 w-2'
              }`}
          />
        ))}
      </div>
    </div>
  );
};

export default HeroSection;
