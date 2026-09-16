/**
 * Route-level fallback for the legacy single-segment watch URL
 * (`/xem-phim/<contentRef>?tap=<ep>`) written by Continue Watching rows.
 *
 * The sibling page.tsx must resolve the contentRef via getCatalogDetail
 * (backend round-trip, up to 15s on a cold backend) before it can redirect
 * to the canonical 3-segment watch URL. Without this fallback Next streams
 * only the layout — header over an empty shader background — and the resume
 * click looks dead. Keep the skeleton shaped like the watch page so the
 * redirect hop feels seamless.
 */
export default function ResumeLoading() {
  return (
    <div
      className="relative mx-auto -mt-8 max-w-5xl overflow-x-clip px-4 pb-8 pt-8"
      role="status"
      aria-live="polite"
      aria-label="Đang mở phim để xem tiếp"
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
              Đang mở phim để xem tiếp…
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
