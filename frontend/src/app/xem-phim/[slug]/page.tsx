import { getMovieDetail, IMAGE_PREFIX } from '@/lib/api';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import WatchSection from '@/components/WatchSection';
import dynamic from 'next/dynamic';

// Lazy load CommentsSection because it's heavy and below the fold
const CommentsSection = dynamic(() => import('@/components/CommentsSection'), {
  loading: () => <div className="h-40 w-full animate-pulse bg-gray-900 rounded-xl" />,
  ssr: false
});

export default async function WatchPage({ 
  params, 
  searchParams 
}: { 
  params: { slug: string },
  searchParams: { tap?: string, server?: string } 
}) {
  const data = await getMovieDetail(params.slug);
  
  if (!data || !data.movie) {
    return notFound();
  }

  const movie = data.movie;
  const posterUrl = movie.poster_url.startsWith('http') ? movie.poster_url : `${IMAGE_PREFIX}${movie.poster_url}`;

  const episodes = data.episodes || [];
  
  // Default variables
  let currentEpisode: any = null;
  let currentServerName = '';
  let nextEpisodeSlug = null;
  let activeServerIndex = 0; // Track which server is active

  const targetSlug = searchParams.tap;
  const targetServerIdx = searchParams.server ? parseInt(searchParams.server) : -1;

  if (!targetSlug) {
      // No specific episode requested -> Default to first available
      if(episodes.length > 0 && episodes[0].server_data.length > 0) {
          currentEpisode = episodes[0].server_data[0];
          currentServerName = episodes[0].server_name;
          activeServerIndex = 0;
          
          if(episodes[0].server_data.length > 1) {
              nextEpisodeSlug = episodes[0].server_data[1].slug;
          }
      }
  } else {
      // User requested specific episode (and potentially server)
      let found = false;

      // 1. Try to find in the requested server index first (if valid)
      if (targetServerIdx >= 0 && targetServerIdx < episodes.length) {
          const server = episodes[targetServerIdx];
          const idx = server.server_data.findIndex((ep:any) => ep.slug === targetSlug);
          if (idx !== -1) {
              currentEpisode = server.server_data[idx];
              currentServerName = server.server_name;
              activeServerIndex = targetServerIdx;
              
              const nextEp = server.server_data[idx + 1];
              if (nextEp) nextEpisodeSlug = nextEp.slug;
              found = true;
          }
      }

      // 2. If not found in target server (or no server param), search all servers
      if (!found) {
        for (let sIdx = 0; sIdx < episodes.length; sIdx++) {
            const server = episodes[sIdx];
            const idx = server.server_data.findIndex((ep:any) => ep.slug === targetSlug);
            if (idx !== -1) {
                currentEpisode = server.server_data[idx];
                currentServerName = server.server_name;
                activeServerIndex = sIdx;
                
                const nextEp = server.server_data[idx + 1];
                if (nextEp) nextEpisodeSlug = nextEp.slug;
                break;
            }
        }
      }
  }


  if (!currentEpisode) {
      return <div className="p-8 text-center text-white">Không tìm thấy tập phim này.</div>;
  }

  const m3u8Url = currentEpisode.link_m3u8;
  const embedUrl = currentEpisode.link_embed || `https://player.phimapi.com/player/?url=${currentEpisode.link_m3u8}`;

  return (
    <div className="bg-[#0a0a0a] min-h-screen pb-12">
      <div className="container mx-auto px-4 pt-2 pb-8">
        {/* Breadcrumb */}
        <div className="mb-6 text-sm flex items-center gap-2 text-gray-400 bg-gray-900/50 p-3 rounded-lg w-full border border-gray-800 backdrop-blur-sm">
            <Link href="/" className="hover:text-red-500 transition-colors shrink-0">Trang chủ</Link> 
            <span className="text-gray-600">/</span>
            <Link href={`/phim/${movie.slug}`} className="hover:text-red-500 transition-colors truncate max-w-[150px] md:max-w-xs block">
                {movie.name}
            </Link> 
            <span className="text-gray-600">/</span>
            <span className="text-white font-medium shrink-0">Tập {currentEpisode.name}</span>
        </div>

        {/* Video Player Container */}
        <div className="w-full bg-black rounded-xl overflow-hidden shadow-[0_0_30px_rgba(220,38,38,0.15)] border border-gray-800">
             <WatchSection 
                embedUrl={embedUrl} 
                m3u8Url={m3u8Url} 
                nextEpisodeSlug={nextEpisodeSlug}
                movie={{
                    name: movie.name,
                    slug: movie.slug,
                    poster_url: posterUrl,
                    origin_name: movie.origin_name,
                    quality: movie.quality
                }}
                episode={{
                    name: currentEpisode.name,
                    slug: currentEpisode.slug
                }}
             />
        </div>

        <div className="mt-8 flex flex-col md:flex-row gap-8">
            <div className="flex-1">
                 <h1 className="text-2xl md:text-3xl font-bold text-white mb-2 flex items-center gap-3">
                    {movie.name} <span className="text-red-600 text-xl font-normal">Tập {currentEpisode.name}</span>
                 </h1>
                 <p className="text-gray-400 text-sm mb-6 flex items-center gap-2">
                    <span className="bg-gray-800 text-gray-300 px-2 py-0.5 rounded text-xs uppercase font-bold">Server {currentServerName}</span>
                    <span className="text-gray-600">|</span>
                    <span>Cập nhật mới nhất</span>
                 </p>

                 {/* Note Box */}
                 <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded-lg mb-8 text-sm text-yellow-200/80">
                    <p>💡 Mẹo: Nếu không xem được, hãy thử đổi Server khác hoặc tải lại trang bạn nhé.</p>
                 </div>

                 {/* Episode Navigation */}
                <div className="bg-[#111] p-6 rounded-xl border border-gray-800">
                    <h3 className="text-lg font-bold mb-6 text-white flex items-center gap-2 uppercase tracking-wide">
                        <span className="w-1 h-6 bg-red-600 rounded-full block"></span>
                        Danh sách tập
                    </h3>
                    
                    <div className="space-y-6">
                        {episodes.map((server: any, idx: number) => (
                            <div key={idx} className="relative">
                                <h4 className={`text-xs font-bold mb-3 uppercase flex items-center gap-2 ${idx === activeServerIndex ? 'text-red-500' : 'text-gray-500'}`}>
                                     Server: <span className={idx === activeServerIndex ? 'text-white' : 'text-gray-300'}>{server.server_name}</span>
                                     {idx === activeServerIndex && <span className="bg-red-600/20 text-red-500 text-[10px] px-1.5 rounded">Đang xem</span>}
                                </h4>
                                <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
                                    {server.server_data.map((ep: any) => {
                                        // A button is active ONLY if slugs match AND server index matches
                                        const isCurrent = currentEpisode.slug === ep.slug && idx === activeServerIndex;
                                        return (
                                            <Link 
                                                key={ep.slug}
                                                href={`/xem-phim/${movie.slug}?tap=${ep.slug}&server=${idx}`}
                                                className={`
                                                    py-2 px-1 rounded-lg text-center text-sm font-medium transition-all
                                                    ${isCurrent 
                                                        ? 'bg-red-600 text-white shadow-lg scale-105 font-bold' 
                                                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'}
                                                `}
                                            >
                                                {ep.name}
                                            </Link>
                                        )
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>

        {/* COMMENTS SECTION - Full Width under Player & Sidebar */}
        <div className="mt-12 border-t border-gray-800 pt-10">
            <CommentsSection slug={movie.slug} />
        </div>
      </div>
    </div>
  );
}
