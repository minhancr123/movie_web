'use client';
import { useState } from 'react';
import type { SubCue } from '@/lib/subtitles';

export default function SubtitleSyncGuide({ cues, lookupTime, onAnchor }: {
  cues: SubCue[]; lookupTime: number; onAnchor: (start: number) => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const options = cues.filter(cue => query ? cue.text.toLocaleLowerCase().includes(query)
    : Math.abs(cue.start - lookupTime) < 30).slice(0, 20);
  return <details className="text-xs text-white/75">
    <summary className="cursor-pointer py-1 text-amber-300">Căn theo một câu thoại</summary>
    <p className="my-2 leading-relaxed">Tìm một câu dễ nghe, đợi đến lúc nhân vật bắt đầu nói rồi bấm đúng câu đó. Dùng ±0.1s để tinh chỉnh.</p>
    <input aria-label="Tìm câu phụ đề để đồng bộ" placeholder="Tìm câu đang nghe…" value={search} onChange={e => setSearch(e.target.value)} className="w-full rounded border border-white/20 bg-black/40 p-2 text-white" />
    <div className="mt-2 max-h-32 overflow-y-auto space-y-1">
      {options.map((cue, index) => <button key={`${cue.start}:${index}`} type="button" onClick={() => onAnchor(cue.start)} className="block w-full rounded bg-white/5 p-2 text-left hover:bg-white/15" title="Bấm khi nhân vật bắt đầu nói câu này">{cue.text.replace(/<[^>]*>/g, '')}</button>)}
      {!options.length && <p className="py-2">Chưa tìm thấy câu phù hợp.</p>}
    </div>
    <p className="mt-2 leading-relaxed text-white/50">Nếu càng xem càng lệch hoặc chỉ lệch sau một cảnh cắt, hãy chọn phụ đề khớp bản phim hoặc phụ đề có sẵn trong video. Một độ trễ cố định không sửa được khác tốc độ hay khác bản dựng.</p>
  </details>;
}
