'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  useWatchHistory,
  useSavedMovies,
  useLocalStorage,
} from '@/hooks/useLocalStorage';
import { useMissingPosters, searchPosters, resolveResumeHref, isResolvableSlug } from '@/hooks/usePosterBackfill';
import { IMAGE_PREFIX } from '@/lib/api';
import { fromStoredRecord, catalogHref, watchHref } from '@/lib/catalog';
import SpatialShader from '@/components/SpatialShader';

type TabId = 'later' | 'done';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'later', label: 'Xem sau', icon: 'bookmark' },
  { id: 'done', label: 'Đã xem xong', icon: 'file_download_done' },
];

const QUALITIES = ['4K Ultra', '1080p HD', '720p'];

const formatGB = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

const posterSrc = (url: string) =>
  url?.startsWith('http') ? url : `${IMAGE_PREFIX}${url}`;

const pctOf = (progress?: number, duration?: number) =>
  Math.min(((progress || 0) / (duration || 2700)) * 100, 100);

export default function DownloadsPage() {
  const { history, removeFromHistory, patchHistoryPosters } = useWatchHistory();
  const { savedMovies, toggleSaveMovie } = useSavedMovies();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<TabId>('later');
  const [quota, setQuota] = useState<{ usage: number; total: number } | null>(null);
  const [online, setOnline] = useState(true);
  const [netDetail, setNetDetail] = useState('');
  const [notice, setNotice] = useState('');
  const [prefs, setPrefs] = useLocalStorage('dl_prefs', {
    autoNext: true,
    autoDelete: false,
    quality: QUALITIES[0],
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  // Real browser storage telemetry (Storage API).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const est = await navigator.storage?.estimate();
        if (!cancelled && est) {
          setQuota({ usage: est.usage || 0, total: est.quota || 0 });
        }
      } catch {
        // Storage API unavailable — card falls back to library stats
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Real connectivity telemetry.
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
      const conn = (navigator as unknown as { connection?: { effectiveType?: string; downlink?: number } }).connection;
      setNetDetail(
        conn
          ? `${conn.effectiveType || ''}${conn.downlink ? ` · ${conn.downlink}Mb/s` : ''}`.trim()
          : ''
      );
    };
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const done = useMemo(
    () => history.filter((h) => pctOf(h.progress, h.duration) >= 90),
    [history]
  );
  const later = useMemo(
    () =>
      savedMovies
        .map((saved: { id: string; name: string; origin_name?: string; poster_url: string }) =>
          fromStoredRecord({
            contentRef: saved.id,
            movieData: {
              name: saved.name,
              originName: saved.origin_name,
              posterUrl: saved.poster_url,
            },
          })
        )
        .filter((item) => item !== null),
    [savedMovies]
  );

  const counts: Record<TabId, number> = {
    later: later.length,
    done: done.length,
  };

  // Heal rows saved before artwork was recorded: exact match on contentRef
  // first, title-search fallback; persist into local history, merge the rest.
  const missing = useMemo(() => {
    const items: { name: string; ref?: string }[] = history
      .filter((h) => !h.poster_url)
      .map((h) => ({ name: h.name, ref: h.id }));
    later.forEach((item) => {
      if (item && !item.poster) items.push({ name: item.title, ref: item.contentRef });
    });
    return items;
  }, [history, later]);
  const backfilled = useMissingPosters(missing);
  useEffect(() => {
    const patches: Record<string, string> = {};
    history.forEach((h) => {
      if (!h.poster_url) {
        const poster = backfilled[h.id] || backfilled[(h.name || '').toLowerCase()];
        if (poster) patches[h.slug] = poster;
      }
    });
    patchHistoryPosters(patches);
  }, [history, backfilled, patchHistoryPosters]);

  const lookupPoster = (name: string, ref: string, stored: string) =>
    stored || backfilled[ref] || backfilled[(name || '').toLowerCase()] || '';
  const historyPoster = (h: { name: string; id: string; poster_url: string }) =>
    lookupPoster(h.name, h.id, h.poster_url);

  // Legacy slugs 404 on the watch route — resolve by title before navigating.
  const router = useRouter();
  const [resolving, setResolving] = useState<Record<string, boolean>>({});
  const goResume = async (
    e: React.MouseEvent,
    h: { slug: string; name: string; currentEpisode?: string }
  ) => {
    if (isResolvableSlug(h.slug)) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (resolving[h.slug]) return;
    setResolving((prev) => ({ ...prev, [h.slug]: true }));
    try {
      router.push(await resolveResumeHref(h.slug, h.name, h.currentEpisode));
    } finally {
      setResolving((prev) => ({ ...prev, [h.slug]: false }));
    }
  };

  // Manual fix for fuzzy-matched artwork: rotate same-title candidates.
  const [cycling, setCycling] = useState<Record<string, boolean>>({});
  const cyclePoster = async (slug: string, name: string, current: string) => {
    if (cycling[slug]) return;
    setCycling((prev) => ({ ...prev, [slug]: true }));
    try {
      const candidates = await searchPosters(name);
      if (candidates.length === 0) return;
      const next = candidates[(candidates.indexOf(current) + 1) % candidates.length];
      if (next && next !== current) patchHistoryPosters({ [slug]: next });
    } finally {
      setCycling((prev) => ({ ...prev, [slug]: false }));
    }
  };

  const cleanupDone = () => {
    if (done.length === 0) {
      setNotice('Không có mục nào đã xem xong để dọn.');
      return;
    }
    done.forEach((h) => removeFromHistory(h.slug));
    setNotice(`Đã dọn ${done.length} mục đã xem khỏi thiết bị.`);
  };

  const cycleQuality = () => {
    const idx = QUALITIES.indexOf(prefs.quality);
    setPrefs({ ...prefs, quality: QUALITIES[(idx + 1) % QUALITIES.length] });
    setNotice('');
  };

  if (!mounted) {
    return (
      <div className="mx-auto max-w-3xl px-4 pb-28 pt-8 md:pb-8">
        <div className="glass-panel animate-pulse rounded-2xl p-6">
          <div className="h-6 w-48 rounded bg-white/10" />
          <div className="mt-4 h-2.5 rounded-full bg-white/10" />
        </div>
      </div>
    );
  }

  const usedPct = quota && quota.total > 0 ? Math.min((quota.usage / quota.total) * 100, 100) : 0;

  return (
    <div className="relative mx-auto max-w-3xl px-4 pb-28 pt-8 md:pb-8">
      <div className="pointer-events-none fixed inset-0 z-0 opacity-40">
        <SpatialShader opacity={1} speed={1.2} />
      </div>

      <div className="relative z-10">
        {/* Page title */}
        <div className="mb-5 flex items-end justify-between gap-4">
          <div className="border-l-4 border-amber-primary pl-3">
            <span className="font-mono text-label-md uppercase text-amber-gold">
              Thư viện ngoại tuyến
            </span>
            <h1 className="font-syne text-headline-md text-white md:text-headline-xl">
              Tải xuống của tôi
            </h1>
          </div>
          <span className="rounded-full bg-surface-container-high px-3 py-1 font-mono text-badge-numeric text-amber-gold">
            {later.length + done.length} mục
          </span>
        </div>

        {/* Storage Overview & Telemetry Card (Stitch) */}
        <section className="glass-panel relative overflow-hidden rounded-2xl p-4 shadow-glass-card md:p-5">
          <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-amber-primary/10 blur-3xl"></div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[22px] text-amber-gold">sd_card</span>
              <span className="text-headline-sm font-semibold text-white">Bộ nhớ ngoại tuyến</span>
            </div>
            <span className="rounded-full bg-surface-container-high px-2.5 py-0.5 font-mono text-badge-numeric text-amber-gold">
              {quota ? `${formatGB(quota.total)} Tổng` : '— Tổng'}
            </span>
          </div>

          <div className="flex items-baseline justify-between pt-2">
            <div className="flex items-baseline gap-1.5">
              <span className="font-syne text-headline-xl-mobile font-bold text-amber-gold">
                {quota ? formatGB(quota.usage).replace(' GB', '') : '—'}
              </span>
              <span className="font-mono text-label-md text-cinema-muted">GB đã dùng</span>
            </div>
            <span className="font-mono text-label-sm uppercase tracking-wider text-cinema-muted">
              {quota ? `Còn trống ${formatGB(Math.max(quota.total - quota.usage, 0))}` : 'Trình duyệt không báo dung lượng'}
            </span>
          </div>

          <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-container-highest">
            <div
              className="h-full bg-gradient-to-r from-amber-primary to-amber-gold transition-all duration-500"
              style={{ width: `${usedPct}%` }}
              title="Dữ liệu ngoại tuyến"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-3">
            <button
              type="button"
              onClick={cleanupDone}
              className="flex h-10 items-center justify-center gap-2 rounded-lg bg-surface-container-highest px-3 font-mono text-label-md text-white transition-all hover:bg-surface-bright active:scale-98"
            >
              <span className="material-symbols-outlined text-[18px] text-amber-gold">
                cleaning_services
              </span>
              <span>Dọn mục đã xem</span>
            </button>
            <div className="flex h-10 items-center justify-center gap-2 rounded-lg bg-surface-container-highest px-3 font-mono text-label-md text-white">
              <span
                className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-400' : 'bg-wine-accent'}`}
              />
              <span className="truncate">
                {online ? `Trực tuyến${netDetail ? ` · ${netDetail}` : ''}` : 'Ngoại tuyến'}
              </span>
            </div>
          </div>

          {notice && (
            <p className="mt-3 rounded-lg border border-amber-primary/20 bg-amber-primary/10 px-3 py-2 text-body-sm text-amber-gold">
              {notice}
            </p>
          )}
        </section>

        {/* Filter tabs (Stitch) */}
        <section className="hide-scrollbar -mx-4 mt-5 overflow-x-auto px-4" style={{ scrollbarWidth: 'none' }}>
          <div className="flex min-w-max items-center gap-2 pb-1">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex h-9 items-center gap-1.5 rounded-full px-4 font-mono text-label-md transition-all ${
                    active
                      ? 'bg-amber-primary font-bold text-surface-dark shadow-amber-button'
                      : 'bg-surface-container text-cinema-muted hover:bg-surface-container-high hover:text-white'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{t.icon}</span>
                  <span>
                    {t.label} ({counts[t.id]})
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Section header */}
        <div className="mb-3 mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-syne text-headline-md text-white">
              {tab === 'later' && 'Xem sau'}
              {tab === 'done' && 'Đã xem xong'}
            </span>
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-gold"></span>
          </div>
          <Link
            href="/"
            className="font-mono text-label-md text-cinema-muted transition-colors hover:text-amber-gold"
          >
            Xem dở dang ở trang chủ →
          </Link>
        </div>

        {/* Media cards */}
        {tab === 'later' && (
          <section className="flex flex-col gap-3">
            {later.length === 0 && (
              <EmptyState
                title="Danh sách xem sau đang trống"
                hint="Nhấn biểu tượng lưu trên trang phim để thêm vào đây."
              />
            )}
            {later.map((item) => {
              const poster = item ? lookupPoster(item.title, item.contentRef, item.poster) : '';
              return (
              <article
                key={item.contentRef}
                className="glass-panel flex gap-3 overflow-hidden rounded-2xl p-3 shadow-glass-card transition active:scale-[0.99]"
              >
                <div className="relative h-36 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-surface-container-highest shadow-md">
                  {poster ? (
                    <Image
                      src={poster}
                      alt={item.title}
                      fill
                      sizes="96px"
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-2 text-center text-body-sm font-semibold text-cinema-muted">
                      {item.title}
                    </div>
                  )}
                  <div className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded bg-surface-dark/80 px-1 py-0.5 backdrop-blur-md">
                    <span className="material-symbols-outlined text-[12px] text-cyan-accent">
                      bookmark
                    </span>
                    <span className="font-mono text-label-sm uppercase text-cyan-accent">
                      Đã lưu
                    </span>
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                  <div>
                    <div className="flex items-start justify-between gap-1">
                      <h3 className="truncate font-syne text-headline-sm text-white">
                        {item.title}
                      </h3>
                      <button
                        type="button"
                        aria-label="Bỏ lưu phim này"
                        onClick={() =>
                          toggleSaveMovie({
                            id: item.contentRef,
                            slug: item.slug,
                            name: item.title,
                            poster_url: item.poster,
                          })
                        }
                        className="p-1 text-cinema-muted transition-colors hover:text-white"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className="rounded bg-surface-container-highest px-1.5 py-0.5 font-mono text-label-sm text-cinema-text">
                        {item.mediaType === 'tv' ? 'Phim bộ' : 'Phim lẻ'}
                      </span>
                      {item.year && (
                        <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-label-sm text-cinema-muted">
                          {item.year}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Link
                      href={catalogHref(item)}
                      className="font-mono text-label-sm text-cinema-muted transition-colors hover:text-amber-gold"
                    >
                      Chi tiết
                    </Link>
                    <Link
                      href={watchHref(item)}
                      className="flex h-8 items-center gap-1 rounded-full bg-amber-primary px-4 font-mono text-label-md text-surface-dark shadow-amber-button transition-all hover:bg-amber-gold"
                    >
                      <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                      <span>Phát ngay</span>
                    </Link>
                  </div>
                </div>
              </article>
              );
            })}
          </section>
        )}

        {tab === 'done' && (
          <section className="flex flex-col gap-3">
            {done.length === 0 && (
              <EmptyState
                title="Chưa xem xong phim nào"
                hint="Xem hết trên 90% thời lượng, phim sẽ tự chuyển vào đây."
              />
            )}
            {done.map((h) => {
              const poster = historyPoster(h);
              return (
              <article
                key={h.slug}
                className="glass-panel flex gap-3 overflow-hidden rounded-2xl p-3 opacity-90 shadow-glass-card transition active:scale-[0.99]"
              >
                <div className="relative h-36 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-surface-container-highest shadow-md">
                  {poster ? (
                    <Image
                      src={posterSrc(poster)}
                      alt={h.name}
                      fill
                      sizes="96px"
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center px-2 text-center text-body-sm font-semibold text-cinema-muted">
                      {h.name}
                    </div>
                  )}
                  <div className="absolute inset-x-1 bottom-1 flex items-center justify-center gap-1 rounded bg-surface-dark/80 px-1 py-0.5 backdrop-blur-md">
                    <span className="material-symbols-outlined text-[12px] text-emerald-400">
                      check_circle
                    </span>
                    <span className="font-mono text-label-sm uppercase text-emerald-400">
                      Hoàn tất
                    </span>
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                  <div className="flex items-start justify-between gap-1">
                    <h3 className="truncate font-syne text-headline-sm text-white">{h.name}</h3>
                    <div className="flex shrink-0 items-center">
                      <button
                        type="button"
                        aria-label="Đổi ảnh khác (khi sai poster)"
                        title="Đổi ảnh khác (khi sai poster)"
                        onClick={() => cyclePoster(h.slug, h.name, poster)}
                        disabled={!!cycling[h.slug]}
                        className="p-1 text-cinema-muted transition-colors hover:text-amber-gold disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[18px]">image_search</span>
                      </button>
                      <button
                        type="button"
                        aria-label="Xóa khỏi danh sách"
                        onClick={() => removeFromHistory(h.slug)}
                        className="p-1 text-cinema-muted transition-colors hover:text-white"
                      >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="font-mono text-label-sm text-cinema-muted">
                      {h.currentEpisode ? `Tập ${h.currentEpisode} · ` : ''}Xem lại từ đầu
                    </span>
                    <Link
                      href={`/xem-phim/${h.slug}?tap=${h.currentEpisode || 1}`}
                      onClick={(e) => goResume(e, h)}
                      aria-disabled={!!resolving[h.slug]}
                      className="flex h-8 items-center gap-1 rounded-full bg-amber-primary px-4 font-mono text-label-md text-surface-dark shadow-amber-button transition-all hover:bg-amber-gold aria-disabled:opacity-60"
                    >
                      <span className="material-symbols-outlined text-[16px]">
                        {resolving[h.slug] ? 'progress_activity' : 'replay'}
                      </span>
                      <span>{resolving[h.slug] ? 'Đang tìm...' : 'Xem lại'}</span>
                    </Link>
                  </div>
                </div>
              </article>
              );
            })}
          </section>
        )}

        {/* Offline banner (Stitch) — shader backdrop instead of stock photo */}
        <section className="mt-6">
          <div className="relative w-full overflow-hidden rounded-2xl bg-surface-container shadow-glass-card">
            <div className="absolute inset-0">
              <SpatialShader opacity={0.55} speed={1.1} interactive={false} />
            </div>
            <div className="absolute inset-0 bg-gradient-to-t from-surface-dark via-surface-dark/60 to-transparent" />
            <div className="relative flex h-40 flex-col justify-end p-4">
              <span className="font-mono text-label-sm font-bold uppercase tracking-widest text-amber-gold">
                Chế độ máy bay & du lịch
              </span>
              <h4 className="mt-0.5 font-syne text-headline-sm text-white">
                Trải nghiệm rạp chiếu bỏ túi
              </h4>
              <p className="mt-1 line-clamp-1 text-body-sm text-cinema-muted">
                Danh sách của bạn lưu ngay trên thiết bị — mở lại tức thì, không cần mạng.
              </p>
            </div>
          </div>
        </section>

        {/* Download preferences (Stitch) — persisted to this device */}
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-syne text-headline-sm text-white">Cài đặt tải xuống</h3>
            <span className="material-symbols-outlined text-[20px] text-cinema-muted">tune</span>
          </div>
          <div className="glass-panel flex flex-col overflow-hidden rounded-2xl shadow-glass-card">
            <SettingRow
              icon="auto_mode"
              iconClass="text-amber-gold"
              title="Tự động tải tập tiếp theo"
              hint="Tải sẵn 1 tập tiếp theo khi có Wi-Fi"
              control={
                <Switch
                  checked={prefs.autoNext}
                  onChange={() => setPrefs({ ...prefs, autoNext: !prefs.autoNext })}
                />
              }
            />
            <div className="mx-4 h-px bg-surface-container-highest" />
            <SettingRow
              icon="timer_off"
              iconClass="text-rose-200"
              title="Xóa sau 48h khi xem xong"
              hint="Tự động giải phóng dung lượng máy"
              control={
                <Switch
                  checked={prefs.autoDelete}
                  onChange={() => setPrefs({ ...prefs, autoDelete: !prefs.autoDelete })}
                />
              }
            />
            <div className="mx-4 h-px bg-surface-container-highest" />
            <SettingRow
              icon="high_quality"
              iconClass="text-cyan-accent"
              title="Chất lượng tải mặc định"
              hint="Áp dụng cho các tập tải tự động"
              control={
                <button
                  type="button"
                  onClick={cycleQuality}
                  className="flex flex-shrink-0 items-center gap-1 font-mono text-label-md text-amber-gold"
                >
                  <span>{prefs.quality}</span>
                  <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                </button>
              }
            />
          </div>
          <p className="mt-2 font-mono text-label-sm text-cinema-subtle">
            Tùy chọn lưu trên thiết bị này và áp dụng ngay khi có tập mới.
          </p>
        </section>
      </div>
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="glass-panel rounded-2xl px-6 py-12 text-center">
      <span className="material-symbols-outlined text-[40px] text-cinema-subtle">
        download_for_offline
      </span>
      <h3 className="mt-3 font-syne text-headline-sm text-white">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-body-sm text-cinema-muted">{hint}</p>
      <Link
        href="/kham-pha"
        className="mt-5 inline-flex h-10 items-center rounded-full bg-amber-primary px-6 font-mono text-label-md uppercase text-surface-dark shadow-amber-button transition-all hover:bg-amber-gold"
      >
        Khám phá phim
      </Link>
    </div>
  );
}

function SettingRow({
  icon,
  iconClass,
  title,
  hint,
  control,
}: {
  icon: string;
  iconClass: string;
  title: string;
  hint: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-surface-container-highest">
          <span className={`material-symbols-outlined text-[22px] ${iconClass}`}>{icon}</span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-body-lg font-semibold text-white">{title}</div>
          <div className="truncate text-body-sm text-cinema-muted">{hint}</div>
        </div>
      </div>
      {control}
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`flex h-6 w-12 flex-shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors ${
        checked ? 'justify-end bg-amber-primary' : 'justify-start bg-surface-container-highest'
      }`}
    >
      <span className="block h-5 w-5 rounded-full bg-white shadow-sm"></span>
    </button>
  );
}
