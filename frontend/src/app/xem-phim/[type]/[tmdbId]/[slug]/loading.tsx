/**
 * Route-level fallback for the async watch page.
 *
 * PlaybackSection cannot render until the Server Component has fetched the
 * catalog detail (and episodes for TV). Keeping this fallback beside page.tsx
 * lets Next stream a real player skeleton during that first navigation instead
 * of exposing the layout's empty shader background.
 */
export default function WatchLoading() {
  return (
    <div
      className="relative mx-auto -mt-8 max-w-5xl overflow-x-clip px-4 pb-8 pt-8"
      role="status"
      aria-live="polite"
      aria-label="Đang mở rạp phim"
    >
      <div className="relative z-10 animate-pulse">
        <div className="mb-5 flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-full border border-white/10 bg-white/5" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-24 rounded-full bg-amber-primary/20" />
            <div className="h-7 w-2/3 max-w-md rounded-lg bg-white/10" />
          </div>
        </div>

        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-surface-dark shadow-2xl">
          <div className="absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-amber-primary/[0.06]" />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
            <span className="h-10 w-10 rounded-full border-2 border-white/15 border-t-amber-gold motion-safe:animate-spin" />
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-cinema-muted">
              Đang mở rạp phim…
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <div className="h-10 rounded-xl bg-white/5" />
          <div className="h-10 rounded-xl bg-white/5" />
          <div className="h-10 rounded-xl bg-white/5" />
        </div>
      </div>
    </div>
  );
}
