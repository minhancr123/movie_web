'use client';

import { useId, useState } from 'react';
export type SeasonOption = { seasonNumber: number; episodeCount: number; href: string };

export default function SeasonPicker({ seasons, current }: { seasons: SeasonOption[]; current: number | null }) {
  const id = useId();
  const [pending, setPending] = useState(false);
  if (seasons.length < 2) return null;
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs font-semibold text-white/70">Chọn mùa</label>
      <select id={id} value={current ?? ''} disabled={pending}
        onChange={event => {
          const selected = seasons.find(item => item.seasonNumber === Number(event.target.value));
          if (!selected || selected.seasonNumber === current) return;
          setPending(true);
          // A season owns a different episode inventory and playback state.
          // A document navigation releases the old player and its source tokens.
          window.location.assign(selected.href);
        }}
        className="max-w-full rounded-lg border border-amber-primary/40 bg-[#242124] px-3 py-2 text-sm font-semibold text-amber-gold focus:outline-none focus:ring-2 focus:ring-amber-primary disabled:opacity-60">
        {current === null && <option value="">Chọn mùa phim</option>}
        {seasons.map(item => <option key={item.seasonNumber} value={item.seasonNumber}>Mùa {item.seasonNumber} · {item.episodeCount} tập</option>)}
      </select>
      {pending && <span role="status" className="text-xs text-white/60">Đang chuyển mùa…</span>}
    </div>
  );
}
