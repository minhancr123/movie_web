export type PlaybackEvent =
  | { type: 'first_frame' | 'seek'; seconds: number }
  | { type: 'summary'; playedSeconds: number; stalledSeconds: number }
  | { type: 'error' }
  | { type: 'sync_snapshot'; requestedStartAt: number; playerCurrentTime: number;
      absolutePlaybackTime: number; subtitleLookupTime: number; subtitleCueStart: number;
      subtitleDelaySeconds: number; presentationShiftMs: number; selectedAudioIndex: number;
      subtitleStreamIndex: number };

/** Pure wall-clock accounting. Pauses, startup and seeks are not rebuffering. */
export class PlaybackClock {
  private state: 'paused' | 'startup' | 'playing' | 'buffering' | 'seeking' = 'startup';
  private last: number;
  private played = 0;
  private stalled = 0;
  private shown = false;
  private failed = false;
  private seekAt: number | null;
  constructor(private now: () => number, private emit: (event: PlaybackEvent) => void,
    private startedAt: number, seekAt: number | null = null) {
    this.last = now(); this.seekAt = seekAt;
  }
  private tick() {
    const at = this.now();
    const seconds = Math.min(120, Math.max(0, at - this.last) / 1000);
    if (this.state === 'playing') this.played += seconds;
    if (this.state === 'buffering') this.stalled += seconds;
    this.last = at;
  }
  resume() { this.tick(); this.state = this.shown ? 'playing' : 'startup'; }
  pause() { this.tick(); this.state = 'paused'; }
  wait() { this.tick(); if (this.shown && this.state === 'playing') this.state = 'buffering'; }
  seek() { this.tick(); this.seekAt ??= this.now(); this.state = 'seeking'; }
  frame(paused = false) {
    this.tick();
    if (!this.shown) {
      this.shown = true;
      this.emit({ type: 'first_frame', seconds: Math.min(300, Math.max(0, this.now() - this.startedAt) / 1000) });
    }
    if (this.seekAt !== null) {
      this.emit({ type: 'seek', seconds: Math.min(300, Math.max(0, this.now() - this.seekAt) / 1000) });
      this.seekAt = null;
    }
    this.state = paused ? 'paused' : 'playing';
  }
  error() { if (!this.failed) { this.failed = true; this.emit({ type: 'error' }); } }
  flush() {
    this.tick();
    // Chunk a throttled/background tab's summary to the server's strict bound.
    while (this.played + this.stalled > 0) {
      const playedSeconds = Math.min(120, this.played);
      const stalledSeconds = Math.min(120 - playedSeconds, this.stalled);
      this.emit({ type: 'summary', playedSeconds, stalledSeconds });
      this.played -= playedSeconds; this.stalled -= stalledSeconds;
    }
  }
}

export const sendPlaybackEvent = (url: string, token: string, event: PlaybackEvent) => {
  const eventId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  void fetch(url, { method: 'POST', keepalive: true,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...event, eventId }),
  }).catch(() => {});
};
