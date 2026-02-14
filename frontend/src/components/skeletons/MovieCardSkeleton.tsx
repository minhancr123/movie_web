const MovieCardSkeleton = () => {
  return (
    <div className="relative group rounded-md overflow-hidden cursor-pointer shadow-lg bg-zinc-900 border border-zinc-900">
      {/* Aspect Ratio Wrapper matching MovieCard */}
      <div className="aspect-[2/3] w-full relative bg-zinc-800 animate-pulse">
        {/* Placeholder for Poster Image */}
      </div>

      {/* Content Skeleton */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black via-black/80 to-transparent">
        <div className="h-4 bg-zinc-700 rounded animate-pulse w-3/4 mb-1"></div>
        <div className="flex items-center justify-between">
           <div className="h-3 bg-zinc-700 rounded animate-pulse w-1/3"></div>
           <div className="h-3 bg-zinc-700 rounded animate-pulse w-1/4"></div>
        </div>
      </div>

      {/* Badges/Overlays matching real card */}
      <div className="absolute top-2 left-2 flex gap-1 z-10">
         <div className="w-12 h-5 bg-zinc-700 rounded animate-pulse"></div>
         <div className="w-8 h-5 bg-zinc-700 rounded animate-pulse"></div>
      </div>
    </div>
  );
};
export default MovieCardSkeleton;
