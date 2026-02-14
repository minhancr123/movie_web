import { getMovieDetail, IMAGE_PREFIX, getMoviesByCategory } from '@/lib/api';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { Play, Calendar, Clock, Star, Users, Film, Globe, MessageSquare } from 'lucide-react';
import WatchButton from '@/components/WatchButton'; // Client Component wrapper
import SaveButton from '@/components/SaveButton';   // Client Component wrapper
import Link from 'next/link';
import CommentsSection from '@/components/CommentsSection';
import MovieRow from '@/components/MovieRow';

export default async function MovieDetail({ params }: { params: { slug: string } }) {
    const data = await getMovieDetail(params.slug);

    if (!data || !data.movie) {
        return notFound();
    }

    const movie = data.movie;
    const episodes = data.episodes || [];

    const posterUrl = movie.poster_url.startsWith('http') ? movie.poster_url : `${IMAGE_PREFIX}${movie.poster_url}`;
    const thumbUrl = movie.thumb_url.startsWith('http') ? movie.thumb_url : `${IMAGE_PREFIX}${movie.thumb_url}`;

    // Find the first episode to link to "Watch Now"
    const firstEpisodeSlug = episodes[0]?.server_data?.[0]?.slug;

    // Fetch Related Movies
    let relatedMovies = [];
    if (movie.category && movie.category.length > 0) {
        try { // Safe block for related movies
            const relatedData = await getMoviesByCategory(movie.category[0].slug, 1);
            relatedMovies = relatedData?.items?.filter((m: any) => m.slug !== movie.slug).slice(0, 12) || [];
        } catch (error) {
            console.error("Failed to load related movies", error);
        }
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] relative pb-20">
            {/* 1. Backdrop / Background Blur */}
            <div className="absolute top-0 left-0 w-full h-[70vh] overflow-hidden z-0">
                <Image
                    src={thumbUrl || posterUrl}
                    alt="Backdrop"
                    fill
                    className="object-cover opacity-20 blur-sm scale-105"
                    unoptimized
                    priority
                />
                {/* Gradients to blend smoothly */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/90 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-b from-[#0a0a0a]/60 via-transparent to-[#0a0a0a]/20" />
            </div>

            <div className="container mx-auto px-4 relative z-10 pt-[120px]">
                {/* Main Content Layout */}
                <div className="flex flex-col md:flex-row gap-10 lg:gap-14">

                    {/* LEFT: Poster & Actions */}
                    <div className="w-full md:w-1/3 lg:w-1/4 max-w-[300px] shrink-0 mx-auto md:mx-0">
                        <div className="aspect-[2/3] relative rounded-xl overflow-hidden shadow-2xl shadow-red-900/10 border border-white/10 group">
                            <Image
                                src={posterUrl}
                                alt={movie.name}
                                fill
                                className="object-cover transition-transform duration-700 group-hover:scale-105"
                                unoptimized
                                priority
                            />
                            {/* Quality Badge Overlay */}
                            <div className="absolute top-3 left-3 bg-red-600 shadow-lg shadow-red-600/20 text-white text-xs font-bold px-3 py-1 rounded-md backdrop-blur-md border border-white/10 uppercase tracking-wider">
                                {movie.quality}
                            </div>
                        </div>

                        <div className="mt-8 flex flex-col gap-3">
                            <WatchButton slug={movie.slug} episodeSlug={firstEpisodeSlug} />
                            <SaveButton movie={movie} />
                        </div>
                    </div>

                    {/* RIGHT: Movie Info */}
                    <div className="flex-1 animate-fade-in-up">
                        <div className="mb-8">
                            <h1 className="text-4xl md:text-5xl lg:text-6xl font-black text-white mb-4 tracking-tight leading-[1.1] drop-shadow-2xl">
                                {movie.name}
                            </h1>
                            <h2 className="text-xl md:text-2xl text-gray-400 font-medium italic flex items-center gap-3">
                                {movie.origin_name} <span className="w-1.5 h-1.5 bg-red-600 rounded-full"></span> {movie.year}
                            </h2>
                        </div>

                        {/* Metadata Row */}
                        <div className="flex flex-wrap items-center gap-6 mb-8 text-sm md:text-base text-gray-300 w-fit">
                            <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-lg border border-white/5 backdrop-blur-sm">
                                <Clock size={18} className="text-red-500" />
                                <span className="font-semibold">{movie.time || 'N/A'}</span>
                            </div>
                            <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-lg border border-white/5 backdrop-blur-sm">
                                <Globe size={18} className="text-blue-500" />
                                <span className="font-semibold">{movie.country?.[0]?.name || 'Quốc gia'}</span>
                            </div>
                            <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-lg border border-white/5 backdrop-blur-sm">
                                <span className={`w-2 h-2 rounded-full ${movie.status === 'completed' ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-yellow-500 shadow-[0_0_10px_#eab308]'}`}></span>
                                <span className="font-semibold">{movie.status === 'completed' ? 'Hoàn tất' : 'Đang chiếu'}</span>
                            </div>
                            <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-lg border border-white/5 backdrop-blur-sm uppercase text-xs font-bold tracking-wider text-gray-400">
                                {movie.lang}
                            </div>
                        </div>

                        {/* Genres */}
                        <div className="mb-10 flex flex-wrap gap-2.5">
                            {movie.category?.map((c: any) => (
                                <Link
                                    key={c.id || c.slug}
                                    href={`/the-loai/${c.slug}`}
                                    className="px-5 py-2 rounded-lg bg-white/5 hover:bg-white/10 hover:text-white border border-white/5 hover:border-red-500/50 transition-all text-sm font-medium text-gray-400"
                                >
                                    {c.name}
                                </Link>
                            )) || <span className="text-gray-500">Chưa cập nhật thể loại</span>}
                        </div>

                        {/* Info Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-12 border-t border-white/5 pt-8">
                            <div>
                                <h3 className="text-gray-500 font-bold mb-4 uppercase text-xs flex items-center gap-2 tracking-widest">
                                    <Video size={14} className="text-red-500" /> Đạo diễn
                                </h3>
                                <div className="flex flex-wrap gap-2">
                                    {movie.director?.map((d: string, i: number) => (
                                        <span key={i} className="text-gray-200 text-base font-medium hover:text-red-500 transition-colors cursor-default">
                                            {d}{i < (movie.director?.length || 0) - 1 ? ',' : ''}
                                        </span>
                                    )) || <span className="text-gray-600 italic">Đang cập nhật</span>}
                                </div>
                            </div>
                            <div>
                                <h3 className="text-gray-500 font-bold mb-4 uppercase text-xs flex items-center gap-2 tracking-widest">
                                    <Users size={14} className="text-red-500" /> Diễn viên
                                </h3>
                                <div className="flex flex-wrap gap-x-2 gap-y-1">
                                    {movie.actor?.map((actor: string, i: number) => (
                                        <span key={i} className="text-gray-200 text-base font-medium hover:text-red-500 transition-colors cursor-default">
                                            {actor}{i < (movie.actor?.length || 0) - 1 ? ',' : ''}
                                        </span>
                                    )) || <span className="text-gray-600 italic">Đang cập nhật</span>}
                                </div>
                            </div>
                        </div>

                        {/* Synopsis */}
                        <div className="mb-12">
                            <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-3">
                                <span className="w-1 h-6 bg-red-600 rounded-full"></span>
                                Nội dung phim
                            </h3>
                            <div className="bg-white/5 p-6 md:p-8 rounded-2xl border border-white/5 hover:bg-white/10 transition-colors backdrop-blur-sm">
                                <div
                                    className="prose prose-invert prose-p:text-gray-300 prose-p:leading-relaxed max-w-none prose-strong:text-white prose-a:text-red-500"
                                    dangerouslySetInnerHTML={{ __html: movie.content }}
                                />
                            </div>
                        </div>

                        {/* Episode List (Detailed) */}
                        {episodes.length > 0 && (
                            <div className="bg-[#111] p-6 md:p-8 rounded-2xl border border-white/10 shadow-2xl">
                                <h3 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                                    <Film className="text-red-600" /> Danh sách tập phim
                                </h3>

                                <div className="space-y-8">
                                    {episodes.map((server: any, idx: number) => (
                                        <div key={idx} className="relative">
                                            <h4 className="flex items-center gap-3 text-sm font-bold text-gray-400 mb-4 ml-1 uppercase tracking-wider">
                                                <span className="w-2 h-2 rounded-full bg-red-600"></span> {server.server_name}
                                            </h4>

                                            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                                                {server.server_data.map((ep: any) => (
                                                    <Link
                                                        key={ep.slug}
                                                        href={`/xem-phim/${movie.slug}?tap=${ep.slug}`}
                                                        className="bg-gray-800 hover:bg-red-600 text-gray-300 hover:text-white py-2.5 px-3 rounded-lg text-center text-sm font-bold transition-all hover:scale-105 active:scale-95 border border-white/5 hover:border-red-500/50 hover:shadow-lg hover:shadow-red-900/20"
                                                    >
                                                        {ep.name}
                                                    </Link>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* RELATED MOVIES ROW */}
                {relatedMovies.length > 0 && (
                    <div className="mt-20 pt-10 border-t border-white/5">
                        <MovieRow
                            title="Phim gợi ý cho bạn"
                            movies={relatedMovies}
                            path={`/the-loai/${movie.category?.[0]?.slug || ''}`}
                        />
                    </div>
                )}

                {/* COMMENTS SECTION - Full Width */}
                <div className="mt-16 pt-10 border-t border-white/5">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="p-3 rounded-full bg-white/5 border border-white/10">
                            <MessageSquare className="text-red-500" size={24} />
                        </div>
                        <h3 className="text-2xl font-bold text-white">Bình luận</h3>
                    </div>
                    <CommentsSection slug={movie.slug} />
                </div>
            </div>
        </div>
    );
}

// Icon Helper
const Video = ({ size, className }: { size?: number, className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
)

