'use client';

import { useEffect, useId, useRef } from 'react';
import { episodeResumeLabel } from '@/lib/episode-resume';

export default function EpisodeResumeDialog({ episode, position, onChoose, onDismiss }: {
  episode: number; position: number; onChoose: (fromStart: boolean) => void; onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onDismiss(); }}
      onKeyDown={event => event.stopPropagation()}
      onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-sm rounded-2xl border border-white/15 bg-[#16171d] p-0 text-white shadow-2xl backdrop:bg-black/70 backdrop:backdrop-blur-sm">
      <div className="p-6">
        <p className="text-xs font-medium uppercase tracking-wider text-amber-gold">Đang xem dở</p>
        <h2 id={titleId} className="mt-2 text-xl font-bold">Bạn muốn xem tập {episode} từ đâu?</h2>
        <p className="mt-2 text-sm text-white/60">Lần trước bạn đã xem đến {episodeResumeLabel(position)}.</p>
        <div className="mt-6 flex flex-col gap-2.5">
          <button autoFocus onClick={() => onChoose(false)} className="rounded-xl bg-amber-primary px-4 py-3 font-bold text-black hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-gold">
            Tiếp tục từ {episodeResumeLabel(position)}
          </button>
          <button onClick={() => onChoose(true)} className="rounded-xl border border-white/20 bg-white/5 px-4 py-3 font-semibold hover:bg-white/10">Xem từ đầu</button>
          <button onClick={onDismiss} className="rounded-xl px-4 py-2 text-sm text-white/60 hover:text-white">Hủy</button>
        </div>
      </div>
    </dialog>
  );
}
