'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Dices, Loader2 } from 'lucide-react';
import { CatalogItem, catalogHref } from '@/lib/catalog';

/**
 * "Hôm nay xem gì?" — picks a random title from the home rows with a little
 * dice roll animation, then navigates. Zero backend: it reuses the rows the
 * homepage already fetched.
 */
export default function SurpriseMe({ items }: { items: CatalogItem[] }) {
  const router = useRouter();
  const [rolling, setRolling] = useState(false);
  const pool = useMemo(
    () => items.filter((item) => item?.contentRef && item?.slug),
    [items],
  );

  const roll = () => {
    if (rolling || pool.length === 0) return;
    setRolling(true);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks >= 6) {
        clearInterval(timer);
        router.push(catalogHref(pick));
      }
    }, 90);
  };

  return (
    <button
      onClick={roll}
      disabled={rolling || pool.length === 0}
      title="Để chọn giúp bạn một phim"
      className="inline-flex items-center gap-2 rounded-full border border-amber-primary/40 bg-amber-primary/10 px-4 py-2 text-sm font-semibold text-amber-gold transition hover:bg-amber-primary/20 disabled:opacity-50"
    >
      {rolling ? <Loader2 size={16} className="animate-spin" /> : <Dices size={16} />}
      Hôm nay xem gì?
    </button>
  );
}
