'use client';
import { useEffect, useRef, useState } from 'react';
import { playbackAPI } from '@/lib/api';
import { activeSkipMark, type SkipMark } from '@/lib/playback-extras';

const timeLabel = (at: number) => `${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`;

export function SeekPreview({ at, percent, sessionId }: { at: number; percent: number; sessionId?: string }) {
  const bucket = Math.floor(at);
  const [frame, setFrame] = useState<{ key: string; url: string } | null>(null);
  const key = `${sessionId}:${bucket}`;
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    let objectUrl = '', retryTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async (attempt = 0) => {
      try {
        const res = await playbackAPI.thumbnail(sessionId, bucket, controller.signal);
        if (controller.signal.aborted) return;
        if (res.status === 204 || !res.data?.size) {
          if (attempt < 2) retryTimer = setTimeout(() => void load(attempt + 1), 1500);
          return;
        }
        if (res.data.type !== 'image/jpeg' || res.data.size > 256 * 1024) return;
        objectUrl = URL.createObjectURL(res.data);
        setFrame({ key, url: objectUrl });
      } catch { /* The timestamp remains useful when a preview is unavailable. */ }
    };
    const timer = setTimeout(() => void load(), 350);
    return () => { clearTimeout(timer); clearTimeout(retryTimer); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [sessionId, bucket, key]);
  return <div aria-hidden="true" className="pointer-events-none absolute bottom-9 z-40 w-40 overflow-hidden rounded-lg border border-white/20 bg-black/95 shadow-xl" style={{ left: `clamp(80px, ${percent}%, calc(100% - 80px))`, transform: 'translateX(-50%)' }}>
    {/* Private blob URL, scoped to the owned playback session. */}
    {frame?.key === key && <img src={frame.url} alt="" className="aspect-video w-full object-contain" />}
    <div className="px-2 py-1 text-center font-mono text-xs text-white">{timeLabel(at)}</div>
  </div>;
}

export function TimelineSkip({ sessionId, at, duration, onSeek, onNext }: { sessionId?: string; at: number; duration: number; onSeek: (at: number) => void; onNext?: () => void }) {
  const [inventory, setInventory] = useState<{ sessionId: string; marks: SkipMark[] } | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    void playbackAPI.timeline(sessionId, controller.signal).then(res => {
      if (!controller.signal.aborted) setInventory({ sessionId, marks: Array.isArray(res.data?.data?.marks) ? res.data.data.marks : [] });
    }).catch(() => {});
    return () => controller.abort();
  }, [sessionId]);
  const mark = activeSkipMark(inventory && inventory.sessionId === sessionId ? inventory.marks : [], at, duration, Boolean(onNext));
  if (!mark) return null;
  const reachesEnd = mark.end >= duration - 0.5;
  const label = reachesEnd && onNext ? 'Xem tập tiếp' : mark.kind === 'intro' ? 'Bỏ qua giới thiệu' : mark.kind === 'recap' ? 'Bỏ qua tóm tắt' : 'Bỏ qua phần kết';
  return <button className="absolute bottom-28 right-4 z-30 rounded-lg border border-white/30 bg-black/80 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-white/15" onDoubleClick={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (reachesEnd && onNext) onNext(); else onSeek(mark.end); }}>{label}</button>;
}

export function NextEpisodePrompt({ ended, enabled, label, onNext, onCancel }: { ended: boolean; enabled: boolean; label: string; onNext: () => void; onCancel: () => void }) {
  const [remaining, setRemaining] = useState(8);
  const fired = useRef(false);
  const nextRef = useRef(onNext); nextRef.current = onNext;
  useEffect(() => {
    fired.current = false; setRemaining(8);
    if (!ended || !enabled) return;
    let ticks = 8;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible' || fired.current) return;
      ticks = Math.max(0, ticks - 1); setRemaining(ticks);
      if (ticks === 0) { fired.current = true; clearInterval(timer); nextRef.current(); }
    }, 1000);
    return () => clearInterval(timer);
  }, [ended, enabled, label]);
  if (!ended) return null;
  return <div role="status" aria-live="polite" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} className="absolute bottom-28 right-4 z-40 w-80 max-w-[calc(100%_-_2rem)] rounded-xl border border-white/20 bg-black/90 p-4 text-white shadow-xl">
    <p className="text-sm text-white/70">{enabled ? `Tập tiếp theo sau ${remaining} giây` : 'Tập tiếp theo'}</p>
    <p className="mt-1 font-semibold">{label}</p>
    <div className="mt-3 flex gap-2"><button onClick={() => { if (!fired.current) { fired.current = true; nextRef.current(); } }} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black">Phát ngay</button><button onClick={onCancel} className="rounded-lg border border-white/30 px-4 py-2 text-sm">Hủy</button></div>
  </div>;
}
