const bounded = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Explicit numeric allowlist: never forward URLs, tokens, cue text or keys. */
export const parseSyncSnapshot = body => {
  const fields = {
    requestedStartAt: [0, 86400], playerCurrentTime: [0, 86400],
    absolutePlaybackTime: [0, 172800], subtitleLookupTime: [0, 172800],
    subtitleCueStart: [0, 172800], subtitleDelaySeconds: [-300, 300],
    presentationShiftMs: [0, 2000], selectedAudioIndex: [0, 2048], subtitleStreamIndex: [0, 2048],
  };
  const result = {};
  for (const [name, [min, max]] of Object.entries(fields)) {
    if (!bounded(body[name], min, max)) return null;
    result[name] = body[name];
  }
  if (!Number.isInteger(result.selectedAudioIndex) || !Number.isInteger(result.subtitleStreamIndex)) return null;
  return result;
};

/** Derive the authoritative clock from the owned session, including on reuse. */
export const playbackSyncSnapshot = (session, event) => {
  const origin = session.mode === 'direct' ? 0 : Number(session.startAt) || 0;
  const shift = Number(session.presentationShiftMs) || 0;
  const absolute = origin + event.playerCurrentTime;
  const lookup = Math.max(0, absolute - shift / 1000 + event.subtitleDelaySeconds);
  const round = value => Math.round(value * 1000) / 1000;
  return {
    sessionId: session.sessionId, mode: session.mode,
    requestedStartAt: event.requestedStartAt, actualSeekOrigin: origin,
    presentationShiftMs: shift, clientPresentationShiftMs: event.presentationShiftMs,
    selectedAudioIndex: event.selectedAudioIndex, serverAudioIndex: session.audioIndex ?? null,
    subtitleStreamIndex: event.subtitleStreamIndex, subtitleCueStart: event.subtitleCueStart,
    subtitleDelaySeconds: event.subtitleDelaySeconds, playerCurrentTime: event.playerCurrentTime,
    absolutePlaybackTime: event.absolutePlaybackTime, subtitleLookupTime: event.subtitleLookupTime,
    absoluteMappingErrorSeconds: round(event.absolutePlaybackTime - absolute),
    lookupMappingErrorSeconds: round(event.subtitleLookupTime - lookup),
  };
};
