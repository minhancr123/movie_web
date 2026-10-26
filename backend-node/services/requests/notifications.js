/** Shared by manual moderation and background fulfilment. */
export async function notifyRequestCompleted(db, request) {
  const roster = request.requesters?.length ? request.requesters : [{ id: request.userId }];
  const ids = [...new Map(roster.filter(u => u?.id).map(u => [String(u.id), u.id])).values()];
  let count = 0;
  for (const userId of ids) {
    const result = await db.collection('notifications').updateOne({ requestId: request._id, userId, type: 'request_completed' }, {
      $setOnInsert: { userId, type: 'request_completed', requestId: request._id,
        title: 'Phim bạn yêu cầu đã có', message: `“${request.title}” đã có nguồn phát trên CineVN.`,
        tmdbId: request.tmdbId || null, isRead: false, createdAt: new Date() },
    }, { upsert: true }).catch(error => { if (error.code === 11000) return {}; throw error; });
    count += result.upsertedCount || 0;
  }
  return count;
}
