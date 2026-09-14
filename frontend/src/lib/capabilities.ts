export interface ClientCapabilities {
  hevc: boolean;
  av1: boolean;
  hdr: boolean;
  maxHeight: number;
  maxBitrateMbps: number;
  eac3: boolean;
}

export function detectCapabilities(): ClientCapabilities {
  if (typeof window === 'undefined') {
    return {
      hevc: false,
      av1: false,
      hdr: false,
      maxHeight: 1080,
      maxBitrateMbps: 0,
      eac3: false,
    };
  }

  const video = document.createElement('video');

  // Check HEVC codec support
  const hevc =
    (typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"')) ||
    video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') === 'probably' ||
    video.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') === 'probably';

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

  // Network downlink estimate if Network Information API is available
  const navAny = navigator as any;
  const downlink = navAny.connection?.downlink || 0;
  const maxBitrateMbps = typeof downlink === 'number' && downlink > 0 ? Math.round(downlink) : 0;

  // Check EAC-3 (Dolby Digital Plus) support
  const eac3 =
    video.canPlayType('audio/mp4; codecs="ec-3"') === 'probably' ||
    video.canPlayType('audio/mp4; codecs="mp4a.a6"') === 'probably';

  return {
    hevc,
    av1,
    hdr,
    maxHeight,
    maxBitrateMbps,
    eac3,
  };
}
