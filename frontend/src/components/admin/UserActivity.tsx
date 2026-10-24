'use client';
import { useEffect, useState } from 'react';
import { Loader2, X, AlertCircle } from 'lucide-react';
import { authClient } from '@/lib/api';

type Context = { at?: string; provider?: string; ip?: string | null; userAgent?: string; device?: { browser?: string; os?: string; type?: string } };
type Event = Context & { _id: string; action: string; outcome: string; evidence: string; note?: string };
type Activity = { user: { username?: string; email?: string; createdAt?: string; authProvider?: string; registration?: Context; lastLogin?: Context }; events: Event[]; history: { _id: string; movieData?: { name?: string }; tmdbId?: number; watchedAt?: string; currentTime?: number }[]; retentionDays: number };
const date = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : 'Chưa ghi nhận';
const provider = (value?: string) => value === 'google' ? 'Google' : value === 'local' ? 'Email / mật khẩu' : value === 'local_and_google' ? 'Email và Google' : 'Email / chưa ghi rõ';
export default function UserActivity({userId,onClose}:{userId:string;onClose:()=>void}) {
  const [data,setData] = useState<Activity | null>(null);
  const [error,setError] = useState('');
  useEffect(()=>{
    const controller = new AbortController();
    setData(null);setError('');
    authClient.get(`/admin/users/${encodeURIComponent(userId)}/activity`,{signal:controller.signal,timeout:15000})
      .then(r=>setData(r.data.data)).catch(e=>{if(!controller.signal.aborted)setError(e.response?.data?.message||'Không tải được hoạt động tài khoản.');});
    return ()=>controller.abort();
  },[userId]);
  return <section className="mt-6 rounded-2xl border border-amber-400/20 bg-black/20 p-5" aria-label="Chi tiết hoạt động tài khoản">
    <div className="mb-4 flex items-start justify-between gap-4"><div><h3 className="text-lg font-semibold">Hoạt động tài khoản {data?.user.username || ''}</h3><p className="mt-1 text-sm text-zinc-400">{data?.user.email}</p></div><button aria-label="Đóng chi tiết tài khoản" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10"><X size={18}/></button></div>
    {error&&<p role="alert" className="text-sm text-red-300">{error}</p>}
    {!data&&!error&&<p className="flex items-center gap-2 text-sm text-zinc-400"><Loader2 className="animate-spin" size={16}/>Đang tải hoạt động…</p>}
    {data&&<>
      <div className="grid gap-4 text-sm sm:grid-cols-3"><div><p className="text-zinc-500">Tạo tài khoản</p><p className="mt-1">{date(data.user.createdAt)}</p></div><div><p className="text-zinc-500">Cách đăng nhập</p><p className="mt-1">{provider(data.user.authProvider || data.user.lastLogin?.provider)}</p></div><div><p className="text-zinc-500">Đăng nhập gần nhất đã ghi nhận</p><p className="mt-1">{date(data.user.lastLogin?.at)}</p></div></div>
      <p className="my-5 flex gap-2 rounded-xl border border-white/10 bg-white/5 p-3 text-xs leading-relaxed text-zinc-400"><AlertCircle size={16} className="mt-0.5 shrink-0"/>Thiết bị và hệ điều hành được suy ra từ User-Agent, có thể bị giả lập. Tài khoản cũ có thể chưa có IP/thiết bị. Dấu vết đối chiếu log cũ chỉ là tương quan thời gian; không chứng minh ai sở hữu máy hoặc có xâm nhập.</p>
      <h4 className="mb-3 text-sm font-semibold">Lịch sử xác thực · tối đa 50 sự kiện / {data.retentionDays} ngày</h4>
      <div className="space-y-3">{data.events.map(e=><article key={e._id} className="rounded-xl border border-white/10 p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{e.action==='register'?'Tạo tài khoản':e.action==='google-callback'?'Callback Google · đối chiếu log':'Đăng nhập'} · {provider(e.provider)}</strong><time className="text-xs text-zinc-500">{date(e.at)}</time></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-zinc-500">Kết quả / nguồn bằng chứng</p><p className="mt-1">{e.evidence==='historical-correlation'?'Chỉ đối chiếu thời gian':e.outcome==='success'?'Thành công':e.outcome==='failure'?'Thất bại':'Đã quan sát'}</p></div><div><p className="text-xs text-zinc-500">IP</p><p className="mt-1 break-all font-mono text-xs">{e.ip || 'Không có IP gốc'}</p></div><div><p className="text-xs text-zinc-500">Trình duyệt / HĐH khai báo</p><p className="mt-1">{e.device?.browser || 'Không rõ'} · {e.device?.os || 'Không rõ'}</p><p className="text-xs text-zinc-500">{e.device?.type}</p></div></div>{e.note&&<p className="mt-3 text-xs text-amber-200/70">{e.note}</p>}{e.userAgent&&<details className="mt-3 text-xs text-zinc-500"><summary className="cursor-pointer">Xem User-Agent gốc</summary><p className="mt-2 break-all rounded-lg bg-black/20 p-2 font-mono">{e.userAgent}</p></details>}</article>)}</div>
      {!data.events.length&&<p className="py-5 text-sm text-zinc-500">Chưa có lịch sử xác thực được lưu. Thông tin mới sẽ xuất hiện sau lần đăng nhập tiếp theo.</p>}
      <h4 className="mb-3 mt-6 text-sm font-semibold">Hoạt động xem đã lưu gần nhất</h4>
      {data.history.map(h=><div key={h._id} className="flex flex-wrap justify-between gap-2 border-t border-white/5 py-3 text-sm"><span>{h.movieData?.name || `Nội dung TMDB ${h.tmdbId || 'chưa rõ'}`}{typeof h.currentTime==='number'?` · ${Math.floor(h.currentTime/60)}:${String(Math.floor(h.currentTime%60)).padStart(2,'0')}`:''}</span><time className="text-xs text-zinc-500">{date(h.watchedAt)}</time></div>)}
      {!data.history.length&&<p className="text-sm text-zinc-500">Chưa có lịch sử xem được lưu.</p>}
    </>}
  </section>;
}
