import MovieGridSkeleton from '@/components/skeletons/MovieGridSkeleton';

export default function GenreLoading() {
  return (
    <div className="pt-24 pb-12 min-h-screen">
      <div className="container mx-auto px-4 md:px-8">
        <div className="mb-8 flex items-end justify-between border-b border-gray-800 pb-4">
            <div className="space-y-2">
                <div className="h-8 w-48 bg-gray-800 rounded animate-pulse border-l-4 border-red-900"></div>
                <div className="h-4 w-64 bg-gray-900 rounded animate-pulse pl-5"></div>
            </div>
        </div>
        
        <MovieGridSkeleton count={24} />
      </div>
    </div>
  );
}
