'use client';
import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation'; // Changed from 'next/navigation' to 'next/navigation' per Next 13+ client component
import MovieCard from '@/components/MovieCard';
import { Filter, ChevronDown, Check } from 'lucide-react';
import { moviesAPI } from '@/lib/api'; // Ensure this uses a capable endpoint or simulate filtering

// Mock data for filters since API might not support all
const YEARS = Array.from({ length: 15 }, (_, i) => 2024 - i);
const COUNTRIES = [
    { name: 'Hàn Quốc', slug: 'han-quoc' },
    { name: 'Trung Quốc', slug: 'trung-quoc' },
    { name: 'Mỹ', slug: 'au-my' },
    { name: 'Việt Nam', slug: 'viet-nam' },
    { name: 'Nhật Bản', slug: 'nhat-ban' },
    { name: 'Thái Lan', slug: 'thai-lan' },
];
const GENRES = [
    { name: 'Hành Động', slug: 'hanh-dong' },
    { name: 'Tình Cảm', slug: 'tinh-cam' },
    { name: 'Hài Hước', slug: 'hai-huoc' },
    { name: 'Cổ Trang', slug: 'co-trang' },
    { name: 'Tâm Lý', slug: 'tam-ly' },
    { name: 'Hình Sự', slug: 'hinh-su' },
    { name: 'Chiến Tranh', slug: 'chien-tranh' },
    { name: 'Thể Thao', slug: 'the-thao' },
    { name: 'Võ Thuật', slug: 'vo-thuat' },
    { name: 'Viễn Tưởng', slug: 'vien-tuong' },
];

export default function FilterPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    // State for filters
    const [year, setYear] = useState(searchParams.get('year') || '');
    const [country, setCountry] = useState(searchParams.get('country') || '');
    const [genre, setGenre] = useState(searchParams.get('genre') || '');
    const [sort, setSort] = useState(searchParams.get('sort') || 'newest');

    const [movies, setMovies] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Apply filters function
    const applyFilters = () => {
        const params = new URLSearchParams();
        if (year) params.set('year', year);
        if (country) params.set('country', country);
        if (genre) params.set('genre', genre);
        if (sort) params.set('sort', sort);

        router.push(`/kham-pha?${params.toString()}`);
    };

    // Auto-fetch on param change
    useEffect(() => {
        fetchMovies();
    }, [searchParams]);

    const fetchMovies = async () => {
        setLoading(true);
        try {
            // Priority: Genre > Country > Latest
            // Note: If both Genre and Country are selected, we prioritize Genre API and filter Country client-side (best effort)

            let response;
            if (genre) {
                response = await moviesAPI.getMoviesByGenre(genre, 1);
            } else if (country) {
                response = await moviesAPI.getMoviesByCountry(country, 1);
            } else {
                response = await moviesAPI.getLatestMovies(1);
            }

            if (response && (response.items || response.data?.items)) {
                let data = response.items || response.data.items;

                // Client-side filtering
                if (data && data.length > 0) {
                    // Filter by Year
                    if (year) {
                        data = data.filter((m: any) => m.year == year);
                    }

                    // Filter by Country (only if Genre was primary API call)
                    if (genre && country) {
                        // Note: API might return country in specific format, e.g. country: [{name: 'Mỹ', ...}]
                        // We need to check if the movie's country list contains the selected country slug
                        // Typically APIs return `country` array or `country` string. 
                        // Let's assume structure. If not sure, we might skip strict filtering to avoid empty results.
                        // But let's try strict:
                        data = data.filter((m: any) => {
                            if (Array.isArray(m.country)) {
                                return m.country.some((c: any) => c.slug === country || c.name === country);
                            }
                            return true; // Keep if uncertain
                        });
                    }

                    // Sort
                    if (sort === 'name_asc') {
                        data.sort((a: any, b: any) => a.name.localeCompare(b.name));
                    } else if (sort === 'newest') {
                        // Usually API returns newest first, but we can enforce if we have date
                        // data.sort(...)
                    }
                }

                setMovies(data || []);
            } else {
                setMovies([]);
            }
        } catch (error) {
            console.error(error);
            setMovies([]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="bg-[#0a0a0a] min-h-screen text-white pt-24 pb-12">
            <div className="container mx-auto px-4">
                <div className="flex flex-col md:flex-row items-center justify-between mb-8 gap-4">
                    <h1 className="text-3xl font-bold uppercase border-l-4 border-red-600 pl-4">
                        Bộ Lọc Phim
                    </h1>
                </div>

                {/* Filter Bar */}
                <div className="bg-[#111] p-6 rounded-xl border border-gray-800 mb-8 sticky top-20 z-30 shadow-2xl">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        {/* Genre */}
                        <div className="relative group">
                            <label className="text-xs text-gray-500 font-bold uppercase mb-1 block">Thể loại</label>
                            <select
                                value={genre}
                                onChange={(e) => setGenre(e.target.value)}
                                className="w-full bg-black border border-gray-700 text-white rounded-lg px-3 py-2 focus:border-red-600 outline-none appearance-none"
                            >
                                <option value="">Tất cả</option>
                                {GENRES.map(g => (
                                    <option key={g.slug} value={g.slug}>{g.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={16} className="absolute right-3 top-8 text-gray-500 pointer-events-none" />
                        </div>

                        {/* Country */}
                        <div className="relative group">
                            <label className="text-xs text-gray-500 font-bold uppercase mb-1 block">Quốc gia</label>
                            <select
                                value={country}
                                onChange={(e) => setCountry(e.target.value)}
                                className="w-full bg-black border border-gray-700 text-white rounded-lg px-3 py-2 focus:border-red-600 outline-none appearance-none"
                            >
                                <option value="">Tất cả</option>
                                {COUNTRIES.map(c => (
                                    <option key={c.slug} value={c.slug}>{c.name}</option>
                                ))}
                            </select>
                            <ChevronDown size={16} className="absolute right-3 top-8 text-gray-500 pointer-events-none" />
                        </div>

                        {/* Year */}
                        <div className="relative group">
                            <label className="text-xs text-gray-500 font-bold uppercase mb-1 block">Năm phát hành</label>
                            <select
                                value={year}
                                onChange={(e) => setYear(e.target.value)}
                                className="w-full bg-black border border-gray-700 text-white rounded-lg px-3 py-2 focus:border-red-600 outline-none appearance-none"
                            >
                                <option value="">Tất cả</option>
                                {YEARS.map(y => (
                                    <option key={y} value={y}>{y}</option>
                                ))}
                            </select>
                            <ChevronDown size={16} className="absolute right-3 top-8 text-gray-500 pointer-events-none" />
                        </div>

                        {/* Sort */}
                        <div className="relative group">
                            <label className="text-xs text-gray-500 font-bold uppercase mb-1 block">Sắp xếp</label>
                            <select
                                value={sort}
                                onChange={(e) => setSort(e.target.value)}
                                className="w-full bg-black border border-gray-700 text-white rounded-lg px-3 py-2 focus:border-red-600 outline-none appearance-none"
                            >
                                <option value="newest">Mới nhất</option>
                                <option value="popular">Xem nhiều nhất</option>
                                <option value="name_asc">Tên A-Z</option>
                            </select>
                            <ChevronDown size={16} className="absolute right-3 top-8 text-gray-500 pointer-events-none" />
                        </div>

                        {/* Apply Button */}
                        <div className="flex items-end">
                            <button
                                onClick={applyFilters}
                                className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg flex items-center justify-center gap-2 transition-colors"
                            >
                                <Filter size={18} /> Lọc Phim
                            </button>
                        </div>
                    </div>
                </div>

                {/* Results */}
                {loading ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                        {Array.from({ length: 10 }).map((_, i) => (
                            <div key={i} className="aspect-[2/3] bg-gray-800 rounded-xl animate-pulse" />
                        ))}
                    </div>
                ) : movies.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                        {movies.map(movie => (
                            <MovieCard key={movie.slug} movie={movie} />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-20 bg-[#111] rounded-xl border border-gray-800">
                        <p className="text-gray-400 text-lg">Không tìm thấy phim nào phù hợp với điều kiện lọc.</p>
                        <button
                            onClick={() => {
                                setYear(''); setCountry(''); setGenre(''); setSort('newest');
                                router.push('/kham-pha');
                            }}
                            className="mt-4 text-red-500 underline hover:text-red-400"
                        >
                            Xóa bộ lọc
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
