/**
 * Route-level fallback for a premiere room.
 *
 * The page is a client component that shows its own spinner once mounted, but
 * nothing covered the segment transition before that — the gap between leaving
 * the listing and the component mounting rendered as empty page. This matches
 * the spinner the page itself shows, so the two are indistinguishable.
 */
export default function PremiereLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center"
      role="status"
      aria-live="polite"
      aria-label="Đang vào phòng chiếu"
    >
      <div className="h-16 w-16 animate-spin rounded-full border-4 border-amber-gold/25 border-t-amber-gold" />
    </div>
  );
}
