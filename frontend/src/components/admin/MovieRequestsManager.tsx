'use client';

import React, { useEffect, useState } from 'react';
import { movieRequestAPI, MovieRequestItem, TmdbMatch } from '@/lib/api';
import { getFriendlyErrorMessage } from '@/lib/i18n';
import { 
  CheckCircle2, 
  Clock, 
  XCircle, 
  MessageSquare, 
  RefreshCw, 
  ChevronLeft, 
  ChevronRight,
  Save,
  Loader2,
  Search,
  Users
} from 'lucide-react';

export default function MovieRequestsManager() {
  const [requests, setRequests] = useState<MovieRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [pagination, setPagination] = useState({ page: 1, limit: 10, total: 0, pages: 1 });
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [tmdbMatches, setTmdbMatches] = useState<{ id: string; results: TmdbMatch[] } | null>(null);

  const handleCheckTmdb = async (id: string) => {
    setCheckingId(id);
    try {
      const res = await movieRequestAPI.checkTmdb(id);
      setTmdbMatches({ id, results: res.data.data.results });
    } catch (err: any) {
      alert(getFriendlyErrorMessage(err?.response?.data?.message || err.message, true));
    } finally {
      setCheckingId(null);
    }
  };

  const handleAttachTmdb = async (id: string, tmdbId: number, mediaType: 'movie' | 'tv') => {
    setSubmitting(true);
    try {
      await movieRequestAPI.updateStatus(id, { tmdbId, mediaType });
      setTmdbMatches(null);
      fetchRequests(pagination.page);
    } catch (err: any) {
      alert(getFriendlyErrorMessage(err?.response?.data?.message || err.message, true));
    } finally {
      setSubmitting(false);
    }
  };

  const requesterCount = (req: MovieRequestItem) => req.requesters?.length ?? req.requestCount ?? 1;

  const fetchRequests = async (page = 1, status = statusFilter, quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await movieRequestAPI.getAll({ 
        page, 
        limit: pagination.limit, 
        status: status === 'all' ? undefined : status 
      });
      setRequests(res.data.data);
      setPagination(res.data.pagination);
      setError(null);
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err.message, true));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests(1, statusFilter);
  }, [statusFilter]);


  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void fetchRequests(pagination.page, statusFilter, true); }, 15000);
    return () => clearInterval(timer);
  }, [pagination.page, statusFilter]);
  const controlAutomation = async (id: string, enabled: boolean, episode?: {season:number;episode:number}) => {
    setSubmitting(true);
    try { await movieRequestAPI.controlAutomation(id, enabled, episode); await fetchRequests(pagination.page); }
    catch (err: any) { setError(err.response?.data?.message || 'Không cập nhật được xử lý tự động.'); }
    finally { setSubmitting(false); }
  };
  const autoLabels: Record<string,string> = { queued:'Đã xếp hàng', searching:'Đang tìm nguồn', waiting_source:'Chờ nguồn mới',
    waiting_slot:'Chờ lượt tải', downloading:'Đang tải trên TorBox', verifying:'Đang kiểm tra nguồn', ready:'Có thể xem',
    waiting_provider:'Chờ dịch vụ nguồn', needs_match:'Cần xác định phim/tập', paused:'Đã tạm dừng' };
  const handleUpdateStatus = async (id: string, status: 'completed' | 'rejected') => {
    setSubmitting(true);
    try {
      await movieRequestAPI.updateStatus(id, { status, adminNote });
      setEditingId(null);
      setAdminNote('');
      fetchRequests(pagination.page);
    } catch (err: any) {
      alert(getFriendlyErrorMessage(err.message, true));
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-[10px] font-bold flex items-center gap-1 w-fit"><CheckCircle2 size={10}/> Xong</span>;
      case 'rejected':
        return <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 text-[10px] font-bold flex items-center gap-1 w-fit"><XCircle size={10}/> Từ chối</span>;
      default:
        return <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold flex items-center gap-1 w-fit"><Clock size={10}/> Chờ</span>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-sm leading-relaxed text-zinc-300">Yêu cầu được tự tìm nguồn và tải nền trên TorBox. Ưu tiên nguồn có sẵn; giới hạn 1 phim tải mới mỗi lần, 3 lượt/ngày, dưới 20 GiB. Chỉ báo có phim khi nguồn đã qua kiểm tra.</div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {['pending', 'completed', 'rejected', 'all'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${
              statusFilter === s
                ? 'bg-amber-primary border-amber-primary text-black'
                : 'bg-white/5 border-white/10 text-cinema-subtle hover:bg-white/10'
            }`}
          >
            {s === 'pending' ? 'Chờ xử lý' : s === 'completed' ? 'Đã xong' : s === 'rejected' ? 'Từ chối' : 'Tất cả'}
          </button>
        ))}
        <button 
          onClick={() => fetchRequests(pagination.page)}
          className="ml-auto p-2 bg-white/5 border border-white/10 rounded-xl text-white hover:bg-white/10 transition-all"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">{error}</div>}

      {tmdbMatches && (
        <div className="glass-panel rounded-2xl border border-amber-primary/30 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-white">Kết quả TMDB — gắn vào yêu cầu</p>
            <button onClick={() => setTmdbMatches(null)} className="text-xs text-cinema-subtle hover:text-white">Đóng</button>
          </div>
          {tmdbMatches.results.length === 0 ? (
            <p className="text-sm text-cinema-subtle">TMDB không có phim nào khớp tiêu đề này.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tmdbMatches.results.map((m) => (
                <button
                  key={`${m.tmdbId}-${m.mediaType}`}
                  onClick={() => handleAttachTmdb(tmdbMatches.id, m.tmdbId, m.mediaType)}
                  disabled={submitting}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2 text-left hover:border-amber-primary/40 hover:bg-white/10 transition-all disabled:opacity-50"
                >
                  {m.poster ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.poster} alt={m.title} className="h-16 w-11 rounded object-cover shrink-0" />
                  ) : (
                    <div className="h-16 w-11 rounded bg-white/10 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-white">{m.title}</p>
                    <p className="text-[10px] text-cinema-subtle">{m.mediaType === 'tv' ? 'Phim bộ' : 'Phim lẻ'} {m.year ? `· ${m.year}` : ''} · TMDB {m.tmdbId}</p>
                    <p className="mt-1 text-[10px] font-bold text-amber-gold">Gắn vào yêu cầu</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="glass-panel overflow-hidden rounded-2xl border border-white/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white/5 border-b border-white/10">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-cinema-subtle">Phim / Yêu cầu</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-cinema-subtle">Người gửi</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-cinema-subtle">Trạng thái</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-cinema-subtle">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-cinema-subtle">
                    <Loader2 className="animate-spin mx-auto mb-2" /> Đang tải...
                  </td>
                </tr>
              ) : requests.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-cinema-subtle">Không có yêu cầu nào.</td>
                </tr>
              ) : (
                requests.map((req) => (
                  <tr key={req._id} className="hover:bg-white/5 transition-colors group">
                    <td className="px-6 py-4">
                      <p className="text-sm font-bold text-white group-hover:text-amber-gold transition-colors">{req.title}</p>
                      {req.tmdbId ? (
                        <><a href={`https://www.themoviedb.org/${req.mediaType || 'movie'}/${req.tmdbId}`} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[10px] font-bold text-emerald-400 hover:text-emerald-300">
                          TMDB {String(req.tmdbId)} ↗
                        </a><button disabled={checkingId===req._id} className="ml-2 text-[10px] text-zinc-400 hover:text-amber-300" onClick={()=>void handleCheckTmdb(req._id)}>Xác định lại phim</button></>
                      ) : (
                        <button onClick={() => handleCheckTmdb(req._id)} disabled={checkingId === req._id} className="mt-1 flex items-center gap-1 text-[10px] font-bold text-cinema-subtle hover:text-amber-gold transition-colors disabled:opacity-50">
                          {checkingId === req._id ? <Loader2 size={10} className="animate-spin" /> : <Search size={10} />} Tìm trên TMDB
                        </button>
                      )}
                      {req.note && (
                        <div className="mt-1 flex items-start gap-1.5 text-[11px] text-cinema-subtle">
                          <MessageSquare size={10} className="mt-0.5 shrink-0" />
                          <span className="italic">{req.note}</span>
                        </div>
                      )}
                      <p className="mt-1 text-[10px] text-white/20 font-mono">{new Date(req.createdAt).toLocaleString('vi-VN')}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs text-white/70">{req.username}</span>
                      {requesterCount(req) > 1 && (
                        <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-amber-400 w-fit" title={(req.requesters || []).map(r => r.name).join(', ')}>
                          <Users size={10} /> {requesterCount(req)} người xin
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(req.status)}
                      {req.automation && <div className="mt-2 max-w-[280px] space-y-1 text-xs">
                        <p className={req.automation.state==='ready'?'font-bold text-emerald-300':'font-medium text-amber-300'}>{autoLabels[req.automation.state || 'queued'] || 'Đang xử lý'}{req.automation.state==='downloading'?` · ${Math.round(req.automation.progress || 0)}%`:''}</p>
                        {req.automation.state==='downloading'&&<progress className="h-1.5 w-full accent-amber-400" max={100} value={req.automation.progress || 0}/>}
                        <p className="text-zinc-400">{req.automation.message}</p>
                        {req.automation.lastCheckedAt&&<p className="text-[10px] text-zinc-500">Kiểm tra: {new Date(req.automation.lastCheckedAt).toLocaleString('vi-VN')}</p>}
                        {req.status==='pending'&&req.automation.enabled!==false&&req.automation.nextAttemptAt&&<p className="text-[10px] text-zinc-500">Lần tiếp: {new Date(req.automation.nextAttemptAt).toLocaleString('vi-VN')}</p>}
                      </div>}
                      {req.mediaType==='tv'&&req.status==='pending'&&req.automation?.state==='needs_match'&&<form className="mt-2 flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void controlAutomation(req._id,true,{season:Number(f.get('season')),episode:Number(f.get('episode'))});}}><input aria-label="Mùa" name="season" type="number" min={0} max={999} defaultValue={1} required className="w-16 rounded bg-white/5 p-2"/><input aria-label="Tập" name="episode" type="number" min={1} max={999} defaultValue={1} required className="w-16 rounded bg-white/5 p-2"/><button disabled={submitting} className="rounded bg-amber-400/10 p-2 text-amber-300">Tìm tập này</button></form>}
                      {req.status==='completed'&&req.tmdbId&&<a className="mt-2 block text-xs font-bold text-emerald-300" href={`/xem-phim/${req.mediaType || 'movie'}/${req.tmdbId}/phim`}>Mở phim ↗</a>}

                      {req.adminNote && (
                        <p className="mt-1 text-[10px] text-green-400/70 italic max-w-[200px] truncate">Admin: {req.adminNote}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {req.status==='pending'&&<div className="mb-3 flex flex-wrap gap-2"><button disabled={submitting} className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-300 disabled:opacity-50" onClick={()=>void controlAutomation(req._id,true)}>Tìm lại ngay</button><button disabled={submitting} className="rounded-lg bg-white/5 px-3 py-2 text-xs text-zinc-300 disabled:opacity-50" onClick={()=>void controlAutomation(req._id,req.automation?.enabled===false)}>{req.automation?.enabled===false?'Tiếp tục tự xử lý':'Tạm dừng tự xử lý'}</button></div>}
                      {editingId === req._id ? (
                        <div className="flex flex-col gap-2">
                          <input 
                            type="text" 
                            placeholder="Ghi chú admin..."
                            value={adminNote}
                            onChange={(e) => setAdminNote(e.target.value)}
                            className="text-[11px] bg-black/40 border border-white/10 rounded px-2 py-1 text-white"
                          />
                          <div className="flex gap-2">
                            <button 
                              disabled={req.automation?.state!=='ready'} onClick={() => handleUpdateStatus(req._id, 'completed')}
                              className="text-[10px] bg-green-600 hover:bg-green-500 text-white px-2 py-1 rounded font-bold transition-all"
                            >Xong</button>
                            <button 
                              onClick={() => handleUpdateStatus(req._id, 'rejected')}
                              className="text-[10px] bg-red-600 hover:bg-red-500 text-white px-2 py-1 rounded font-bold transition-all"
                            >Từ chối</button>
                            <button 
                              onClick={() => setEditingId(null)}
                              className="text-[10px] bg-white/10 hover:bg-white/20 text-white px-2 py-1 rounded font-bold transition-all"
                            >Hủy</button>
                          </div>
                        </div>
                      ) : (
                        <button 
                          onClick={() => {
                            setEditingId(req._id);
                            setAdminNote(req.adminNote || '');
                          }}
                          className="p-2 rounded-lg bg-white/5 text-cinema-subtle hover:bg-amber-primary hover:text-black transition-all"
                        >
                          <Save size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div className="flex justify-center items-center gap-4 pt-4">
          <button
            disabled={pagination.page <= 1}
            onClick={() => fetchRequests(pagination.page - 1)}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-white disabled:opacity-30"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="text-xs font-bold text-cinema-subtle">
            Trang {pagination.page} / {pagination.pages}
          </span>
          <button
            disabled={pagination.page >= pagination.pages}
            onClick={() => fetchRequests(pagination.page + 1)}
            className="p-2 rounded-xl bg-white/5 border border-white/10 text-white disabled:opacity-30"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}
