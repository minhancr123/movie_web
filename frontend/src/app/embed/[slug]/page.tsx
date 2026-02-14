import { getMovieDetail } from '@/lib/api';
import { notFound } from 'next/navigation';
import EmbedPlayer from '@/components/EmbedPlayer';

export default async function EmbedPage({ 
  params, 
  searchParams 
}: { 
  params: { slug: string },
  searchParams: { tap?: string, t?: string } 
}) {
  const data = await getMovieDetail(params.slug);
  
  if (!data || !data.movie) {
    return notFound();
  }

  const episodes = data.episodes || [];
  
  let currentEpisode: any = null;
  const targetSlug = searchParams.tap;
  const startTime = searchParams.t ? parseInt(searchParams.t) : 0;

  // Find episode
  if (!targetSlug && episodes.length > 0 && episodes[0].server_data.length > 0) {
    currentEpisode = episodes[0].server_data[0];
  } else if (targetSlug) {
    for (const server of episodes) {
      const found = server.server_data.find((ep: any) => ep.slug === targetSlug);
      if (found) {
        currentEpisode = found;
        break;
      }
    }
  }

  if (!currentEpisode) {
    return notFound();
  }

  const embedUrl = currentEpisode.link_embed || '';
  const m3u8Url = currentEpisode.link_m3u8 || '';

  return (
    <EmbedPlayer 
      embedUrl={embedUrl}
      m3u8Url={m3u8Url}
      movieName={data.movie.name}
      startTime={startTime}
    />
  );
}
