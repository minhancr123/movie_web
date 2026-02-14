'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Bell, Clock, Calendar, Film, Loader2 } from 'lucide-react';
import { premiereAPI, getLatestMovies } from '@/lib/api';

interface Notification {
    id: string;
    type: 'premiere' | 'new_movie';
    title: string;
    message: string;
    time: string;
    image: string;
    link: string;
    isRead: boolean;
}

export default function NotificationMenu() {
    const [isOpen, setIsOpen] = useState(false);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [loading, setLoading] = useState(true);
    const [unreadCount, setUnreadCount] = useState(0);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Fetch data
    useEffect(() => {
        const fetchData = async () => {
            try {
                // 1. Get Upcoming Premieres
                const premiereRes = await premiereAPI.getUpcoming();
                const premieres = premiereRes.data?.events || [];

                // 2. Get Recent Movies (Top 3)
                const latestRes = await getLatestMovies(1);
                const latestMovies = latestRes.items?.slice(0, 3) || [];

                const newNotifications: Notification[] = [];

                // Map Premieres
                premieres.forEach((p: any) => {
                    newNotifications.push({
                        id: `prem-${p._id}`,
                        type: 'premiere',
                        title: 'Sắp công chiếu',
                        message: p.name,
                        time: p.startTime,
                        image: p.posterUrl,
                        link: `/phim/${p.movieSlug}`,
                        isRead: false
                    });
                });

                // Map Movies
                latestMovies.forEach((m: any) => {
                    newNotifications.push({
                        id: `mov-${m._id}`,
                        type: 'new_movie',
                        title: 'Phim mới cập nhật',
                        message: m.name,
                        time: new Date().toISOString(), // Just now
                        image: m.poster_url,
                        link: `/phim/${m.slug}`,
                        isRead: false
                    });
                });

                // Sort by time (newest first) - actually premieres are future, movies are past
                // Let's just show premieres first then movies
                // Or sort by date string desc
                newNotifications.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

                setNotifications(newNotifications);
                setUnreadCount(newNotifications.length); // Assume all unread for now
            } catch (error) {
                console.error("Failed to load notifications", error);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, []);

    const handleToggle = () => {
        setIsOpen(!isOpen);
    };

    const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        const now = new Date();
        const diff = now.getTime() - date.getTime();

        // Future
        if (diff < 0) {
            const futureDiff = Math.abs(diff);
            const days = Math.floor(futureDiff / (1000 * 60 * 60 * 24));
            const hours = Math.floor(futureDiff / (1000 * 60 * 60));
            if (days > 0) return `Sau ${days} ngày`;
            if (hours > 0) return `Sau ${hours} giờ`;
            return 'Sắp diễn ra';
        }

        // Past
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);

        if (minutes < 60) return `${minutes} phút trước`;
        if (hours < 24) return `${hours} giờ trước`;
        return `${days} ngày trước`;
    };

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={handleToggle}
                className="text-gray-400 hover:text-white transition-colors relative group p-2 rounded-full hover:bg-white/10"
            >
                <Bell size={20} className={isOpen ? 'text-white' : ''} />
                {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-2 w-2 h-2 bg-red-600 rounded-full border border-black animate-pulse"></span>
                )}
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute top-full right-0 mt-2 w-80 sm:w-96 bg-[#111] border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 z-50">
                    <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                        <h3 className="font-bold text-white text-sm">Thông báo</h3>
                        {unreadCount > 0 && (
                            <button
                                onClick={() => setUnreadCount(0)}
                                className="text-xs text-red-500 hover:text-red-400 transition-colors"
                            >
                                Đánh dấu đã đọc
                            </button>
                        )}
                    </div>

                    <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                        {loading ? (
                            <div className="p-8 flex justify-center">
                                <Loader2 className="animate-spin text-red-500" />
                            </div>
                        ) : notifications.length === 0 ? (
                            <div className="p-8 text-center text-gray-500 text-sm">
                                <Bell className="mx-auto mb-2 opacity-50" size={24} />
                                Không có thông báo nào
                            </div>
                        ) : (
                            <div className="divide-y divide-white/5">
                                {notifications.map((item) => (
                                    <Link
                                        key={item.id}
                                        href={item.link}
                                        onClick={() => setIsOpen(false)}
                                        className="flex gap-3 p-4 hover:bg-white/5 transition-colors group relative"
                                    >
                                        <div className="relative w-12 h-16 shrink-0 rounded overflow-hidden border border-white/10">
                                            <Image
                                                src={item.image}
                                                alt={item.title}
                                                fill
                                                className="object-cover group-hover:scale-110 transition-transform"
                                                unoptimized
                                            />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="text-xs font-bold text-red-500 uppercase tracking-wider flex items-center gap-1.5">
                                                    {item.type === 'premiere' ? <Calendar size={10} /> : <Film size={10} />}
                                                    {item.title}
                                                </h4>
                                                <span className="text-[10px] text-gray-500 whitespace-nowrap ml-2">
                                                    {formatTime(item.time)}
                                                </span>
                                            </div>
                                            <p className="text-sm font-medium text-white line-clamp-2 group-hover:text-gray-200 transition-colors">
                                                {item.message}
                                            </p>
                                        </div>
                                        {/* Status indicator if unread (optional logic) */}
                                        {unreadCount > 0 && item.isRead === false && (
                                            <div className="absolute top-4 right-4 w-1.5 h-1.5 bg-red-500 rounded-full"></div>
                                        )}
                                    </Link>
                                ))}
                            </div>
                        )}
                    </div>
                    <div className="p-3 text-center border-t border-white/5 bg-white/[0.02]">
                        <Link href="/cong-chieu" onClick={() => setIsOpen(false)} className="text-xs text-gray-400 hover:text-white transition-colors">
                            Xem lịch công chiếu
                        </Link>
                    </div>
                </div>
            )}
        </div>
    );
}
