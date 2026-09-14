'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CatalogItem } from '@/lib/catalog';
import CatalogCard from './CatalogCard';

interface CatalogRowProps {
  title: string;
  items: CatalogItem[];
  path?: string;
}

export default function CatalogRow({ title, items, path }: CatalogRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);

  if (!items || items.length === 0) return null;

  const scroll = (direction: 'left' | 'right') => {
    if (!rowRef.current) return;
    const { scrollLeft, clientWidth } = rowRef.current;
    const scrollTo =
      direction === 'left' ? scrollLeft - clientWidth * 0.8 : scrollLeft + clientWidth * 0.8;
    rowRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
  };

  return (
    <div className="mb-12 group/row relative w-full">
      <div className="flex justify-between items-end mb-6">
        <h2 className="font-syne text-headline-md md:text-headline-xl text-white border-l-4 border-amber-primary pl-3">
          {title}
        </h2>
        {path && (
          <Link
            href={path}
            className="group flex items-center gap-1 font-mono text-label-md uppercase text-cinema-subtle hover:text-amber-gold transition-colors"
          >
            XEM TẤT CẢ
            <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </Link>
        )}
      </div>

      <div className="spatial-stage relative">
        <button
          onClick={() => scroll('left')}
          className="absolute -left-4 top-1/2 -translate-y-1/2 z-20 p-3 glass-panel hover:bg-amber-primary text-cinema-text hover:text-black rounded-full opacity-0 group-hover/row:opacity-100 transition-all duration-300 hover:shadow-amber-glow hidden md:block"
          aria-label="Cuộn sang trái"
        >
          <ChevronLeft size={24} />
        </button>

        <div
          ref={rowRef}
          className="flex gap-4 md:gap-6 overflow-x-auto pb-4 pt-2 scrollbar-none snap-x snap-mandatory px-1"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {items.map((item) => (
            <div
              key={item.contentRef}
              className="min-w-[160px] md:min-w-[220px] lg:min-w-[260px] snap-start hover:z-50"
            >
              <CatalogCard item={item} />
            </div>
          ))}
        </div>

        <button
          onClick={() => scroll('right')}
          className="absolute -right-4 top-1/2 -translate-y-1/2 z-20 p-3 glass-panel hover:bg-amber-primary text-cinema-text hover:text-black rounded-full opacity-0 group-hover/row:opacity-100 transition-all duration-300 hover:shadow-amber-glow hidden md:block"
          aria-label="Cuộn sang phải"
        >
          <ChevronRight size={24} />
        </button>
      </div>
    </div>
  );
}
