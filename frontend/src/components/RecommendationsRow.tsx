'use client';

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { CatalogItem, getPersonalizedRecommendations } from '@/lib/catalog';
import CatalogRow from './CatalogRow';

interface RecommendationsRowProps {
  type?: string;
  tmdbId?: number;
  title?: string;
}

/**
 * A recommendation row that appears for authenticated users or on a specific movie page.
 */
export default function RecommendationsRow({ type, tmdbId, title = "Dành riêng cho bạn" }: RecommendationsRowProps) {
  const { data: session, status } = useSession();
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const fetchRecs = async () => {
      setIsLoading(true);
      try {
        const token = (session?.user as any)?.accessToken;
        const data = await getPersonalizedRecommendations(token, type, tmdbId);
        if (isMounted) {
          setItems(data);
        }
      } catch (err) {
        console.error('[RecommendationsRow] fetch failed:', err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchRecs();
    return () => { isMounted = false; };
  }, [status, session, type, tmdbId]);

  if (!isLoading && items.length === 0) {
    return null;
  }

  return (
    <div className={isLoading ? 'opacity-50 pointer-events-none transition-opacity' : 'transition-opacity'}>
      <CatalogRow title={title} items={items} />
    </div>
  );
}
