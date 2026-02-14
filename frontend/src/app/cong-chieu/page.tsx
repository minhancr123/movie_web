'use client';

import { useState, useEffect } from 'react';
import { premiereAPI } from '@/lib/api';
import Image from 'next/image';
import Link from 'next/link';
import { Clock, Play, Users, Loader2 } from 'lucide-react';

interface Event {
  _id: string;
  movieSlug: string;
  name: string;
  posterUrl: string;
  startTime: string;
  status: string;
}

export default function PremierePage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const res = await premiereAPI.getAll();
      if (res.data.success) {
        setEvents(res.data.events || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getTime = (start: string) => {
    const diff = new Date(start).getTime() - Date.now();
    if (diff <= 0) return 'Đang chiếu';
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (d > 0) return `${d} ngày ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const isLive = (start: string) => {
    const startTime = new Date(start).getTime();
    const now = Date.now();
    // Live if started and less than 3 hours has passed (approx max movie duration)
    return startTime <= now && now - startTime < 3 * 60 * 60 * 1000;
  };

  const isEnded = (start: string) => {
    const startTime = new Date(start).getTime();
    const now = Date.now();
    return now - startTime >= 3 * 60 * 60 * 1000;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-16 h-16 text-red-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="py-8">
      <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-red-500 to-pink-500 bg-clip-text text-transparent mb-4">
        Lịch Công Chiếu
      </h1>
      <p className="text-gray-400 text-lg mb-8">
        Đón xem những bộ phim mới nhất được công chiếu độc quyền
      </p>
      {events.length === 0 ? (
        <div className="text-center py-20">
          <Users size={64} className="mx-auto text-gray-600 mb-4" />
          <p className="text-gray-400 text-xl">Chưa có sự kiện công chiếu</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {events.map(e => {
            const live = isLive(e.startTime);
            const ended = isEnded(e.startTime);

            return (
              <div key={e._id} className="group relative bg-gray-900 rounded-xl overflow-hidden border border-white/10 hover:border-red-500/50 hover:shadow-lg hover:shadow-red-500/20 transition-all">
                {live && (
                  <div className="absolute top-2 left-2 z-10 bg-red-600 px-3 py-1 rounded-full flex items-center gap-1 shadow-lg">
                    <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
                    <span className="text-xs font-bold text-white">LIVE</span>
                  </div>
                )}
                {ended && (
                  <div className="absolute top-2 left-2 z-10 bg-gray-600 px-3 py-1 rounded-full flex items-center gap-1 shadow-lg">
                    <span className="text-xs font-bold text-white">ĐÃ KẾT THÚC</span>
                  </div>
                )}
                <div className="relative aspect-[2/3]">
                  <Image src={e.posterUrl} alt={e.name} fill className="object-cover group-hover:scale-110 transition-transform duration-500" unoptimized />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
                </div>
                <div className="p-4 space-y-2">
                  <h3 className="text-white font-bold line-clamp-2 text-sm group-hover:text-red-400 transition-colors">{e.name}</h3>
                  <div className="flex items-center gap-2 text-xs">
                    <Clock size={12} className={live ? 'text-red-500' : ended ? 'text-gray-400' : 'text-yellow-500'} />
                    <span className={live ? 'text-red-500 font-semibold' : ended ? 'text-gray-400' : 'text-yellow-500'}>
                      {ended ? 'Đã chiếu xong' : getTime(e.startTime)}
                    </span>
                  </div>

                  {live ? (
                    <Link href={`/cong-chieu/xem/${e.movieSlug}`} className="block text-center py-2 rounded-lg text-sm font-semibold transition-all bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-600/50">
                      <Play size={14} className="inline mr-1" />
                      Xem ngay
                    </Link>
                  ) : ended ? (
                    <Link href={`/phim/${e.movieSlug}`} className="block text-center py-2 rounded-lg text-sm font-semibold transition-all bg-gray-700 hover:bg-gray-600 text-white">
                      <Play size={14} className="inline mr-1" />
                      Xem lại
                    </Link>
                  ) : (
                    <Link href={`/phim/${e.movieSlug}`} className="block text-center py-2 rounded-lg text-sm font-semibold transition-all bg-white/10 hover:bg-white/20 text-white">
                      <Play size={14} className="inline mr-1" />
                      Chi tiết
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
