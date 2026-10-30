// A login can play several films at once. Cancellation belongs to a player,
// not to the account. Older clients have no player identity: isolate them by
// content rather than allowing them to cancel another device's resolve.
export function registerViewerResolve(active, record, onSuperseded = () => {}) {
  const user = String(record.userId || '');
  if (!user) return () => {};
  const viewer = record.viewerId;
  const scope = typeof viewer === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(viewer)
    ? ['viewer', viewer] : ['legacy-content', record.ref];
  const key = JSON.stringify([user, ...scope]);
  let entries = active.get(key);
  if (!entries) active.set(key, entries = new Set());
  for (const previous of entries) {
    if (previous.ref !== record.ref) {
      previous.controller.abort();
      onSuperseded(previous);
      entries.delete(previous);
    }
  }
  entries.add(record);
  return () => {
    entries.delete(record);
    if (!entries.size && active.get(key) === entries) active.delete(key);
  };
}
