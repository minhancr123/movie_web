import MovieGridSkeleton from '@/components/skeletons/MovieGridSkeleton';

export default function Loading() {
  return (
    <div className="pb-8 min-h-screen bg-[#0a0a0a]">
      {/* Hero Skeleton - Full Width */}
      <div className="relative w-full aspect-[16/9] md:aspect-[21/9] lg:h-[70vh] bg-gray-900 animate-pulse mb-12 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent z-10" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-transparent to-transparent z-10" />
          
          <div className="absolute bottom-20 left-4 md:left-12 lg:left-20 z-20 w-full max-w-2xl px-4">
               <div className="h-10 md:h-16 w-3/4 bg-gray-800 rounded-lg mb-4"></div>
               <div className="flex gap-3 mb-6">
                   <div className="h-6 w-20 bg-gray-800 rounded"></div>
                   <div className="h-6 w-20 bg-gray-800 rounded"></div>
                   <div className="h-6 w-20 bg-gray-800 rounded"></div>
               </div>
               <div className="h-4 w-full bg-gray-800 rounded mb-2"></div>
               <div className="h-4 w-2/3 bg-gray-800 rounded mb-6"></div>
               <div className="flex gap-4">
                   <div className="h-12 w-32 bg-gray-800 rounded-lg"></div>
                   <div className="h-12 w-32 bg-gray-800 rounded-lg"></div>
               </div>
          </div>
      </div>

      <div className="container mx-auto px-4 md:px-8">
        <div className="flex justify-between items-center mb-6">
            <div className="h-8 w-48 bg-gray-800 rounded animate-pulse border-l-4 border-red-900 pl-3"></div>
            <div className="h-8 w-24 bg-gray-800 rounded animate-pulse"></div>
        </div>
        
        <MovieGridSkeleton count={10} />
      </div>
    </div>
  );
}
