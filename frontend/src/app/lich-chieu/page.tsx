'use client';
import { useState, useEffect } from 'react';
import { moviesAPI } from '@/lib/api';
import MovieCard from '@/components/MovieCard';
import { Calendar, Clock, Star } from 'lucide-react';

export default function SchedulePage() {
    const [schedule, setSchedule] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    // Simulated schedule data fetch or calculation
    // Since API might not have /schedule endpoint, we can infer from 'upcoming' or 'latest' + logic
    useEffect(() => {
        const fetchSchedule = async () => {
            try {
                // Get latest updated movies which usually implies schedule
                const response = await moviesAPI.getLatestMovies(1);
                if (response && response.items) {
                    setSchedule(response.items.slice(0, 10)); // Top 10 newest
                }
            } catch (error) {
                console.error(error);
            } finally {
                setLoading(false);
            }
        };
        fetchSchedule();
    }, []);

    const days = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'];
    const today = new Date().getDay(); // 0 is Sunday, adjust mapping if needed

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white pt-24 pb-12">
            <div className="container mx-auto px-4">
                <div className="flex items-center gap-4 mb-8">
                    <div className="bg-red-600 p-3 rounded-xl shadow-lg shadow-red-900/40">
                        <Calendar size={32} className="text-white" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold uppercase tracking-wide">Lịch Chiếu Phim</h1>
                        <p className="text-gray-400 text-sm">Cập nhật lịch phát sóng phim mới nhất</p>
                    </div>
                </div>

                {/* Day Tabs */}
                <div className="flex overflow-x-auto gap-4 pb-6 mb-8 scrollbar-hide">
                    {days.map((day, idx) => {
                        // Highlight today, simplified mapping logic
                        const isToday = (idx + 1) % 7 === today;
                        return (
                            <button
                                key={day}
                                className={`
                                    min-w-[120px] p-4 rounded-xl border transition-all flex flex-col items-center justify-center gap-1
                                    ${isToday
                                        ? 'bg-red-600 border-red-500 shadow-xl shadow-red-900/30 scale-105'
                                        : 'bg-[#111] border-gray-800 text-gray-400 hover:bg-gray-800 hover:border-gray-600 hover:text-white'}
                                `}
                            >
                                <span className="text-xs font-bold uppercase tracking-wider opacity-80">{day}</span>
                                <span className="text-lg font-black">{isToday ? 'Hôm nay' : '...'}</span>
                            </button>
                        );
                    })}
                </div>

                {/* Schedule List */}
                <div className="bg-[#111] border border-gray-800 rounded-2xl p-8">
                    <h2 className="text-xl font-bold mb-6 flex items-center gap-2 border-b border-gray-800 pb-4">
                        <Clock size={20} className="text-red-500" />
                        Phim Mới Cập Nhật
                    </h2>

                    {loading ? (
                        <div className="space-y-4">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="h-24 bg-gray-800/50 rounded-xl animate-pulse" />
                            ))}
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {schedule.map((movie, index) => (
                                <div key={movie.slug} className="group relative flex items-center gap-4 bg-black/40 border border-gray-800/50 p-3 rounded-xl hover:bg-gray-800/60 hover:border-gray-700 transition-all">
                                    {/* Time Badge */}
                                    <div className="flex flex-col items-center justify-center w-16 shrink-0 border-r border-gray-800 pr-4">
                                        <span className="text-lg font-bold text-white">20:00</span>
                                        <span className="text-[10px] text-gray-500 bg-gray-900 px-1.5 rounded uppercase font-bold">Vietsub</span>
                                    </div>

                                    {/* Movie Info */}
                                    {/* We can reuse a horizontal card here or custom layout */}
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-bold text-white group-hover:text-red-500 transition-colors truncate">{movie.name}</h3>
                                        <p className="text-xs text-gray-500 truncate mb-1">{movie.origin_name}</p>
                                        <div className="flex items-center gap-2 text-[10px] text-gray-400">
                                            <span className="bg-red-600/10 text-red-500 px-1.5 py-0.5 rounded border border-red-600/20">{movie.year}</span>
                                            <span>•</span>
                                            <span className="flex items-center gap-1"><Star size={10} className="text-yellow-500" fill="currentColor" /> 8.5</span>
                                        </div>
                                    </div>

                                    {/* Action */}
                                    <div className="shrink-0">
                                        <a
                                            href={`/phim/${movie.slug}`}
                                            className="bg-white text-black text-xs font-bold px-4 py-2 rounded-lg hover:bg-red-600 hover:text-white transition-colors block"
                                        >
                                            Xem ngay
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
