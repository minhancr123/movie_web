'use client';

import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';

interface ViewCounterProps {
    slug: string;
    initialViews?: number;
}

export default function ViewCounter({ slug, initialViews = 0 }: ViewCounterProps) {
    const [views, setViews] = useState(initialViews);
    const [hasCounted, setHasCounted] = useState(false);

    useEffect(() => {
        // Prevent double counting in Strict Mode or re-renders
        if (hasCounted) return;

        const increaseView = async () => {
            try {
                // Use relative path since we likely have a rewrite or standard env
                // Or use the env var if defined.
                const baseUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:5000';
                const res = await fetch(`${baseUrl}/api/movies/views/${slug}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (res.ok) {
                    const data = await res.json();
                    if (data.views) setViews(data.views);
                }
                setHasCounted(true);
            } catch (e) {
                console.error("Failed to increment views", e);
            }
        };

        // Delay slightly to avoid bot spam or instant bounces? 
        // No, immediate is fine for now.
        increaseView();
    }, [slug, hasCounted]);

    return (
        <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-lg border border-white/5 backdrop-blur-sm shadow-sm hover:bg-white/10 transition-colors cursor-default">
            <Eye size={18} className="text-emerald-400" />
            <span className="font-semibold text-gray-200">{views.toLocaleString()} <span className="text-gray-400 text-xs font-normal ml-0.5">lượt xem</span></span>
        </div>
    );
}
