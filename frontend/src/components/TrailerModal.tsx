'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Play, ExternalLink } from 'lucide-react';
import { API_URL } from '@/lib/api';

/**
 * Trailer player with a hardened URL fallback chain.
 *
 * YouTube embed "URL errors" come from three real sources: a null/invalid
 * key rendered straight into /embed/, a key deleted or embed-disabled on
 * YouTube while every cache layer still serves it, and relying on iframe
 * onerror (which never fires cross-origin). Here: keys validated up front,
 * errors detected through the YouTube IFrame API (codes 2/100/101/150),
 * the next candidate tried, then a fresh /catalog/videos lookup that
 * bypasses the long-lived detail cache, and finally an honest fallback
 * panel with a direct YouTube link.
 */

const YT_IFRAME_API = 'https://www.youtube.com/iframe_api';

let ytApiPromise: Promise<any> | null = null;
const loadYouTubeApi = (): Promise<any> => {
  if (typeof window === 'undefined') return Promise.reject(new Error('ssr'));
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (!ytApiPromise) {
    ytApiPromise = new Promise((resolve, reject) => {
      const previous = w.onYouTubeIframeAPIReady;
      w.onYouTubeIframeAPIReady = () => { previous?.(); resolve(w.YT); };
      const tag = document.createElement('script');
      tag.src = YT_IFRAME_API;
      tag.async = true;
      tag.onerror = () => reject(new Error('iframe_api load failed'));
      document.head.appendChild(tag);
      setTimeout(() => reject(new Error('iframe_api timeout')), 8000);
    });
  }
  return ytApiPromise;
};

const isValidKey = (key: unknown): key is string =>
  typeof key === 'string' && /^[A-Za-z0-9_-]{6,20}$/.test(key);

interface TrailerModalProps {
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  keys: string[];
  onClose: () => void;
}

export function TrailerModal({ type, tmdbId, title, keys: initialKeys, onClose }: TrailerModalProps) {
  const [keys, setKeys] = useState<string[]>(() => initialKeys.filter(isValidKey));
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const [freshTried, setFreshTried] = useState(false);
  const playerHostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const triedRef = useRef<Set<string>>(new Set());

  const mountPlayer = useCallback((key: string) => {
    if (!playerHostRef.current) return;
    playerRef.current?.destroy?.();
    playerHostRef.current.innerHTML = '';
    const mount = document.createElement('div');
    mount.id = `trailer-yt-${key}`;
    playerHostRef.current.appendChild(mount);
    loadYouTubeApi().then((YT) => {
      playerRef.current = new YT.Player(mount.id, {
        videoId: key,
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onError: () => {
            triedRef.current.add(key);
            advance();
          },
        },
      });
    }).catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = useCallback(async () => {
    const next = keys.findIndex((k) => !triedRef.current.has(k));
    if (next !== -1) { setIndex(next); return; }
    if (!freshTried) {
      setFreshTried(true);
      try {
        const res = await fetch(`${API_URL}/catalog/videos/${type}/${tmdbId}`);
        const body = await res.json();
        const fresh: string[] = (body?.data?.trailerKeys || []).filter(isValidKey);
        const unseen = fresh.filter((k) => !triedRef.current.has(k) && !keys.includes(k));
        if (unseen.length) {
          setKeys((prev) => [...prev, ...unseen]);
          setIndex(keys.length); // first unseen key sits right after current tail
          return;
        }
      } catch { /* fall through to failed */ }
    }
    setFailed(true);
  }, [keys, freshTried, type, tmdbId]);

  useEffect(() => {
    const key = keys[index];
    if (!key || failed) return;
    mountPlayer(key);
    return () => { playerRef.current?.destroy?.(); playerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, keys, failed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const currentKey = keys[index];
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Trailer: ${title}`}
    >
      <div
        className="relative w-full max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <p className="truncate text-sm font-semibold text-white">Trailer · {title}</p>
          <button onClick={onClose} aria-label="Đóng" className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="aspect-video w-full">
          {failed ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="text-cinema-muted text-sm">Trailer hiện không phát được nhúng (video đã bị xoá hoặc chặn nhúng).</p>
              {currentKey && (
                <a
                  href={`https://www.youtube.com/watch?v=${currentKey}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-primary px-4 py-2 text-sm font-semibold text-black hover:bg-amber-gold"
                >
                  <ExternalLink size={16} /> Mở trên YouTube
                </a>
              )}
            </div>
          ) : (
            <div ref={playerHostRef} className="h-full w-full [&>div]:h-full [&>div]:w-full [&_iframe]:h-full [&_iframe]:w-full" />
          )}
        </div>
      </div>
    </div>
  );
}

interface TrailerButtonProps {
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  keys: (string | null | undefined)[];
}

/** Entry button — renders nothing when there is no plausible key. */
export function TrailerButton({ type, tmdbId, title, keys }: TrailerButtonProps) {
  const [open, setOpen] = useState(false);
  const valid = keys.filter(isValidKey);
  if (valid.length === 0 && !open) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-full border border-white/25 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-amber-primary/60 hover:bg-white/5"
      >
        <Play size={16} className="text-amber-gold" /> Xem trailer
      </button>
      {open && (
        <TrailerModal type={type} tmdbId={tmdbId} title={title} keys={valid} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
