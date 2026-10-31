// A known file must not disappear just because an addon omits it on refresh.
// Recover metadata only from an unexpired, previously served, owner-scoped
// session. Entitlements, codec policy, file selection and link creation still
// run normally; no URL or magnet is recovered from the session.
export function ownedPinnedCandidate(row, context, now = Date.now()) {
  if (!row || row.provider !== 'torbox' || !['direct', 'remux'].includes(row.mode)
    || String(row.userIdStr || row.userId || '') !== String(context.userId)
    || row.contentRef !== context.contentRef
    || row.mediaType !== context.mediaType || Number(row.tmdbId) !== Number(context.tmdbId)
    || !(new Date(row.expiresAt).getTime() > now)) return null;
  if (context.mediaType === 'tv' && (Number(row.season) !== Number(context.season)
    || Number(row.episode) !== Number(context.episode))) return null;
  const identity = String(context.sourceToken || '').trim().toLowerCase();
  if (identity !== String(row.sourceIdentity || '').toLowerCase()) return null;
  const match = /^([a-f0-9]{40}):(?:index:(\d+)|unknown:([^|\x00-\x1f\x7f]{1,1024}))$/u.exec(identity);
  if (!match || match[1] !== String(row.infoHash || '').toLowerCase()) return null;
  const fileIdx = match[2] === undefined ? null : Number(match[2]);
  if (fileIdx !== null && (!Number.isSafeInteger(fileIdx) || fileIdx < 0)) return null;
  const filename = match[3] ?? String(row.sourceFileName || '');
  if (!filename || filename.length > 4096) return null;
  const candidate = row.candidate || {};
  return {
    infoHash: match[1], ...(fileIdx !== null ? { fileIdx } : {}), filename,
    resolution: Number(row.videoHeight) || candidate.resolution || null,
    codec: row.videoCodec || candidate.codec || null,
    hdr: candidate.hdr || null,
    sizeBytes: Number(row.videoSize) || Number(candidate.sizeBytes) || null,
    releaseSource: candidate.releaseSource || null,
    audioTracks: Array.isArray(candidate.audioTracks) ? candidate.audioTracks : [],
    subtitleTracks: Array.isArray(candidate.subtitleTracks) ? candidate.subtitleTracks : [],
  };
}
