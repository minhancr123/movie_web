'use client';

import { useSearchParams } from 'next/navigation';

/** Episode switches use native history to keep the player mounted. The server
 * page's initial props do not change, so its heading must observe the URL too. */
export default function WatchEpisodeLabel({ season, episode }: { season: number; episode: number }) {
  const params = useSearchParams();
  const selectedSeason = Number(params.get('s'));
  const selectedEpisode = Number(params.get('e'));
  return (
    <p className="mt-0.5 font-mono text-label-md uppercase text-amber-gold">
      Mùa {Number.isInteger(selectedSeason) && selectedSeason > 0 ? selectedSeason : season}, tập {Number.isInteger(selectedEpisode) && selectedEpisode > 0 ? selectedEpisode : episode}
    </p>
  );
}
