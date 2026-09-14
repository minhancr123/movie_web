'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { authAPI, favoritesAPI, watchHistoryAPI } from '@/lib/api';
import Link from 'next/link';
import { User, Mail, Calendar, Heart, History, Settings, LogOut, Camera, Lock, Save, Loader2 } from 'lucide-react';
import Image from 'next/image';
import CatalogCard from '@/components/CatalogCard';
import ProviderConnect from '@/components/ProviderConnect';
import { fromStoredRecord, type CatalogItem } from '@/lib/catalog';
import { useMissingPosters } from '@/hooks/usePosterBackfill';

// Define tabs
type TabType = 'overview' | 'favorites' | 'history' | 'settings';

export default function ProfilePage() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [user, setUser] = useState<any>(null);
    const [activeTab, setActiveTab] = useState<TabType>('overview');

    // Data states
    const [favorites, setFavorites] = useState<CatalogItem[]>([]);
    const [history, setHistory] = useState<any[]>([]); // History items might have extra props like progress
    const [stats, setStats] = useState({ favorites: 0, history: 0 });

    // Heal backend rows saved before artwork was recorded: exact match on
    // contentRef first, title-search fallback (display-only merge; new
    // watches save posters directly).
    const missingNames = useMemo(() => {
        const items: { name: string; ref?: string }[] = [];
        [...history, ...favorites].forEach((m: any) => {
            if (m && !m.poster && m.title) items.push({ name: m.title, ref: m.contentRef });
        });
        return items;
    }, [history, favorites]);
    const backfilled = useMissingPosters(missingNames);
    const withPoster = (movie: any) => {
        if (!movie || movie.poster) return movie;
        const poster =
            backfilled[movie.contentRef] || backfilled[(movie.title || '').toLowerCase()];
        return poster ? { ...movie, poster } : movie;
    };

    // Loading states
    const [loading, setLoading] = useState(true);
    const [updating, setUpdating] = useState(false);

    // Form states
    const [formData, setFormData] = useState({
        fullName: '',
        avatar: '',
        currentPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

    useEffect(() => {
        if (status === 'unauthenticated') {
            router.push('/auth/login');
            return;
        }

        if (status === 'authenticated') {
            fetchUserData();
        }
    }, [status, router]);

    const fetchUserData = async () => {
        try {
            const [userRes, favRes, histRes] = await Promise.all([
                authAPI.getMe(),
                favoritesAPI.getAll(),
                watchHistoryAPI.getAll(100)
            ]);

            if (userRes.data.success) {
                const userData = userRes.data.user;
                setUser(userData);
                setFormData(prev => ({
                    ...prev,
                    fullName: userData.fullName || '',
                    avatar: userData.avatar || ''
                }));
            }

            if (favRes.data.success) {
                // Rows written before the TMDB cutover cannot be linked, so drop them.
                const mappedFavs = favRes.data.favorites
                    .map((item: any) => fromStoredRecord(item))
                    .filter((item: CatalogItem | null): item is CatalogItem => item !== null);
                setFavorites(mappedFavs);
                setStats(prev => ({ ...prev, favorites: favRes.data.favorites.length }));
            }

            if (histRes.data.success) {
                const mappedHist = histRes.data.history
                    .map((item: any) => fromStoredRecord(item))
                    .filter((item: CatalogItem | null): item is CatalogItem => item !== null);
                setHistory(mappedHist);
                setStats(prev => ({ ...prev, history: histRes.data.history.length }));
            }

        } catch (error) {
            console.error('Error fetching profile data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateProfile = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage(null);

        if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
            setMessage({ type: 'error', text: 'Mật khẩu mới không khớp' });
            return;
        }

        setUpdating(true);
        try {
            const updateData: any = {
                fullName: formData.fullName,
                avatar: formData.avatar
            };

            if (formData.newPassword) {
                updateData.currentPassword = formData.currentPassword;
                updateData.newPassword = formData.newPassword;
            }

            const res = await authAPI.updateProfile(updateData);

            if (res.data.success) {
                setUser(res.data.user);
                setMessage({ type: 'success', text: 'Cập nhật thông tin thành công' });
                // Clear password fields
                setFormData(prev => ({
                    ...prev,
                    currentPassword: '',
                    newPassword: '',
                    confirmPassword: ''
                }));
            }
        } catch (error: any) {
            console.error('Update error:', error);
            setMessage({
                type: 'error',
                text: error.response?.data?.message || 'Có lỗi xảy ra khi cập nhật'
            });
        } finally {
            setUpdating(false);
        }
    };

    if (status === 'loading' || loading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-amber-gold animate-spin" />
            </div>
        );
    }

    if (!user) return null;

    return (
        <div className="container mx-auto px-4 py-8 max-w-6xl">
            {/* Header Profile Card */}
            <div className="bg-surface-light rounded-2xl border border-white/10 p-8 mb-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-8 opacity-10">
                    <User size={200} />
                </div>

                <div className="flex flex-col md:flex-row items-center gap-8 relative z-10">
                    <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-white/10 shadow-xl shrink-0">
                        {user.avatar ? (
                            <Image
                                src={user.avatar}
                                alt={user.fullName}
                                width={128}
                                height={128}
                                className="object-cover w-full h-full"
                            />
                        ) : (
                            <div className="w-full h-full bg-surface-container flex items-center justify-center">
                                <User size={64} className="text-cinema-subtle" />
                            </div>
                        )}
                    </div>

                    <div className="flex-1 text-center md:text-left">
                        <h1 className="text-3xl font-bold text-white mb-2">{user.fullName || user.username}</h1>
                        <p className="text-cinema-subtle mb-4 font-mono">@{user.username}</p>

                        <div className="flex flex-wrap justify-center md:justify-start gap-4 text-sm text-cinema-subtle">
                            <div className="flex items-center gap-2 bg-surface-container/50 px-3 py-1.5 rounded-full">
                                <Mail size={14} /> {user.email}
                            </div>
                            <div className="flex items-center gap-2 bg-surface-container/50 px-3 py-1.5 rounded-full">
                                <Calendar size={14} /> Tham gia: {new Date(user.createdAt).toLocaleDateString('vi-VN')}
                            </div>
                        </div>
                    </div>

                    <div className="flex gap-4">
                        {user.role === 'admin' && (
                            <Link href="/admin/cong-chieu" className="text-center px-4 py-2 bg-amber-primary/20 rounded-xl border border-amber-primary/30 hover:bg-amber-primary/30 transition-colors flex flex-col items-center justify-center min-w-[80px]">
                                <div className="text-amber-gold mb-1"><Calendar size={20} /></div>
                                <div className="text-[10px] text-amber-gold font-bold uppercase tracking-wider">Tạo Event</div>
                            </Link>
                        )}
                        <div className="text-center px-6 py-3 bg-amber-primary/5 rounded-xl border border-amber-primary/20">
                            <div className="text-2xl font-bold text-amber-gold">{stats.favorites}</div>
                            <div className="text-xs text-cinema-subtle uppercase tracking-wider mt-1">Yêu thích</div>
                        </div>
                        <div className="text-center px-6 py-3 bg-blue-900/10 rounded-xl border border-blue-900/20">
                            <div className="text-2xl font-bold text-blue-500">{stats.history}</div>
                            <div className="text-xs text-cinema-subtle uppercase tracking-wider mt-1">Đã xem</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2 scrollbar-hide">
                {[
                    { id: 'overview', label: 'Tổng quan', icon: User },
                    { id: 'favorites', label: 'Phim yêu thích', icon: Heart },
                    { id: 'history', label: 'Lịch sử xem', icon: History },
                    { id: 'settings', label: 'Cài đặt', icon: Settings },
                ].map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as TabType)}
                        className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all whitespace-nowrap ${activeTab === tab.id
                            ? 'bg-amber-primary text-black shadow-lg shadow-amber-primary/20'
                            : 'bg-surface-light text-cinema-subtle hover:text-white hover:bg-surface-container'
                            }`}
                    >
                        <tab.icon size={18} />
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content Area */}
            <div className="min-h-[400px]">
                {/* Overview Tab */}
                {activeTab === 'overview' && (
                    <div className="space-y-8">
                        {/* Recent Favorites */}
                        <section>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                    <Heart className="text-amber-gold" size={20} /> Mới yêu thích gần đây
                                </h3>
                                <button onClick={() => setActiveTab('favorites')} className="text-sm text-cinema-subtle hover:text-white">Xem tất cả</button>
                            </div>
                            {favorites.length > 0 ? (
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                    {favorites.slice(0, 5).map(movie => (
                                        <CatalogCard key={movie.contentRef} item={movie} />
                                    ))}
                                </div>
                            ) : (
                                <div className="text-cinema-subtle text-center py-10 bg-surface-light rounded-xl border border-white/10">
                                    Chưa có phim yêu thích nào.
                                </div>
                            )}
                        </section>

                        {/* Recent History */}
                        <section>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                    <History className="text-blue-500" size={20} /> Xem gần đây
                                </h3>
                                <button onClick={() => setActiveTab('history')} className="text-sm text-cinema-subtle hover:text-white">Xem tất cả</button>
                            </div>
                            {history.length > 0 ? (
                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                    {history.slice(0, 5).map(movie => (
                                        <CatalogCard key={movie.contentRef} item={withPoster(movie)} />
                                    ))}
                                </div>
                            ) : (
                                <div className="text-cinema-subtle text-center py-10 bg-surface-light rounded-xl border border-white/10">
                                    Chưa có lịch sử xem phim.
                                </div>
                            )}
                        </section>
                    </div>
                )}

                {/* Favorites Tab */}
                {activeTab === 'favorites' && (
                    <div className="space-y-4">
                        <h3 className="text-2xl font-bold text-white mb-6">Tất cả phim yêu thích</h3>
                        {favorites.length > 0 ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-8">
                                {favorites.map(movie => (
                                    <CatalogCard key={movie.contentRef} item={withPoster(movie)} />
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-20 bg-surface-light rounded-2xl border border-white/10">
                                <Heart size={64} className="text-surface-bright mb-4" />
                                <p className="text-cinema-subtle text-lg">Danh sách yêu thích trống</p>
                            </div>
                        )}
                    </div>
                )}

                {/* History Tab */}
                {activeTab === 'history' && (
                    <div className="space-y-4">
                        <h3 className="text-2xl font-bold text-white mb-6">Lịch sử xem phim</h3>
                        {history.length > 0 ? (
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-x-4 gap-y-8">
                                {history.map(movie => (
                                    <CatalogCard key={movie.contentRef} item={withPoster(movie)} />
                                ))}
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-20 bg-surface-light rounded-2xl border border-white/10">
                                <History size={64} className="text-surface-bright mb-4" />
                                <p className="text-cinema-subtle text-lg">Bạn chưa xem phim nào</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Settings Tab */}
                {activeTab === 'settings' && (
                    <div className="max-w-2xl mx-auto space-y-6">
                        <div>
                            <h3 className="text-lg font-bold text-white mb-3">Nguồn phát</h3>
                            <ProviderConnect />
                            <p className="text-xs text-cinema-subtle mt-2">
                                Kết nối TorBox để xem phim từ nguồn của bạn trên trang xem phim.
                            </p>
                        </div>
                        <div className="bg-surface-light p-8 rounded-2xl border border-white/10">
                            <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
                                <Settings className="text-cinema-subtle" /> Cài đặt tài khoản
                            </h3>

                            {message && (
                                <div className={`p-4 rounded-xl mb-6 text-sm font-bold ${message.type === 'success' ? 'bg-green-900/20 text-green-500 border border-green-900/30' : 'bg-wine-accent/15 text-amber-gold border border-wine-accent/30'
                                    }`}>
                                    {message.text}
                                </div>
                            )}

                            <form onSubmit={handleUpdateProfile} className="space-y-6">
                                <div>
                                    <label className="block text-sm font-bold text-cinema-subtle mb-2">Họ và tên</label>
                                    <div className="relative">
                                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-cinema-subtle" size={18} />
                                        <input
                                            type="text"
                                            className="w-full bg-black border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:border-amber-primary focus:outline-none transition-colors"
                                            placeholder="Nhập họ tên của bạn"
                                            value={formData.fullName}
                                            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-cinema-subtle mb-2">Avatar URL</label>
                                    <div className="relative">
                                        <Camera className="absolute left-4 top-1/2 -translate-y-1/2 text-cinema-subtle" size={18} />
                                        <input
                                            type="text"
                                            className="w-full bg-black border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:border-amber-primary focus:outline-none transition-colors"
                                            placeholder="https://example.com/avatar.jpg"
                                            value={formData.avatar}
                                            onChange={(e) => setFormData({ ...formData, avatar: e.target.value })}
                                        />
                                    </div>
                                    <p className="text-xs text-cinema-subtle mt-2">Dán đường dẫn ảnh avatar của bạn vào đây.</p>
                                </div>

                                <div className="border-t border-white/10 pt-6 mt-6">
                                    <h4 className="text-white font-bold mb-4">Đổi mật khẩu</h4>

                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-bold text-cinema-subtle mb-2">Mật khẩu hiện tại</label>
                                            <div className="relative">
                                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-cinema-subtle" size={18} />
                                                <input
                                                    type="password"
                                                    className="w-full bg-black border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:border-amber-primary focus:outline-none transition-colors disabled:opacity-50"
                                                    placeholder="••••••"
                                                    value={formData.currentPassword}
                                                    onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                                                    disabled={user.authProvider === 'google'}
                                                />
                                            </div>
                                            {user.authProvider === 'google' && (
                                                <p className="text-xs text-amber-gold mt-2">Bạn đăng nhập bằng Google nên không cần đổi mật khẩu tại đây.</p>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-bold text-cinema-subtle mb-2">Mật khẩu mới</label>
                                            <div className="relative">
                                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-cinema-subtle" size={18} />
                                                <input
                                                    type="password"
                                                    className="w-full bg-black border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:border-amber-primary focus:outline-none transition-colors disabled:opacity-50"
                                                    placeholder="••••••"
                                                    value={formData.newPassword}
                                                    onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                                                    disabled={user.authProvider === 'google'}
                                                />
                                            </div>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-bold text-cinema-subtle mb-2">Xác nhận mật khẩu mới</label>
                                            <div className="relative">
                                                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-cinema-subtle" size={18} />
                                                <input
                                                    type="password"
                                                    className="w-full bg-black border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white focus:border-amber-primary focus:outline-none transition-colors disabled:opacity-50"
                                                    placeholder="••••••"
                                                    value={formData.confirmPassword}
                                                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                                                    disabled={user.authProvider === 'google'}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-4 flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={updating}
                                        className="flex items-center gap-2 bg-amber-primary hover:bg-amber-600 text-white px-8 py-3 rounded-xl font-bold transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {updating ? (
                                            <>
                                                <Loader2 className="animate-spin" size={20} /> Đang lưu...
                                            </>
                                        ) : (
                                            <>
                                                <Save size={20} /> Lưu thay đổi
                                            </>
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
