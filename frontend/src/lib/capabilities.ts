export interface ClientCapabilities {
  hevc: boolean;
  /**
   * HEVC Main 10 (10-bit) specifically. Many browsers decode 8-bit HEVC but
   * not Main 10 (notably Chrome/Edge MSE); serving a Main 10 copy to them is
   * a guaranteed MEDIA_ERROR. Probed separately from `hevc` so the server
   * can reject/route Main 10 sources per client instead of guessing.
   */
  hevcMain10: boolean;
  av1: boolean;
  hdr: boolean;
  maxHeight: number;
  /** Auto-selection preference only; never a ban on manually selecting 4K. */
  preferredMaxHeight?: number;
  maxBitrateMbps: number;
  eac3: boolean;
  /**
   * WebM container support (VP9/Opus inside WebM). Chrome and Firefox play it,
   * Safari does not — and the server's probe cannot tell them apart (both
   * report "matroska,webm"), so the client reports it like any other codec.
   * Gates the direct-play rule for WebM sources.
   */
  webm: boolean;
}

export function detectCapabilities(): ClientCapabilities {
  if (typeof window === 'undefined') {
    return {
      hevc: false,
      hevcMain10: false,
      av1: false,
      hdr: false,
      maxHeight: 1080,
      preferredMaxHeight: 0,
      maxBitrateMbps: 0,
      eac3: false,
      webm: false,
    };
  }

  const video = document.createElement('video');

  // Check HEVC codec support
  const hevc =
    (typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"')) ||
    video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') === 'probably' ||
    video.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') === 'probably';

  // Check HEVC Main 10 (10-bit) support separately: profile_idc=2.
  // An 8-bit-only decoder reports hevc above but fails Main 10 bytes.
  const hevcMain10 =
    (typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/mp4; codecs="hvc1.2.4.L123.B0"')) ||
    video.canPlayType('video/mp4; codecs="hvc1.2.4.L123.B0"') === 'probably' ||
    video.canPlayType('video/mp4; codecs="hev1.2.4.L123.B0"') === 'probably';

  // Check AV1 codec support
  const av1 =
    (typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/mp4; codecs="av01.0.08M.08"')) ||
    video.canPlayType('video/mp4; codecs="av01.0.08M.08"') === 'probably';

  // Check HDR support
  const hdr =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(dynamic-range: high)').matches ||
      window.matchMedia('(video-dynamic-range: high)').matches);

  // Screen height detection
  const screenHeight = Math.round(window.screen.height * (window.devicePixelRatio || 1));
  const maxHeight = screenHeight >= 2160 ? 2160 : screenHeight >= 1440 ? 1440 : 1080;

  // A phone's portrait height is not a request for 4K. Keep decoding
  // capabilities intact for manual picks, but prefer a lighter Auto source.
  const phoneScreen = Math.min(window.screen.width, window.screen.height) <= 768;
  const coarsePointer = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  const preferredMaxHeight = phoneScreen && coarsePointer ? 1080 : 0;

  // Network downlink estimate if Network Information API is available
  const navAny = navigator as any;
  const downlink = navAny.connection?.downlink || 0;
  const maxBitrateMbps = typeof downlink === 'number' && downlink > 0 ? Math.round(downlink) : 0;

  // Check EAC-3 (Dolby Digital Plus) support
  const eac3 =
    video.canPlayType('audio/mp4; codecs="ec-3"') === 'probably' ||
    video.canPlayType('audio/mp4; codecs="mp4a.a6"') === 'probably';

  // Check WebM container support: VP9 video with Opus audio inside WebM.
  // Chrome and Firefox answer 'probably'; Safari answers '' or 'maybe', which
  // is exactly the split the server needs — its probe sees "matroska,webm"
  // for both and cannot distinguish them.
  const webm =
    video.canPlayType('video/webm; codecs="vp9, opus"') === 'probably' ||
    (typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/webm; codecs="vp9, opus"'));

  return {
    hevc,
    hevcMain10,
    av1,
    hdr,
    maxHeight,
    preferredMaxHeight,
    maxBitrateMbps,
    eac3,
    webm,
  };
}
