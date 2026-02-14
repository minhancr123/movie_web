export default function MovieDetailLoading() {
  return (
    <div className="bg-[#0a0a0a] min-h-screen text-gray-100 pb-12">
      {/* Backdrop Skeleton */}
      <div className="relative w-full h-[50vh] md:h-[70vh] bg-gray-900 animate-pulse">
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/50 to-transparent" />
      </div>

      <div className="container mx-auto px-4 -mt-32 md:-mt-48 relative z-20">
        <div className="flex flex-col md:flex-row gap-8">
          {/* Poster Skeleton */}
          <div className="w-[180px] md:w-[300px] shrink-0 mx-auto md:mx-0">
             <div className="aspect-[2/3] rounded-xl overflow-hidden shadow-2xl bg-gray-800 animate-pulse border-4 border-[#1a1a1a]"></div>
          </div>

          {/* Info Skeleton */}
          <div className="flex-1 mt-4 md:mt-12 text-center md:text-left space-y-4">
             <div className="h-10 md:h-12 w-3/4 bg-gray-800 rounded animate-pulse mx-auto md:mx-0"></div>
             <div className="h-5 w-1/2 bg-gray-900 rounded animate-pulse mx-auto md:mx-0"></div>
             
             <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 my-6">
                <div className="h-8 w-24 bg-gray-800 rounded-full animate-pulse"></div>
                <div className="h-8 w-24 bg-gray-800 rounded-full animate-pulse"></div>
                <div className="h-8 w-24 bg-gray-800 rounded-full animate-pulse"></div>
             </div>

             <div className="flex gap-4 justify-center md:justify-start">
                 <div className="h-12 w-32 bg-red-900/50 rounded-lg animate-pulse"></div>
                 <div className="h-12 w-32 bg-gray-800 rounded-lg animate-pulse"></div>
             </div>

             <div className="mt-8 space-y-2">
                <div className="h-4 w-full bg-gray-900 rounded animate-pulse"></div>
                <div className="h-4 w-full bg-gray-900 rounded animate-pulse"></div>
                <div className="h-4 w-2/3 bg-gray-900 rounded animate-pulse"></div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
}
