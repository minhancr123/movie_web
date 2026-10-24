/** Keep the existing video node alive: reparenting/remounting it can restart
 * playback on iOS. Escape ancestor clipping/stacking in place instead. */
export function enterCssFullscreen(target: HTMLElement): () => void {
  const doc = target.ownerDocument;
  const win = doc.defaultView!;
  const restore: (() => void)[] = [];
  const set = (el: HTMLElement, property: string, value: string) => {
    const previous = el.style.getPropertyValue(property);
    const priority = el.style.getPropertyPriority(property);
    restore.push(() => {
      if (previous) el.style.setProperty(property, previous, priority);
      else el.style.removeProperty(property);
    });
    el.style.setProperty(property, value, 'important');
  };
  // A positioned ancestor with z-index:auto must also be raised. A fixed
  // descendant cannot outpaint its ancestor's sibling stacking context.
  for (let el = target.parentElement; el; el = el.parentElement) {
    if (win.getComputedStyle(el).position === 'static') set(el, 'position', 'relative');
    set(el, 'z-index', '2147483646');
    // These properties establish containing blocks for position:fixed or
    // clip its contents. Raising z-index alone cannot escape them.
    for (const property of ['transform', 'translate', 'rotate', 'scale', 'perspective',
      'filter', 'backdrop-filter', '-webkit-backdrop-filter', 'clip-path']) set(el, property, 'none');
    set(el, 'contain', 'none');
    set(el, 'content-visibility', 'visible');
    set(el, 'will-change', 'auto');
    set(el, 'overflow', 'visible');
  }
  for (const el of [doc.documentElement, doc.body]) {
    set(el, 'overflow', 'hidden');
    set(el, 'overscroll-behavior', 'none');
  }
  const previousAttribute = target.getAttribute('data-cinevn-css-fullscreen');
  target.setAttribute('data-cinevn-css-fullscreen', '');
  // Safari's address bar and rotation change the visual viewport independently
  // of layout viewport units. Listen until exit, then restore all owned styles.
  const viewport = win.visualViewport;
  for (const property of ['left', 'top', 'width', 'height']) set(target, property, '0px');
  const syncViewport = () => {
    target.style.setProperty('left', `${viewport?.offsetLeft ?? 0}px`, 'important');
    target.style.setProperty('top', `${viewport?.offsetTop ?? 0}px`, 'important');
    target.style.setProperty('width', `${viewport?.width ?? win.innerWidth}px`, 'important');
    target.style.setProperty('height', `${viewport?.height ?? win.innerHeight}px`, 'important');
  };
  syncViewport();
  win.addEventListener('resize', syncViewport);
  viewport?.addEventListener('resize', syncViewport);
  viewport?.addEventListener('scroll', syncViewport);
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    win.removeEventListener('resize', syncViewport);
    viewport?.removeEventListener('resize', syncViewport);
    viewport?.removeEventListener('scroll', syncViewport);
    if (previousAttribute === null) target.removeAttribute('data-cinevn-css-fullscreen');
    else target.setAttribute('data-cinevn-css-fullscreen', previousAttribute);
    for (const undo of restore.reverse()) undo();
  };
}
