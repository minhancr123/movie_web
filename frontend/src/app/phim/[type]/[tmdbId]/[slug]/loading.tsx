/**
 * Route-level fallback for the catalog detail page.
 *
 * This segment had no loading.tsx, so navigating to a film fell back to the
 * root home-style skeleton (or a blank shader background on slow fetches)
 * instead of a detail-shaped placeholder. Keep this shaped like page.tsx:
 * backdrop, poster + title/meta/overview, cast row.
 */
export default function CatalogDetailLoading() {
  return (
    <div
      className="animate-pulse pb-16"
      role="status"
      aria-live="polite"
      aria-label="Đang tải thông tin phim"
    >
      {/* Backdrop */}
      <div className="relative -mx-4 mb-8 h-[38vh] overflow-hidden bg-surface-container-high md:-mx-8 md:h-[55vh]">
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-transparent" />
      </div>

      <div className="spatial-stage relative z-10 -mt-32 grid gap-8 md:-mt-48 md:grid-cols-[260px_1fr]">
        {/* Poster */}
        <div className="mx-auto w-40 md:mx-0 md:w-full">
          <div className="aspect-[2/3] overflow-hidden rounded-2xl border border-white/10 bg-surface-container-high" />
        </div>

        {/* Title / meta / overview */}
        <div>
          <div className="h-9 w-2/3 rounded-lg bg-surface-container-high md:h-12" />
          <div className="mt-2 h-4 w-1/3 rounded bg-surface-container-high" />
          <div className="mt-4 flex gap-3">
            <div className="h-12 w-32 rounded-full bg-surface-container-high" />
            <div className="h-12 w-12 rounded-full bg-surface-container-high" />
          </div>
          <div className="mt-5 flex gap-4">
            <div className="h-4 w-16 rounded bg-surface-container-high" />
            <div className="h-4 w-20 rounded bg-surface-container-high" />
            <div className="h-4 w-12 rounded bg-surface-container-high" />
          </div>
          <div className="mt-4 flex gap-2">
            <div className="h-7 w-20 rounded-full bg-surface-container-high" />
            <div className="h-7 w-24 rounded-full bg-surface-container-high" />
            <div className="h-7 w-16 rounded-full bg-surface-container-high" />
          </div>
          <div className="mt-6 max-w-3xl space-y-2">
            <div className="h-4 w-full rounded bg-surface-container-high" />
            <div className="h-4 w-full rounded bg-surface-container-high" />
            <div className="h-4 w-2/3 rounded bg-surface-container-high" />
          </div>
        </div>
      </div>

      {/* Cast row */}
      <section className="mt-14">
        <div className="mb-5 h-8 w-48 rounded border-l-4 border-amber-primary bg-surface-container-high pl-3" />
        <div className="flex gap-4 overflow-hidden pb-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="min-w-[110px] text-center">
              <div className="mx-auto h-[110px] w-[110px] rounded-full bg-surface-container-high" />
              <div className="mx-auto mt-2 h-4 w-20 rounded bg-surface-container-high" />
              <div className="mx-auto mt-1 h-3 w-16 rounded bg-surface-container-high" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
