import { decidePlaybackMode, isHevcMain10 } from './remuxService.js';

/** Metadata hints never authorize playback; resolve still probes the actual file. */
export function directPlayVerdict(source, caps = {}, { audioIndex = null, contentLanguage = null } = {}) {
  if (source.playable === false || source.titleMatched === false) return 'unavailable';
  if (source.probedFormat && Array.isArray(source.audioTracks)) {
    const decision = decidePlaybackMode({ format: source.probedFormat,
      video: { codec: source.probedCodec || source.codec, profile: source.probedProfile,
        pixFmt: source.probedPixFmt, height: source.probedHeight, frameRate: source.probedFrameRate },
      audio: source.audioTracks }, caps, audioIndex, { contentLanguage,
        upstreamRangeSupported: source.rangeSupported });
    if (decision.mode === 'reject') return 'unavailable';
    if (decision.mode !== 'direct') return 'remux';
    return source.rangeSupported === true ? 'verified' : 'likely';
  }
  if (source.rangeSupported === false) return 'remux';
  const codec = source.codec;
  const main10 = isHevcMain10({codec,profile:source.probedProfile,pixFmt:source.probedPixFmt})
    || /\b(10.?bit|main.?10)\b/i.test(`${source.label || ''} ${source.filename || ''}`);
  const video = codec === 'h264' || (codec === 'hevc' && caps.hevc && (!main10 || (caps.hevcMain10 ?? caps.hevc)))
    || (codec === 'av1' && caps.av1) || (codec === 'vp9' && caps.webm);
  const container = source.container === 'mp4' || (source.container === 'webm' && caps.webm);
  if (video && container && source.audio?.browserFriendly) return 'likely';
  return source.container && source.codec ? 'remux' : 'unknown';
}
export const directPlayPriority = state => ({verified:3,likely:2,unknown:0,remux:0,unavailable:-1}[state] ?? 0);

export const isRecommendedDirectSource = source => ['verified', 'likely'].includes(source.directPlay)
  && Boolean(source.cached) && source.playable !== false && !source.qualityRisk;
