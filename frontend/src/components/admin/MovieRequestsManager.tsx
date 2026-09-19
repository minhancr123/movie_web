'use client';

import React, { useEffect, useState } from 'react';
import { movieRequestAPI, MovieRequestItem } from '@/lib/api';
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
  Loader2
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

  const fetchRequests = async (page = 1, status = statusFilter) => {
    setLoading(true);
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
                    </td>
                    <td className="px-6 py-4">
                      {getStatusBadge(req.status)}
                      {req.adminNote && (
                        <p className="mt-1 text-[10px] text-green-400/70 italic max-w-[200px] truncate">Admin: {req.adminNote}</p>
                      )}
                    </td>
                    <td className="px-6 py-4">
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
                              onClick={() => handleUpdateStatus(req._id, 'completed')}
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
