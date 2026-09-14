import useSWR from 'swr';
import { searchCatalog, type CatalogItem } from '@/lib/catalog';

const fetcher = async ([keyword]: [string, number]) => searchCatalog(keyword, 1);

/**
 * Type-ahead search against the TMDB catalog.
 * Returns CatalogItem[] — callers should link with catalogHref(), not a slug.
 */
export function useSearchMovies(keyword: string, limit = 5) {
  const shouldFetch = keyword && keyword.length >= 2;

  const { data, error, isLoading } = useSWR(shouldFetch ? [keyword, limit] : null, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
    keepPreviousData: true,
  });

  return {
    movies: (data?.items || []).slice(0, limit) as CatalogItem[],
    isLoading,
    isError: error,
  };
}
