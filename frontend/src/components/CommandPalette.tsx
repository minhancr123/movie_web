'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, Film, Tv, CornerDownLeft } from 'lucide-react';
import { API_URL, IMAGE_PREFIX } from '@/lib/api';

interface PaletteItem {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: string | null;
  poster?: string | null;
  slug: string;
}

/**
 * ⌘K / Ctrl+K anywhere → instant search → Enter to the detail page. The
 * search API is debounced 250ms; arrow keys + Enter navigate; Esc closes.
 * Escape also releases focus back to the page, so the palette never traps
 * keyboard users.
 */
export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      } else if (e.key === '/' && !open) {
        // "/" opens too, unless the user is typing in an input already.
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !(e.target as HTMLElement)?.isContentEditable) {
          e.preventDefault();
          setOpen(true);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      // Mount animation settles before focus so Safari does not drop it.
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
    setQ(''); setItems([]); setActive(0);
  }, [open]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setItems([]); setLoading(false); return; }
    setLoading(true);
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/catalog/search?q=${encodeURIComponent(query)}&limit=8`, { signal: controller.signal });
        const json = await res.json();
        setItems((json?.data?.items || []).map((it: Record<string, unknown>) => ({
          tmdbId: it.tmdbId as number,
          mediaType: it.mediaType === 'tv' ? 'tv' : 'movie',
          title: String(it.title || ''),
          year: it.year ? String(it.year) : null,
          poster: it.poster ? String(it.poster) : null,
          slug: String(it.slug || ''),
        })));
        setActive(0);
      } catch { /* aborted or offline */ } finally { setLoading(false); }
    }, 250);
    return () => { controller.abort(); clearTimeout(t); };
  }, [q]);

  const go = useCallback((item: PaletteItem) => {
    if (!item?.slug) return;
    setOpen(false);
    router.push(`/phim/${item.mediaType}/${item.tmdbId}/${item.slug}`);
  }, [router]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 px-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#141519] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4">
          <Search size={18} className="shrink-0 text-amber-gold" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, items.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter') { if (items[active]) go(items[active]); }
            }}
            placeholder="Tìm phim, phim bộ… (Enter để mở)"
            className="w-full bg-transparent py-4 text-sm text-white outline-none placeholder:text-white/30"
          />
          <kbd className="hidden shrink-0 rounded border border-white/15 px-1.5 py-0.5 font-mono text-[10px] text-white/40 sm:block">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-2">
          {q.trim().length >= 2 && !loading && items.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-white/40">Không có phim nào khớp “{q.trim()}”.</p>
          )}
          {loading && items.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-white/40">Đang tìm…</p>
          )}
          {items.map((it, i) => (
            <button
              key={`${it.mediaType}-${it.tmdbId}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(it)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${i === active ? 'bg-amber-primary/15' : 'hover:bg-white/5'}`}
            >
              {it.poster ? (
                <Image src={`${IMAGE_PREFIX}${it.poster}`} alt={it.title} width={34} height={50} className="rounded object-cover" />
              ) : (
                <div className="h-[50px] w-[34px] rounded bg-white/10" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{it.title}</p>
                <p className="text-[11px] text-white/40">{it.mediaType === 'tv' ? 'Phim bộ' : 'Phim lẻ'}{it.year ? ` · ${it.year}` : ''}</p>
              </div>
              {i === active && <CornerDownLeft size={14} className="shrink-0 text-white/30" />}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2">
          <div className="flex items-center gap-3 font-mono text-[10px] text-white/30">
            <span className="flex items-center gap-1">↑↓ chọn</span>
            <span className="flex items-center gap-1">↵ mở</span>
          </div>
          <span className="font-mono text-[10px] text-white/30">CineVN</span>
        </div>
      </div>
    </div>
  );
}
