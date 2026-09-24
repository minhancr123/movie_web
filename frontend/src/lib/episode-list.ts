/**
 * Where the episode strip has to scroll to show the episode being watched.
 *
 * The card's own left edge, not its centre. The strip snaps mandatorily on
 * every card's start (`snap-x snap-mandatory` + `snap-start`), and a centred
 * card is not a snap position: the browser re-snaps to the nearest card start
 * as soon as snapping applies again, which parked the list a few cards away
 * from the one it had just been scrolled to. A card's own start IS a snap
 * position, so nothing moves afterwards and no snap toggling is needed.
 *
 * A card already fully on screen keeps the current offset. Yanking a list the
 * viewer can already read — and may have just scrolled themselves — helps
 * nobody.
 *
 * Returns `currentScrollLeft` whenever the measurements cannot support an
 * honest answer: a ref callback can fire before the panel has laid out, and
 * scrolling on zeroes lands at the first episode, which reads exactly like the
 * feature not working at all.
 */
export const episodeScrollTarget = (args: {
  /** Active card's offset inside the scroll container, px. */
  cardOffsetLeft: number;
  /** Active card's width, px. */
  cardWidth: number;
  /** Visible width of the strip, px. */
  containerWidth: number;
  /** Full scrollable width of the strip, px. */
  contentWidth: number;
  /** Where the strip is scrolled right now, px. */
  currentScrollLeft: number;
}): number => {
  const current = Number.isFinite(args.currentScrollLeft) ? Math.max(0, args.currentScrollLeft) : 0;
  const offset = Number(args.cardOffsetLeft);
  const cardWidth = Number(args.cardWidth);
  const containerWidth = Number(args.containerWidth);
  const contentWidth = Number(args.contentWidth);
  const measured = [offset, cardWidth, containerWidth, contentWidth].every(
    (v) => Number.isFinite(v) && v >= 0,
  );
  if (!measured || cardWidth <= 0 || containerWidth <= 0) return current;

  const fullyVisible = offset >= current && offset + cardWidth <= current + containerWidth;
  if (fullyVisible) return current;

  const maxScroll = Math.max(0, contentWidth - containerWidth);
  return Math.min(Math.max(0, offset), maxScroll);
};
