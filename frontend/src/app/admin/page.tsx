'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Activity, Users, Film, Play, Settings, ShieldCheck, RefreshCw, Loader2, AlertCircle, ExternalLink, Search, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import UserActivity from '@/components/admin/UserActivity';
import MovieRequestsManager from '@/components/admin/MovieRequestsManager';
import { authClient, providerAPI } from '@/lib/api';

type Tab = 'overview' | 'users' | 'requests' | 'sessions' | 'providers' | 'settings';
type Summary = {
  totalUsers: number; admins: number; newUsers: number; totalViews: number; pendingRequests: number; unexpiredSessions: number;
  measuredAt: string; traffic: { requests: number; errors: number; windowSeconds: number };
  system: { mongo: boolean; redis: boolean; uptimeSeconds: number; hostUptimeSeconds: number; cpuCores: number; loadAverage: number[]; memoryTotal: number; memoryFree: number; processRss: number; diskTotal: number | null; diskFree: number | null; release: string; nodeVersion: string };
};
type UserRow = { _id: string; username?: string; email?: string; role?: string; createdAt?: string; authProvider?: string; lastLogin?: { at?: string; ip?: string | null; device?: { browser?: string; os?: string } } };
type SessionRow = { _id: string; sessionId: string; type?: string; tmdbId?: number; season?: number; episode?: number; mode?: string; provider?: string; progress?: number; createdAt?: string; expiresAt?: string; startAt?: number };
type AuditRow = { _id: string; actor: string; action: string; details?: { enabled?: boolean; limit?: number }; createdAt: string };
type Page = { page: number; total: number; pages: number; limit: number };
const emptyPage: Page = { page: 1, total: 0, pages: 1, limit: 20 };
const tabs: { id: Tab; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Tổng quan', icon: Activity }, { id: 'users', label: 'Người dùng', icon: Users },
  { id: 'requests', label: 'Yêu cầu phim', icon: Film }, { id: 'sessions', label: 'Phiên phát', icon: Play },
  { id: 'providers', label: 'Nguồn phát', icon: ShieldCheck }, { id: 'settings', label: 'Cài đặt', icon: Settings },
];
const date = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa có dữ liệu';
const number = (value: number) => value.toLocaleString('vi-VN');
const bytes = (value: number | null) => value === null ? 'Chưa đo được' : `${(value / 1024 ** 3).toFixed(1)} GiB`;
const uptime = (value: number) => `${Math.floor(value / 86400)} ngày ${Math.floor(value % 86400 / 3600)} giờ ${Math.floor(value % 3600 / 60)} phút`;
const button = 'inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm transition hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'w-full rounded-xl border border-white/15 bg-black/25 px-3 py-2.5 text-sm outline-none focus:border-amber-400';
const panel = 'rounded-2xl border border-white/10 bg-white/[0.035] p-5 md:p-6';

export default function AdminDashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const allowed = status === 'authenticated' && session?.user?.role === 'admin';
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [pagination, setPagination] = useState<Page>(emptyPage);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [scope, setScope] = useState('active');
  const [provider, setProvider] = useState<{ connected?: boolean; masked?: string; plan?: string | number; mode?: string; canManage?: boolean } | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [hoverTrailer, setHoverTrailer] = useState(false);
  const [pauseOverlay, setPauseOverlay] = useState(true);
  const [limit, setLimit] = useState(120);
  const [draftLimit, setDraftLimit] = useState('120');
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [loadedAt, setLoadedAt] = useState('');
  const requestEpoch = useRef(0);
  useEffect(() => {
    if (status !== 'loading' && !allowed) router.replace('/');
  }, [status, allowed, router]);

  const refresh = useCallback(() => setRevision(v => v + 1), []);
  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    const epoch = ++requestEpoch.current;
    let busy = false;
    const load = async (initial = false) => {
      if (busy || (!initial && document.hidden)) return;
      busy = true;
      if (initial) setLoading(true);
      setError('');
      const config = { signal: controller.signal, timeout: 15000 };
      try {
        if (tab === 'overview') {
          const result = await authClient.get('/admin/stats', config);
          if (requestEpoch.current === epoch) setSummary(result.data.data);
        } else if (tab === 'users' || tab === 'sessions') {
          const result = await authClient.get(`/admin/${tab}`, { ...config, params: { page, limit: 20, search, role: role || undefined, scope } });
          if (requestEpoch.current === epoch) { tab === 'users' ? setUsers(result.data.data) : setSessions(result.data.data); setPagination(result.data.pagination); }
        } else if (tab === 'providers') {
          const result = await authClient.get('/providers/status', config);
          if (requestEpoch.current === epoch) setProvider(result.data?.data?.torbox || null);
        } else if (tab === 'settings') {
          const [settings, history] = await Promise.all([authClient.get('/admin/settings', config), authClient.get('/admin/audit', config)]);
          if (requestEpoch.current === epoch) { setHoverTrailer(settings.data.data.hoverTrailer); setPauseOverlay(settings.data.data.pauseOverlay !== false); setLimit(settings.data.data.catalogRateLimit); setDraftLimit(String(settings.data.data.catalogRateLimit)); setAudit(history.data.data); }
        }
        if (requestEpoch.current === epoch) setLoadedAt(new Date().toISOString());
      } catch (err: any) {
        if (!controller.signal.aborted && requestEpoch.current === epoch) setError(err.response?.data?.message || 'Không tải được dữ liệu. Kiểm tra kết nối rồi thử lại.');
      } finally {
        busy = false;
        if (!controller.signal.aborted && requestEpoch.current === epoch) setLoading(false);
      }
    };
    void load(true);
    const timer = tab === 'overview' ? setInterval(() => void load(), 30000) : null;
    return () => { controller.abort(); if (timer) clearInterval(timer); };
  }, [allowed, tab, page, search, role, scope, revision]);

  const action = async (run: () => Promise<unknown>, success: string) => {
    setSaving(true); setError(''); setNotice('');
    try { await run(); setNotice(success); refresh(); }
    catch (err: any) { setError(err.response?.data?.message || 'Không lưu được thay đổi. Vui lòng thử lại.'); }
    finally { setSaving(false); }
  };
  const changeTab = (value: Tab) => { setTab(value); setPage(1); setNotice(''); setError(''); };
  if (!allowed) return <div className="min-h-screen grid place-items-center"><Loader2 className="animate-spin text-amber-400" aria-label="Kiểm tra quyền quản trị" /></div>;
  const system = summary?.system;
  return (
    <main className="min-h-screen bg-[#0c0e12] px-4 pb-16 pt-24 text-zinc-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><div className="mb-2 text-xs font-bold uppercase tracking-[.2em] text-amber-400">CineVN · Quản trị</div><h1 className="text-3xl font-bold">Trung tâm điều hành</h1><p className="mt-2 text-sm text-zinc-400">Theo dõi hoạt động, xử lý yêu cầu và cấu hình website.</p></div>
          <div className="flex flex-wrap gap-2"><Link href="/admin/cong-chieu" className={button}><Film size={16} /> Quản lý công chiếu</Link><button onClick={refresh} disabled={loading || saving} className={button}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Làm mới</button></div>
        </header>
        <nav aria-label="Các mục quản trị" className="flex gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-white/[.03] p-1.5">
          {tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => changeTab(id)} aria-current={tab === id ? 'page' : undefined} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${tab === id ? 'bg-amber-400 text-black' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}><Icon size={16} />{label}</button>)}
        </nav>
        {error && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200"><AlertCircle size={18} /><span className="flex-1">{error}</span><button className={button} onClick={refresh}>Thử lại</button></div>}
        {notice && <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-200"><CheckCircle2 size={17} />{notice}</div>}
        <div className="flex justify-between gap-3 text-xs text-zinc-500"><span>{tabs.find(t => t.id === tab)?.label}</span><span>{loadedAt ? `Cập nhật: ${date(loadedAt)}` : 'Đang tải dữ liệu'}</span></div>
        {loading && <div className="flex items-center gap-3 py-6 text-sm text-zinc-400"><Loader2 size={18} className="animate-spin" />Đang tải dữ liệu quản trị…</div>}
        {tab === 'overview' && summary && <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[
            ['Tổng tài khoản', number(summary.totalUsers), `${number(summary.admins)} quản trị viên · ${number(summary.newUsers)} tài khoản mới / 7 ngày`],
            ['Lượt xem đã ghi nhận', number(summary.totalViews), 'Tổng tích lũy từ hệ thống thống kê'],
            ['Yêu cầu chờ xử lý', number(summary.pendingRequests), 'Mở mục Yêu cầu phim để xử lý'],
            ['Yêu cầu HTTP / 60 giây', number(summary.traffic.requests), `${number(summary.traffic.errors)} lỗi 5xx · Bộ đếm tiến trình hiện tại`],
          ].map(([label, value, note]) => <section key={label} className={panel}><h2 className="text-sm text-zinc-400">{label}</h2><p className="my-3 text-3xl font-bold">{value}</p><p className="text-xs leading-relaxed text-zinc-500">{note}</p></section>)}</div>
          <div className="grid gap-5 lg:grid-cols-2"><section className={panel}><h2 className="mb-5 text-lg font-semibold">Sức khỏe dịch vụ</h2><dl className="space-y-4 text-sm">{[['MongoDB', system?.mongo ? 'Kết nối tốt' : 'Mất kết nối'], ['Redis cache', system?.redis ? 'Kết nối tốt' : 'Mất kết nối'], ['Backend đã chạy', uptime(system!.uptimeSeconds)], ['Máy chủ đã chạy', uptime(system!.hostUptimeSeconds)], ['Phiên phát còn hạn', number(summary.unexpiredSessions)], ['Phiên bản backend', system!.release.slice(0, 12)]].map(([k, v]) => <div className="flex justify-between gap-4" key={k}><dt className="text-zinc-400">{k}</dt><dd className="break-all text-right">{v}</dd></div>)}</dl><p className="mt-5 text-xs leading-relaxed text-zinc-500">Phiên còn hạn có thể đã ngừng xem; đây không phải số người đang online.</p></section>
          <section className={panel}><h2 className="mb-5 text-lg font-semibold">Tài nguyên máy chủ</h2><dl className="space-y-4 text-sm">{[['CPU logic', String(system!.cpuCores)], ['Tải CPU trung bình (1 / 5 / 15 phút)', system!.loadAverage.map(v => v.toFixed(2)).join(' / ')], ['RAM tổng / trống', `${bytes(system!.memoryTotal)} / ${bytes(system!.memoryFree)}`], ['RAM tiến trình backend (RSS)', bytes(system!.processRss)], ['Ổ đĩa tổng / còn trống', `${bytes(system!.diskTotal)} / ${bytes(system!.diskFree)}`], ['Node.js', system!.nodeVersion]].map(([k,v]) => <div className="flex justify-between gap-4" key={k}><dt className="text-zinc-400">{k}</dt><dd className="text-right">{v}</dd></div>)}</dl><a href="https://dapperunicycle1362.grafana.net/d/cinevn-playback/cinevn-playback-observability" target="_blank" rel="noopener noreferrer" className={`${button} mt-5 text-amber-300`}>Mở biểu đồ phát phim trên Grafana <ExternalLink size={14} /></a></section></div>
        </>}
        {tab === 'users' && <section className={panel}><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Danh sách tài khoản</h2><p className="mt-1 text-sm text-zinc-500">{number(pagination.total)} kết quả · Không hiển thị mật khẩu hoặc thông tin kết nối riêng.</p></div><form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setSearch(query); setPage(1); }}><input aria-label="Tìm email hoặc tên người dùng" className={input} style={{width:240}} value={query} onChange={e => setQuery(e.target.value)} placeholder="Email hoặc tên người dùng" maxLength={100} /><select aria-label="Lọc vai trò" className={input} style={{width:150}} value={role} onChange={e => {setRole(e.target.value);setPage(1);}}><option value="">Tất cả vai trò</option><option value="admin">Quản trị viên</option><option value="user">Người dùng</option></select><button className={button} type="submit"><Search size={16} />Tìm</button></form></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr>{['Tài khoản','Email','Vai trò','Ngày tạo','Đăng nhập / Thiết bị','Chi tiết'].map(h=><th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>{users.map(u=><tr key={u._id} className="border-b border-white/5"><td className="px-3 py-4 font-medium">{u.username || 'Chưa đặt tên'}</td><td className="px-3 py-4">{u.email || '—'}</td><td className="px-3 py-4"><span className={`rounded-full px-2.5 py-1 text-xs ${u.role==='admin'?'bg-amber-400/10 text-amber-300':'bg-white/5 text-zinc-400'}`}>{u.role==='admin'?'Quản trị viên':'Người dùng'}</span></td><td className="whitespace-nowrap px-3 py-4 text-zinc-400">{date(u.createdAt)}</td><td className="px-3 py-4 text-xs text-zinc-400"><div>{u.lastLogin?.at ? date(u.lastLogin.at) : 'Chưa ghi nhận'}</div><div className="mt-1">{u.lastLogin?.device ? `${u.lastLogin.device.browser} · ${u.lastLogin.device.os}` : u.authProvider==='google'?'Tài khoản Google':'Chưa có dữ liệu thiết bị'}</div><div className="mt-1 break-all font-mono">{u.lastLogin?.ip || ''}</div></td><td className="px-3 py-4"><button className={button} onClick={()=>setSelectedUser(u._id)}>Hoạt động</button></td></tr>)}</tbody></table></div>{!loading && !users.length && <Empty text="Không tìm thấy tài khoản phù hợp." />}<Pagination value={pagination} page={page} setPage={setPage} disabled={loading} />{selectedUser&&<UserActivity key={selectedUser} userId={selectedUser} onClose={()=>setSelectedUser(null)}/>}</section>}
        {tab === 'requests' && <MovieRequestsManager />}
        {tab === 'sessions' && <section className={panel}><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">Các phiên phát</h2><p className="mt-1 text-sm text-zinc-500">Phiên còn hạn không đồng nghĩa với đang xem. Danh sách không chứa URL phim hay token.</p></div><select className={input} style={{width:190}} aria-label="Lọc phiên phát" value={scope} onChange={e=>{setScope(e.target.value);setPage(1);}}><option value="active">Còn hạn</option><option value="all">Tất cả</option></select></div><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr>{['Nội dung','Kiểu phát','Chuẩn bị','Tạo lúc','Hết hạn'].map(h=><th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>{sessions.map(s=><tr key={s._id} className="border-b border-white/5"><td className="px-3 py-4"><div className="font-medium">{s.type==='tv'?'Phim bộ':'Phim lẻ'} · TMDB {s.tmdbId}</div>{s.type==='tv'&&<div className="mt-1 text-xs text-zinc-500">Mùa {s.season} · Tập {s.episode}</div>}</td><td className="px-3 py-4"><span className="rounded-md bg-white/5 px-2 py-1 text-xs">{s.mode || 'Chưa ghi nhận'}</span><div className="mt-1 text-xs text-zinc-500">{s.provider || '—'}</div></td><td className="px-3 py-4">{typeof s.progress==='number'?`${Math.max(0,Math.min(100,s.progress)).toFixed(0)}%`:'—'}</td><td className="whitespace-nowrap px-3 py-4 text-xs text-zinc-400">{date(s.createdAt)}</td><td className="whitespace-nowrap px-3 py-4 text-xs text-zinc-400">{date(s.expiresAt)}</td></tr>)}</tbody></table></div>{!loading&&!sessions.length&&<Empty text="Chưa có phiên phát trong phạm vi này." />}<Pagination value={pagination} page={page} setPage={setPage} disabled={loading} /></section>}
        {tab === 'providers' && <div className="grid gap-5 lg:grid-cols-2"><section className={panel}><div className="flex justify-between gap-3"><h2 className="text-lg font-semibold">Kết nối TorBox</h2><span className={`rounded-full px-3 py-1 text-xs ${provider?.connected?'bg-emerald-500/10 text-emerald-300':'bg-white/5 text-zinc-400'}`}>{provider===null?'Chưa có dữ liệu':provider.connected?'Đã kết nối':'Chưa kết nối'}</span></div><dl className="my-6 space-y-4 text-sm"><div className="flex justify-between"><dt className="text-zinc-400">Chế độ cấp nguồn</dt><dd>{provider?.mode==='shared'?'Dùng chung toàn CineVN':provider?.mode==='personal'?'Theo tài khoản':'—'}</dd></div><div className="flex justify-between"><dt className="text-zinc-400">Key được che</dt><dd>{provider?.masked || '—'}</dd></div><div className="flex justify-between"><dt className="text-zinc-400">Gói dịch vụ</dt><dd>{provider?.plan ?? 'Chưa ghi nhận'}</dd></div></dl><p className="text-sm leading-relaxed text-zinc-400">Người xem đăng nhập để sử dụng nguồn đã cấu hình. Khả năng Direct Play và 4K phụ thuộc codec, thiết bị và tốc độ nguồn.</p></section><section className={panel}><h2 className="text-lg font-semibold">Cập nhật kết nối</h2><p className="my-3 text-sm leading-relaxed text-zinc-400">Key mới được kiểm tra trước khi thay kết nối hiện tại. Nhập trực tiếp tại đây; không gửi key trong chat.</p><form onSubmit={e=>{e.preventDefault();void action(async()=>{await providerAPI.connectTorbox(apiKey.trim());setApiKey('');},'Đã kiểm tra và lưu kết nối TorBox.');}}><label htmlFor="torbox-key" className="mb-2 block text-sm">API key TorBox</label><input id="torbox-key" className={input} type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="Nhập key để kết nối hoặc thay key" /><button className={`${button} mt-4 bg-amber-400 text-black hover:bg-amber-300`} disabled={saving||loading||apiKey.trim().length<8||provider?.canManage!==true}>{saving?<Loader2 size={16} className="animate-spin" />:<ShieldCheck size={16} />}Kiểm tra & lưu kết nối</button></form></section></div>}
        {tab === 'settings' && <div className="space-y-5"><div className="grid gap-5 lg:grid-cols-2"><section className={panel}><h2 className="text-lg font-semibold">Trải nghiệm duyệt phim</h2><p className="my-3 text-sm leading-relaxed text-zinc-400">Tự chạy trailer im lặng khi rê chuột giữ trên thẻ phim. Áp dụng toàn website.</p><button className={button} disabled={saving||loading} aria-pressed={hoverTrailer} onClick={()=>void action(()=>authClient.post('/admin/site-settings/hover-trailer',{enabled:!hoverTrailer}),`Đã ${hoverTrailer?'tắt':'bật'} xem trước trailer.`)}><span className={`h-2 w-2 rounded-full ${hoverTrailer?'bg-emerald-400':'bg-zinc-500'}`} />{hoverTrailer?'Đang bật · Bấm để tắt':'Đang tắt · Bấm để bật'}</button></section><section className={panel}><h2 className="text-lg font-semibold">Màn hình tạm dừng</h2><p className="my-3 text-sm leading-relaxed text-zinc-400">Khi bấm dừng, khung hình tối dần và hiện tên phim, tập cùng mô tả ở góc trái (kiểu Netflix). Áp dụng toàn website.</p><button className={button} disabled={saving||loading} aria-pressed={pauseOverlay} onClick={()=>void action(()=>authClient.post('/admin/site-settings/pause-overlay',{enabled:!pauseOverlay}),`Đã ${pauseOverlay?'tắt':'bật'} màn hình tạm dừng.`)}><span className={`h-2 w-2 rounded-full ${pauseOverlay?'bg-emerald-400':'bg-zinc-500'}`} />{pauseOverlay?'Đang bật · Bấm để tắt':'Đang tắt · Bấm để bật'}</button></section><section className={panel}><h2 className="text-lg font-semibold">Giới hạn API danh mục phim</h2><p className="my-3 text-sm leading-relaxed text-zinc-400">Tìm kiếm, trang chủ và chi tiết phim: số yêu cầu mỗi IP trong 60 giây. Không thay giới hạn resolve, phụ đề hay segment video.</p><form onSubmit={e=>{e.preventDefault();void action(()=>authClient.post('/admin/rate-limit',{limit:Number(draftLimit)}),'Đã lưu giới hạn API danh mục. Các tiến trình áp dụng trong tối đa 10 giây.');}}><label className="mb-2 block text-sm" htmlFor="catalog-limit">Giới hạn hiện tại: {number(limit)} yêu cầu/phút</label><div className="flex gap-3"><input id="catalog-limit" className={input} type="number" min={30} max={3000} step={1} required value={draftLimit} onChange={e=>setDraftLimit(e.target.value)} /><button className={`${button} shrink-0 bg-amber-400 text-black`} disabled={saving||loading||!Number.isInteger(Number(draftLimit))||Number(draftLimit)<30||Number(draftLimit)>3000}>Lưu</button></div><p className="mt-2 text-xs text-zinc-500">Mặc định 120 · Cho phép 30–3000 · Được lưu trên máy chủ.</p></form></section></div><section className={panel}><h2 className="mb-4 text-lg font-semibold">Lịch sử thay đổi cấu hình</h2><p className="mb-4 text-sm text-zinc-500">50 thay đổi gần nhất về trailer và giới hạn API, ghi nhận từ khi nâng cấp trang quản trị.</p><div className="space-y-3">{audit.map(row=><div key={row._id} className="flex flex-wrap justify-between gap-2 border-b border-white/5 pb-3 text-sm"><div>{row.action==='hover-trailer'?`${row.details?.enabled?'Bật':'Tắt'} xem trước trailer`:row.action==='pause-overlay'?`${row.details?.enabled?'Bật':'Tắt'} màn hình tạm dừng`:row.action==='catalog-rate-limit'?`Đặt giới hạn danh mục: ${row.details?.limit} yêu cầu/phút`:row.action}<p className="mt-1 text-xs text-zinc-500">Tài khoản thực hiện: {row.actor}</p></div><time className="text-xs text-zinc-500">{date(row.createdAt)}</time></div>)}</div>{!audit.length&&!loading&&<Empty text="Chưa có thay đổi cấu hình được ghi nhận." />}</section></div>}
      </div>
    </main>
  );
}
function Empty({text}:{text:string}) { return <p className="py-10 text-center text-sm text-zinc-500">{text}</p>; }
function Pagination({value,page,setPage,disabled}:{value:Page;page:number;setPage:(page:number)=>void;disabled:boolean}) { return <div className="mt-5 flex items-center justify-between gap-3 text-sm text-zinc-400"><span>{number(value.total)} kết quả · Trang {page}/{value.pages}</span><div className="flex gap-2"><button aria-label="Trang trước" className={button} onClick={()=>setPage(page-1)} disabled={disabled||page<=1}><ChevronLeft size={16} /></button><button aria-label="Trang sau" className={button} onClick={()=>setPage(page+1)} disabled={disabled||page>=value.pages}><ChevronRight size={16} /></button></div></div>; }
