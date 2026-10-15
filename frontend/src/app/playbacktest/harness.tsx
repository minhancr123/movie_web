'use client';
import { useCallback, useState } from 'react';
import VideoPlayer from '@/components/VideoPlayer';
/** Dev-only: synthetic 20s MP4 + timestamp/thumbnail fixture API at localhost:5109. */
export default function PlaybackExtrasHarness() {
  const [episode, setEpisode] = useState(1);
  const [pending, setPending] = useState(false);
  const advance = useCallback(() => {
    setPending(true);
    setTimeout(() => { setEpisode(value => Math.min(2, value + 1)); setPending(false); }, 500);
  }, []);
  return <div className="mx-auto my-8 max-w-4xl px-4">
    <p className="mb-4 text-white" data-testid="current-episode">Đang xem tập {episode}</p>
    <div className="aspect-video">
      <VideoPlayer src={`http://localhost:5109/clip.mp4?episode=${episode}`} movie={{ name: 'Kiểm tra trình phát', slug: 'extras-test', origin_name: 'Player QA', quality: 'HD', poster_url: '' }}
        episode={{ name: `Tập ${episode}`, slug: `s1e${episode}` }} durationSeconds={20} targetAt={0}
        subContext={{ type: 'tv', tmdbId: 1396, season: 1, episode, playbackSessionId: (episode === 1 ? 'a' : 'b').repeat(32) }}
        suspended={pending} onNextEpisode={episode === 1 && !pending ? advance : undefined} nextEpisodeLabel="Tập 2" />
    </div>
  </div>;
}
