'use client';

import React, { useState } from 'react';
import MovieRequestForm from './MovieRequestForm';
import { Film } from 'lucide-react';

interface MovieRequestTriggerProps {
  keyword?: string;
  /** Search-page variant shown BELOW results: smaller, different heading. */
  compact?: boolean;
  heading?: string;
}

export default function MovieRequestTrigger({ keyword = '', compact = false, heading }: MovieRequestTriggerProps) {
  const [showForm, setShowForm] = useState(false);

  if (showForm) {
    return (
      <div className={`max-w-xl animate-in fade-in slide-in-from-top-4 duration-300 ${compact ? '' : 'mt-8'}`}>
        <MovieRequestForm 
          initialTitle={keyword} 
          onSuccess={() => setShowForm(false)} 
          onCancel={() => setShowForm(false)} 
        />
      </div>
    );
  }

  if (compact) {
    return (
      <div className="glass-panel rounded-2xl border border-amber-primary/20 bg-amber-primary/5 p-5 max-w-xl animate-in fade-in duration-500">
        <h3 className="text-base font-syne font-bold text-white mb-1">
          {heading || 'Không thấy phim bạn cần trong kết quả trên?'}
        </h3>
        <p className="text-sm text-cinema-subtle mb-3 leading-relaxed">
          Gửi yêu cầu cho chúng tôi — nguồn phát chất lượng cao sẽ được cập nhật sớm nhất.
        </p>
        <button
          onClick={() => setShowForm(true)}
          className="px-5 py-2 rounded-xl bg-amber-primary hover:bg-amber-gold text-black font-bold text-sm transition-all"
        >
          Yêu cầu phim “{keyword}”
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 p-6 glass-panel rounded-2xl border border-amber-primary/20 bg-amber-primary/5 max-w-xl animate-in fade-in zoom-in duration-500">
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-amber-primary/10 text-amber-gold shrink-0">
          <Film size={24} />
        </div>
        <div>
          <h3 className="text-lg font-syne font-bold text-white mb-1">{heading || 'Không tìm thấy phim bạn cần?'}</h3>
          <p className="text-sm text-cinema-subtle mb-4 leading-relaxed">
            Đừng lo lắng! Hãy gửi yêu cầu cho chúng tôi. Đội ngũ quản trị sẽ tìm kiếm nguồn phát chất lượng cao và cập nhật sớm nhất cho bạn.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="px-6 py-2.5 rounded-xl bg-amber-primary hover:bg-amber-gold text-black font-bold text-sm transition-all shadow-lg shadow-amber-primary/10"
          >
            Gửi yêu cầu ngay
          </button>
        </div>
      </div>
    </div>
  );
}
