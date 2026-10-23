import { getDB } from '../config/database.js';
import { recordPlaybackEvent } from '../services/observability/metrics.js';
import { findOwnedPlaybackSession } from './playbackExtrasController.js';

export const parsePlaybackEvent = body => {
  if (!body || !/^[A-Za-z0-9_-]{8,64}$/.test(body.eventId || '')) return null;
  const base = { eventId: body.eventId, type: body.type };
  const valid = (n, max) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max;
  if (['first_frame', 'seek'].includes(body.type) && valid(body.seconds, 300)) return { ...base, seconds: body.seconds };
  if (body.type === 'summary' && valid(body.playedSeconds, 120) && valid(body.stalledSeconds, 120)
    && body.playedSeconds + body.stalledSeconds <= 120) {
    return { ...base, playedSeconds: body.playedSeconds, stalledSeconds: body.stalledSeconds };
  }
  if (body.type === 'error') return base;
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
    if (acceptPlaybackEvent(session.sessionId, event)) recordPlaybackEvent(session, event);
    return res.sendStatus(204);
  } catch { return res.status(503).json({ success: false }); }
};
