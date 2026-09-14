'use client';

import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';

interface ViewCounterProps {
  /** contentRef for TMDB content; a legacy movieSlug still works. */
  contentId: string;
  initialViews?: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api';

/**
 * Counts a view through the Node analytics queue (BullMQ -> movie_stats).
 * The old .NET Redis counter is gone; POST /view is fire-and-forget (202), so
 * the current total is read back separately.
 */
export default function ViewCounter({ contentId, initialViews = 0 }: ViewCounterProps) {
  const [views, setViews] = useState(initialViews);

  useEffect(() => {
    if (!contentId) return;
    let cancelled = false;

    const run = async () => {
      try {
        await fetch(`${API_BASE}/analytics/view`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ movieSlug: contentId }),
        });

        const res = await fetch(`${API_BASE}/analytics/views/${encodeURIComponent(contentId)}`);
        if (!res.ok || cancelled) return;

        const data = await res.json();
        if (typeof data?.views === 'number') setViews(data.views);
      } catch (error) {
        console.error('Không cập nhật được lượt xem', error);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [contentId]);

  return (
    <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-lg border border-white/5 backdrop-blur-sm shadow-sm hover:bg-white/10 transition-colors cursor-default">
      <Eye size={18} className="text-emerald-400" />
      <span className="font-semibold text-cinema-text">
        {views.toLocaleString()}
        <span className="text-cinema-subtle text-xs font-normal ml-0.5"> lượt xem</span>
      </span>
    </div>
  );
}
