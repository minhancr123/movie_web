import MovieCardSkeleton from './MovieCardSkeleton';

const MovieGridSkeleton = ({ count = 20 }: { count?: number }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
      {Array(count).fill(0).map((_, i) => (
        <MovieCardSkeleton key={i} />
      ))}
    </div>
  );
};

export default MovieGridSkeleton;
