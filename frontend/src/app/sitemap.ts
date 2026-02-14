import { MetadataRoute } from 'next'
import { moviesAPI } from '@/lib/api';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
    const baseUrl = 'https://movieweb-ten.vercel.app'; // Update with your actual domain

    // Static routes
    const routes = [
        '',
        '/danh-sach-cua-toi',
        '/kham-pha',
        '/lich-chieu',
        '/the-loai/hanh-dong',
        '/the-loai/tinh-cam',
        // Add more categories
    ].map((route) => ({
        url: `${baseUrl}${route}`,
        lastModified: new Date().toISOString(),
        changeFrequency: 'daily' as const,
        priority: route === '' ? 1 : 0.8,
    }));

    // Dynamic routes (Movies)
    // Fetch a list of movies to generate dynamic URLs
    let movieRoutes: any[] = [];
    try {
        const response = await moviesAPI.getLatestMovies(1); // Page 1
        if (response && response.items) {
            movieRoutes = response.items.map((movie: any) => ({
                url: `${baseUrl}/phim/${movie.slug}`,
                lastModified: new Date(movie.modified?.time || new Date()).toISOString(),
                changeFrequency: 'weekly' as const,
                priority: 0.6,
            }));
        }
    } catch (error) {
        console.error("Sitemap generation error:", error);
    }

    return [...routes, ...movieRoutes];
}
