import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  path?: string;
}

const Pagination = ({ currentPage, totalPages, path = '/' }: PaginationProps) => {
  // Helper to generate URL
  const getPageLink = (page: number) => {
      const hasQuery = path.includes('?');
      const separator = hasQuery ? '&' : '?';
      // If path already has page param, we need to replace it, but simpler to just append 
      // if we assume path clean. Better: use URLSearchParams if we were in client component with logic
      // But for server component simplicity:
      return `${path}${separator}page=${page}`;
  };

  // Generate page numbers to display
  const getPageNumbers = () => {
      if (totalPages <= 1) return [];
      
      const delta = 1; // Number of pages to show around current page
      const range = [];
      const rangeWithDots: (number | string)[] = [];
      let l;

      for (let i = 1; i <= totalPages; i++) {
          if (i === 1 || i === totalPages || (i >= currentPage - delta && i <= currentPage + delta)) {
              range.push(i);
          }
      }

      for (let i of range) {
          if (l) {
            if (i - l === 2) {
                rangeWithDots.push(l + 1);
            } else if (i - l !== 1) {
                rangeWithDots.push('...');
            }
          }
          rangeWithDots.push(i);
          l = i;
      }

      return rangeWithDots;
  };

  const pages = getPageNumbers();

  if (totalPages <= 1) return null;

  return (
    <div className="flex justify-center items-center gap-2 mt-12 mb-16 select-none">
      
      {/* Prev Button */}
      <Link 
        href={currentPage > 1 ? getPageLink(currentPage - 1) : '#'}
        className={`
            w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-300
            ${currentPage > 1 
                ? 'bg-[#1a1a1a] hover:bg-red-600 text-gray-400 hover:text-white border border-gray-800 hover:border-red-600' 
                : 'bg-transparent text-gray-700 cursor-not-allowed'}
        `}
        aria-disabled={currentPage <= 1}
      >
        <ChevronLeft size={20} />
      </Link>

      {/* Page Numbers */}
      <div className="flex items-center gap-2 bg-[#111] p-1.5 rounded-xl border border-gray-800/50 hidden md:flex">
        {pages.map((page, index) => {
            if (page === '...') {
                return (
                    <span key={`dots-${index}`} className="w-10 h-10 flex items-center justify-center text-gray-600 font-bold">
                        ...
                    </span>
                );
            }

            const isCurrent = page === currentPage;
            return (
                <Link
                    key={page}
                    href={getPageLink(page as number)}
                    className={`
                        w-10 h-10 rounded-lg flex items-center justify-center font-bold text-sm transition-all duration-300
                        ${isCurrent 
                            ? 'bg-red-600 text-white shadow-lg shadow-red-900/20 scale-105 pointer-events-none' 
                            : 'text-gray-400 hover:bg-gray-800 hover:text-white'}
                    `}
                >
                    {page}
                </Link>
            );
        })}
      </div>

       {/* Simple Page Numbers for Mobile */}
       <div className="flex md:hidden items-center px-4 font-mono text-sm text-gray-300">
           <span className="text-white font-bold text-base">{currentPage}</span>
           <span className="mx-2">/</span>
           <span>{totalPages}</span>
       </div>

      {/* Next Button */}
      <Link 
        href={currentPage < totalPages ? getPageLink(currentPage + 1) : '#'}
        className={`
            w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-300
            ${currentPage < totalPages 
                ? 'bg-[#1a1a1a] hover:bg-red-600 text-gray-400 hover:text-white border border-gray-800 hover:border-red-600' 
                : 'bg-transparent text-gray-700 cursor-not-allowed'}
        `}
        aria-disabled={currentPage >= totalPages}
      >
        <ChevronRight size={20} />
      </Link>
    </div>
  );
};

export default Pagination;
