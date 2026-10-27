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
  if (body.type === 'seek_trace') {
    const names = ['seek_intent','seek_commit','resolve_start','resolve_end','session_ready','manifest_received',
      'first_target_segment_received','target_decode_ready','first_target_frame_rendered'];
    if (!['native','mse','direct'].includes(body.engine) || typeof body.reused !== 'boolean'
      || !body.phases || typeof body.phases !== 'object') return null;
    const phases = {};
    for (const name of names) if (valid(body.phases[name],300000)) phases[name] = Math.round(body.phases[name]);
    if (phases.seek_intent !== 0) return null;
    return {...base,engine:body.engine,reused:body.reused,phases};
  }

  if (['first_frame', 'seek'].includes(body.type) && valid(body.seconds, 300)) return { ...base, seconds: body.seconds };
  if (body.type === 'summary' && valid(body.playedSeconds, 120) && valid(body.stalledSeconds, 120)
    && body.playedSeconds + body.stalledSeconds <= 120) {
    return { ...base, playedSeconds: body.playedSeconds, stalledSeconds: body.stalledSeconds };
  }
  if (body.type === 'error' || body.type === 'restore_snapshot') {
    const details = {};
    if (['native', 'mse', 'direct'].includes(body.engine)) details.engine = body.engine;
    for (const [field, max] of [['mediaErrorCode', 4], ['readyState', 4], ['networkState', 3]]) {
      if (Number.isInteger(body[field]) && valid(body[field], max)) details[field] = body[field];
    }
    if (valid(body.localTime, 200000)) details.localTime = Math.round(body.localTime * 1000) / 1000;
    if (body.type === 'restore_snapshot') {
      if (!details.engine || !Number.isInteger(details.readyState) || typeof body.seeking !== 'boolean' || typeof body.paused !== 'boolean') return null;
      for (const field of ['targetLocal', 'durationSeconds', 'seekableEnd', 'bufferedEnd']) {
        if (!valid(body[field], 200000)) return null;
        details[field] = Math.round(body[field] * 1000) / 1000;
      }
      details.seeking = body.seeking; details.paused = body.paused;
    }
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
      if (event.type === 'seek_trace') console.info('[playback-seek-trace]', JSON.stringify(event));
      else if (event.type === 'sync_snapshot') console.info('[playback-sync]', JSON.stringify(playbackSyncSnapshot(session, event)));
      else if (event.type === 'restore_snapshot') console.info('[playback-restore]', JSON.stringify({ contentRef: session.contentRef, startAt: session.startAt || 0, ...event }));
      else {
        if (event.type === 'error') console.info('[playback-media]', JSON.stringify({ contentRef: session.contentRef, ...event }));
        recordPlaybackEvent(session, event);
      }
    }
    return res.sendStatus(204);
  } catch { return res.status(503).json({ success: false }); }
};
