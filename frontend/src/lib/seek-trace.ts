export const SEEK_PHASES = ['seek_intent','seek_commit','resolve_start','resolve_end','session_ready',
  'manifest_received','first_target_segment_received','target_decode_ready','first_target_frame_rendered'] as const;
export type SeekPhase = typeof SEEK_PHASES[number];
/** Bounded per-intent trace. Missing native-network/frame observations stay absent. */
export class SeekTrace {
  private started: number | null = null;
  private phases: Partial<Record<SeekPhase,number>> = {};
  constructor(private now: () => number) {}
  begin() { this.started = this.now(); this.phases = {seek_intent:0}; }
  mark(phase: SeekPhase) {
    if (this.started === null || this.phases[phase] !== undefined) return;
    this.phases[phase] = Math.round(Math.min(300000, Math.max(0,this.now()-this.started)));
  }
  finish() { if(this.started===null)return null;const result={...this.phases};this.started=null;this.phases={};return result; }
}
