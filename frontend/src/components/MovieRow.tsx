'use client';
import { useRef } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import MovieCard from './MovieCard';

interface MovieRowProps {
  title: string;
  movies: any[];
  path?: string;
}

const MovieRow = ({ title, movies, path }: MovieRowProps) => {
  const rowRef = useRef<HTMLDivElement>(null);

  if (!movies || movies.length === 0) return null;

  const scroll = (direction: 'left' | 'right') => {
    if (rowRef.current) {
      const { scrollLeft, clientWidth } = rowRef.current;
      const scrollTo = direction === 'left' ? scrollLeft - clientWidth * 0.8 : scrollLeft + clientWidth * 0.8;
      
      rowRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
    }
  };

  return (
    <div className="mb-12 group/row relative w-full">
      <div className="flex justify-between items-end mb-6">
        <h2 className="text-xl md:text-2xl font-bold text-white border-l-4 border-red-600 pl-3 uppercase tracking-wide">
          {title}
        </h2>
        {path && (
            <Link href={path} className="group flex items-center gap-1 text-xs md:text-sm font-semibold text-gray-400 hover:text-red-500 transition-colors">
            XEM TẤT CẢ 
            <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
        )}
      </div>
      
      <div className="relative">
        {/* Left Arrow */}
        <button 
            onClick={() => scroll('left')}
            className="absolute -left-4 top-1/2 -translate-y-1/2 z-20 p-3 bg-black/50 hover:bg-red-600 text-white rounded-full backdrop-blur-md opacity-0 group-hover/row:opacity-100 transition-all duration-300 shadow-lg border border-white/10 hidden md:block"
            aria-label="Scroll left"
        >
            <ChevronLeft size={24} />
        </button>

        {/* Scroll Container */}
        <div 
            ref={rowRef}
            className="flex gap-4 md:gap-6 overflow-x-auto pb-4 pt-2 scrollbar-none snap-x snap-mandatory px-1"
            style={{ 
                scrollbarWidth: 'none', 
                msOverflowStyle: 'none',
            }}
        >
            {movies.map((movie) => (
                <div key={movie._id} className="min-w-[160px] md:min-w-[220px] lg:min-w-[260px] snap-start transition-transform duration-300 hover:z-50 hover:scale-105">
                    <MovieCard movie={movie} />
                </div>
            ))}
        </div>

        {/* Right Arrow */}
        <button 
            onClick={() => scroll('right')}
            className="absolute -right-4 top-1/2 -translate-y-1/2 z-20 p-3 bg-black/50 hover:bg-red-600 text-white rounded-full backdrop-blur-md opacity-0 group-hover/row:opacity-100 transition-all duration-300 shadow-lg border border-white/10 hidden md:block"
            aria-label="Scroll right"
        >
            <ChevronRight size={24} />
        </button>
      </div>
    </div>
  );
};

export default MovieRow;
