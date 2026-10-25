import { getDB } from '../config/database.js';
import { recordPlaybackEvent } from '../services/observability/metrics.js';
import { findOwnedPlaybackSession } from './playbackExtrasController.js';
import { parseSyncSnapshot, playbackSyncSnapshot } from '../services/playback/syncDiagnostics.js';

export const parsePlaybackEvent = body => {
  if (!body || !/^[A-Za-z0-9_-]{8,64}$/.test(body.eventId || '')) return null;
  const base = { eventId: body.eventId, type: body.type };
  if (body.type === 'sync_snapshot') {
    const snapshot = parseSyncSnapshot(body);
    return snapshot ? { ...base, ...snapshot } : null;
  }
  const valid = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
  if (['first_frame', 'seek'].includes(body.type) && valid(body.seconds, 300)) return { ...base, seconds: body.seconds };
  if (body.type === 'summary' && valid(body.playedSeconds, 120) && valid(body.stalledSeconds, 120)
    && body.playedSeconds + body.stalledSeconds <= 120) {
    return { ...base, playedSeconds: body.playedSeconds, stalledSeconds: body.stalledSeconds };
  }
  if (body.type === 'error') {
    const details = {};
    if (['native', 'mse', 'direct'].includes(body.engine)) details.engine = body.engine;
    for (const [field, max] of [['mediaErrorCode', 4], ['readyState', 4], ['networkState', 3]]) {
      if (Number.isInteger(body[field]) && valid(body[field], max)) details[field] = body[field];
    }
    if (valid(body.localTime, 200000)) details.localTime = Math.round(body.localTime * 1000) / 1000;
    return { ...base, ...details };
  }
  return null;
};
const seen = new Map();
export const acceptPlaybackEvent = (sessionId, event, now = Date.now()) => {
  const key = `${sessionId}:${event.eventId}`;
  const expires = seen.get(key);
  if (expires && expires > now) return false;
  if (seen.size >= 10000) seen.delete(seen.keys().next().value);
  seen.set(key, now + 6 * 3600_000);
  return true;
};
export const playbackTelemetry = async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const event = parsePlaybackEvent(req.body);
  if (!event) return res.status(400).json({ success: false });
  try {
    const session = await findOwnedPlaybackSession(getDB(), req.params.sessionId, req.user.userId);
    if (!session) return res.status(404).json({ success: false });
    if (acceptPlaybackEvent(session.sessionId, event)) {
      if (event.type === 'sync_snapshot') console.info('[playback-sync]', JSON.stringify(playbackSyncSnapshot(session, event)));
      else {
        if (event.type === 'error') console.info('[playback-media]', JSON.stringify({ contentRef: session.contentRef, ...event }));
        recordPlaybackEvent(session, event);
      }
    }
    return res.sendStatus(204);
  } catch { return res.status(503).json({ success: false }); }
};
