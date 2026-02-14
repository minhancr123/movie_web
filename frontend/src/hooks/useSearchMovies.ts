import useSWR from 'swr';
import { searchMovies } from '@/lib/api';

// SWR fetcher wrapper
const fetcher = async ([keyword, limit]: [string, number]) => {
  const result = await searchMovies(keyword, limit);
  // api.ts searchMovies returns res.data.
  // Assuming the structure is { status: 'success', data: { items: [...] } } or similar.
  return result;
};

export function useSearchMovies(keyword: string, limit = 5) {
  // Use array key to pass arguments to fetcher
  // If keyword is empty or too short, pass null to disable auto-fetching
  const shouldFetch = keyword && keyword.length >= 2;
  
  const { data, error, isLoading } = useSWR(
    shouldFetch ? [keyword, limit] : null,
    fetcher,
    {
      revalidateOnFocus: false, // Don't revalidate when window gets focus (for search results)
      dedupingInterval: 60000, // Dedup requests for 1 min
      keepPreviousData: true, // Keep showing previous results while typing (optional, but good for pagination/filtering)
    }
  );

  return {
    movies: data?.data?.items || [],
    isLoading,
    isError: error
  };
}
