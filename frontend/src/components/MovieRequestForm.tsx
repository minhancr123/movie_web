'use client';

import React, { useState } from 'react';
import { movieRequestAPI } from '@/lib/api';
import { getFriendlyErrorMessage } from '@/lib/i18n';
import { Send, Film, X, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

interface MovieRequestFormProps {
  initialTitle?: string;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function MovieRequestForm({ initialTitle = '', onSuccess, onCancel }: MovieRequestFormProps) {
  const [title, setTitle] = useState(initialTitle);
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await movieRequestAPI.create({ title, note });
      setSuccess(true);
      if (onSuccess) setTimeout(onSuccess, 2000);
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err.response?.data?.message || err.message, true));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="glass-panel p-6 rounded-2xl border border-green-500/30 text-center animate-in fade-in zoom-in duration-300">
        <div className="flex justify-center mb-4">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
            <CheckCircle2 size={32} />
          </div>
        </div>
        <h3 className="text-xl font-syne font-bold text-white mb-2">Gửi yêu cầu thành công!</h3>
        <p className="text-cinema-subtle text-sm">
          Cảm ơn bạn đã đóng góp. Chúng tôi sẽ sớm cập nhật phim này.
        </p>
      </div>
    );
  }

  return (
    <div className="glass-panel p-6 rounded-2xl border border-white/10 shadow-2xl">
      <div className="flex justify-between items-center mb-6">
        <h3 className="text-xl font-syne font-bold text-white flex items-center gap-2">
          <Film className="text-amber-gold" size={24} />
          Yêu cầu phim mới
        </h3>
        {onCancel && (
          <button onClick={onCancel} className="text-cinema-subtle hover:text-white transition-colors">
            <X size={20} />
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-cinema-subtle mb-1.5 ml-1">
            Tên phim muốn xem *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ví dụ: Lật Mặt 7, Deadpool & Wolverine..."
            required
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-amber-primary/50 focus:ring-1 focus:ring-amber-primary/20 transition-all"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-cinema-subtle mb-1.5 ml-1">
            Ghi chú thêm (năm sản xuất, link TMDB...)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Bạn có thông tin gì thêm không?"
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-amber-primary/50 focus:ring-1 focus:ring-amber-primary/20 transition-all resize-none"
          />
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <button
          type="submit"
          disabled={isSubmitting || !title.trim()}
          className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-amber-primary hover:bg-amber-gold disabled:bg-white/10 text-black font-bold transition-all shadow-lg shadow-amber-primary/20"
        >
          {isSubmitting ? (
            <Loader2 className="animate-spin" size={20} />
          ) : (
            <>
              <Send size={18} />
              Gửi yêu cầu ngay
            </>
          )}
        </button>
        
        <p className="text-[10px] text-center text-cinema-subtle italic">
          * Chúng tôi sẽ ưu tiên những phim có nhiều lượt yêu cầu nhất.
        </p>
      </form>
    </div>
  );
}
