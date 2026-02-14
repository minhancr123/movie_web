'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Loader2, Users, Activity, Eye, Server, RefreshCw } from 'lucide-react';

export default function AdminDashboard() {
    const { data: session, status } = useSession();
    const router = useRouter();

    // States for dashboard data
    const [rateLimit, setRateLimit] = useState<number>(0);
    const [newRateLimit, setNewRateLimit] = useState<number>(0);
    const [stats, setStats] = useState<{ activeUsers: number, requestRate: number, totalViews: number }>({ activeUsers: 0, requestRate: 0, totalViews: 0 });
    const [isLoading, setIsLoading] = useState(true);
    const [isUpdating, setIsUpdating] = useState(false);

    // Initial Load
    useEffect(() => {
        if (status === 'loading') return;
        if (status === 'unauthenticated') { router.push('/'); return; }

        // In real app check role here: if (session.user.role !== 'admin') ...

        fetchData();
        const interval = setInterval(fetchData, 5000); // Poll every 5s
        return () => clearInterval(interval);
    }, [status, router]);

    const fetchData = async () => {
        try {
            const baseUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:5000';

            // 1. Get Rate Limit Config
            const limitRes = await fetch(`${baseUrl}/api/movies/admin/rate-limit?secret=admin123`);
            if (limitRes.ok) {
                const data = await limitRes.json();
                setRateLimit(data.limit);
                if (newRateLimit === 0) setNewRateLimit(data.limit);
            }

            // 2. Real Stats from Backend
            try {
                const statsRes = await fetch(`${baseUrl}/api/movies/admin/stats?secret=admin123`);
                if (statsRes.ok) {
                    const sData = await statsRes.json();
                    setStats({
                        activeUsers: sData.activeUsers || 0,
                        requestRate: sData.requestRate || 0,
                        totalViews: sData.totalViews || 0 // Use backend total views
                    });
                }
            } catch (e) { console.error("Stats fetch error", e); }

            setIsLoading(false);

        } catch (error) {
            console.error("Dashboard fetch error:", error);
        }
    };

    const handleUpdateLimit = async () => {
        setIsUpdating(true);
        try {
            const baseUrl = process.env.NEXT_PUBLIC_BACKEND_API_URL || 'http://localhost:5000';
            await fetch(`${baseUrl}/api/movies/admin/rate-limit?secret=admin123&limit=${newRateLimit}`, { method: 'POST' });
            setRateLimit(newRateLimit);
            alert("Đã cập nhật giới hạn truy cập thành công!");
        } catch (e) {
            alert("Lỗi khi cập nhật");
        }
        setIsUpdating(false);
    };

    if (status === 'loading' || isLoading) {
        return <div className="min-h-screen flex items-center justify-center bg-black text-red-600"><Loader2 className="animate-spin w-10 h-10" /></div>;
    }

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white pt-24 pb-12 px-4">
            <div className="container mx-auto max-w-6xl">
                <div className="flex justify-between items-center mb-10">
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                        <Activity className="text-red-600" /> Admin Dashboard
                    </h1>
                    <div className="flex items-center gap-2 text-sm text-gray-400 bg-white/5 px-4 py-2 rounded-full border border-white/10">
                        <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Hệ thống đang hoạt động
                    </div>
                </div>

                {/* Grid Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
                    {/* Active Users */}
                    <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Users size={60} />
                        </div>
                        <h3 className="text-gray-400 font-bold text-sm uppercase tracking-wider mb-2">Đang truy cập</h3>
                        <div className="text-4xl font-black text-white flex items-baseline gap-2">
                            {stats.activeUsers}
                            <span className="text-xs font-normal text-green-500 bg-green-900/30 px-2 py-0.5 rounded flex items-center gap-1">
                                <Activity size={10} /> +12%
                            </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">Người dùng active trong 5 phút qua</p>
                    </div>

                    {/* Request Rate */}
                    <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Server size={60} />
                        </div>
                        <h3 className="text-gray-400 font-bold text-sm uppercase tracking-wider mb-2">Request / Phút</h3>
                        <div className="text-4xl font-black text-white flex items-baseline gap-2">
                            {stats.requestRate}
                            <span className="text-xs font-normal text-blue-500 bg-blue-900/30 px-2 py-0.5 rounded">CPM</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-2">Tổng request đến server</p>
                    </div>

                    {/* Total Views (Simulated Total) */}
                    <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Eye size={60} />
                        </div>
                        <h3 className="text-gray-400 font-bold text-sm uppercase tracking-wider mb-2">Tổng Lượt Xem</h3>
                        <div className="text-4xl font-black text-white">
                            {stats.totalViews > 0 ? stats.totalViews.toLocaleString() : 'Loading...'}
                        </div>
                        <p className="text-xs text-gray-500 mt-2">Tổng view toàn trang (Real-time)</p>
                    </div>

                    {/* System Status */}
                    <div className="bg-[#111] p-6 rounded-2xl border border-white/10 shadow-lg relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Activity size={60} />
                        </div>
                        <h3 className="text-gray-400 font-bold text-sm uppercase tracking-wider mb-2">Trạng thái Server</h3>
                        <div className="text-4xl font-black text-green-500">
                            Good
                        </div>
                        <p className="text-xs text-gray-500 mt-2">CPU: 12% | RAM: 45%</p>
                    </div>
                </div>

                {/* Control Panel */}
                <div className="bg-[#111] rounded-2xl border border-white/10 p-8">
                    <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                        <Server className="text-red-500" /> Quản lý truy cập (Anti-DDOS)
                    </h2>

                    <div className="flex flex-col md:flex-row items-end gap-6">
                        <div className="flex-1 w-full">
                            <label className="block text-sm font-bold text-gray-400 mb-2">
                                Giới hạn Request (mỗi IP / phút)
                            </label>
                            <div className="relative">
                                <input
                                    type="number"
                                    value={newRateLimit}
                                    onChange={(e) => setNewRateLimit(Number(e.target.value))}
                                    className="w-full bg-black border border-gray-700 rounded-xl px-4 py-3 text-white focus:border-red-500 outline-none transition-colors"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-gray-500 font-bold">
                                    Req/min
                                </div>
                            </div>
                            <p className="text-xs text-gray-500 mt-2">
                                Giới hạn mặc định: 60. Đặt cao hơn nếu server chịu tải tốt (Ví dụ: 200).
                            </p>
                        </div>

                        <button
                            onClick={handleUpdateLimit}
                            disabled={isUpdating}
                            className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-8 rounded-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center gap-2"
                        >
                            {isUpdating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                            Cập nhật Cấu hình
                        </button>
                    </div>

                    <div className="mt-8 p-4 bg-red-900/10 border border-red-900/20 rounded-xl text-sm text-gray-300">
                        <p className="font-bold text-red-500 mb-1">Lưu ý quản trị viên:</p>
                        Việc giảm giới hạn xuống quá thấp (ví dụ: dưới 30) có thể ảnh hưởng đến trải nghiệm người dùng xem phim bình thường.
                        Khuyến nghị mức từ 100 - 300.
                    </div>
                </div>
            </div>
        </div>
    );
}
