/**
 * Route-level fallback for the person page.
 *
 * This segment had no loading.tsx, so navigating to a cast member fell through
 * to the root home-shaped skeleton — a hero banner and a film grid, nothing
 * like the profile that actually arrives. Shaped like page.tsx: portrait on the
 * left, name/meta/biography on the right, filmography grid underneath.
 */
export default function PersonLoading() {
  return (
    <div
      className="animate-pulse pb-16"
      role="status"
      aria-live="polite"
      aria-label="Đang tải thông tin diễn viên"
    >
      <div className="grid gap-8 md:grid-cols-[240px_1fr]">
        {/* Portrait */}
        <div className="mx-auto w-44 md:mx-0 md:w-full">
          <div className="aspect-[2/3] rounded-2xl border border-white/10 bg-surface-container-high" />
        </div>

        {/* Name, meta, biography */}
        <div>
          <div className="h-9 w-2/3 rounded-lg bg-surface-container-high md:h-12" />
          <div className="mt-3 flex gap-4">
            <div className="h-4 w-24 rounded bg-surface-container-high" />
            <div className="h-4 w-32 rounded bg-surface-container-high" />
          </div>
          <div className="mt-6 space-y-3">
            <div className="h-4 w-full rounded bg-surface-container-high" />
            <div className="h-4 w-full rounded bg-surface-container-high" />
            <div className="h-4 w-5/6 rounded bg-surface-container-high" />
            <div className="h-4 w-2/3 rounded bg-surface-container-high" />
          </div>
        </div>
      </div>

      {/* Filmography */}
      <div className="mt-12">
        <div className="mb-5 h-7 w-48 rounded-lg bg-surface-container-high" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i}>
              <div className="aspect-[2/3] rounded-xl bg-surface-container-high" />
              <div className="mt-2 h-4 w-4/5 rounded bg-surface-container-high" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
