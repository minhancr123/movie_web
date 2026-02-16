import { getMoviesByCategory } from '@/lib/api';
import MovieRow from './MovieRow';

interface AsyncMovieRowProps {
    category: string;
    title: string;
    path: string;
}

const AsyncMovieRow = async ({ category, title, path }: AsyncMovieRowProps) => {
    // Fetch data
    const data = await getMoviesByCategory(category, 1);
    const movies = data?.data?.items || [];

    if (movies.length === 0) {
        return null;
    }

    return <MovieRow title={title} movies={movies} path={path} />;
};

export default AsyncMovieRow;
