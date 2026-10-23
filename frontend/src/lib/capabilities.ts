/**
 * Client capabilities detection.
 *
 * Extended with device-aware decoding info via MediaCapabilities.decodingInfo().
 * See: https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo
 */

export interface ClientCapabilities {
  windowedRemux?: boolean;
  hevc: boolean;
  hevcMain10: boolean;
  av1: boolean;
  hdr: boolean;
  maxHeight: number;
  preferredMaxHeight?: number;
  maxBitrateMbps: number;
  eac3: boolean;
  webm: boolean;
  /** Device-aware decoding smoothness (MediaCapabilities). */
  decodingSmooth: boolean;
  /** Device-aware power efficiency (MediaCapabilities). */
  powerEfficient: boolean;
  /** Max resolution the device can decode smoothly (from MediaCapabilities probe). */
  smoothMaxHeight: number;
}

export interface DecodingProbeResult {
  supported: boolean;
  smooth: boolean;
  powerEfficient: boolean;
}

/**
 * Probe whether the device can decode a given configuration smoothly.
 * Uses MediaCapabilities.decodingInfo() when available.
 */
export async function probeDecodingInfo(
  contentType: string,
  width: number,
  height: number,
  bitrate: number,
  framerate: number = 30,
): Promise<DecodingProbeResult> {
  const fallback: DecodingProbeResult = { supported: false, smooth: false, powerEfficient: false };

  if (typeof window === 'undefined' || !('mediaCapabilities' in navigator)) {
    return fallback;
  }

  try {
    const result = await Promise.race([(navigator as any).mediaCapabilities.decodingInfo({
      type: 'media-source',
      video: {
        contentType,
        width,
        height,
        bitrate,
        framerate,
      },
    }), new Promise<null>(resolve => setTimeout(() => resolve(null), 250))]);
    if (!result) return fallback;
    return {
      supported: result.supported === true,
      smooth: result.smooth === true,
      powerEfficient: result.powerEfficient === true,
    };
  } catch {
    return fallback;
  }
}

/**
 * Probe multiple resolutions and find the max height the device can decode smoothly.
 */
export async function probeSmoothMaxHeight(
  codec: string,
  bitratePerHeight: Record<number, number> = { 1080: 5_000_000, 1440: 8_000_000, 2160: 15_000_000 },
): Promise<number> {
  if (typeof window === 'undefined' || !('mediaCapabilities' in navigator)) {
    return 0;
  }

  const heights = [2160, 1440, 1080].sort((a, b) => b - a);
  for (const h of heights) {
    const bitrate = bitratePerHeight[h] || 5_000_000;
    const w = Math.round((h * 16) / 9);
    const probe = await probeDecodingInfo(`video/mp4; codecs="${codec}"`, w, h, bitrate, 30);
    if (probe.supported && probe.smooth) {
      return h;
    }
  }
  return 0; // No confirmed smooth resolution: retain the existing safe ranking.
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
      decodingSmooth: false,
      powerEfficient: false,
      smoothMaxHeight: 0,
    };
  }

  const video = document.createElement('video');

  const hevc =
    (typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"')) ||
    video.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') === 'probably' ||
    video.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') === 'probably';

  const hevcMain10 =
    (typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/mp4; codecs="hvc1.2.4.L123.B0"')) ||
    video.canPlayType('video/mp4; codecs="hvc1.2.4.L123.B0"') === 'probably' ||
    video.canPlayType('video/mp4; codecs="hev1.2.4.L123.B0"') === 'probably';

  const av1 =
    (typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/mp4; codecs="av01.0.08M.08"')) ||
    video.canPlayType('video/mp4; codecs="av01.0.08M.08"') === 'probably';

  const hdr =
    typeof window.matchMedia === 'function' &&
    (window.matchMedia('(dynamic-range: high)').matches ||
      window.matchMedia('(video-dynamic-range: high)').matches);

  const screenHeight = Math.round(window.screen.height * (window.devicePixelRatio || 1));
  const maxHeight = screenHeight >= 2160 ? 2160 : screenHeight >= 1440 ? 1440 : 1080;

  const phoneScreen = Math.min(window.screen.width, window.screen.height) <= 768;
  const coarsePointer = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  const preferredMaxHeight = phoneScreen && coarsePointer ? 1080 : 0;

  const navAny = navigator as any;
  const downlink = navAny.connection?.downlink || 0;
  const maxBitrateMbps = typeof downlink === 'number' && downlink > 0 ? Math.round(downlink) : 0;

  const eac3 =
    video.canPlayType('audio/mp4; codecs="ec-3"') === 'probably' ||
    video.canPlayType('audio/mp4; codecs="mp4a.a6"') === 'probably';

  const webm =
    video.canPlayType('video/webm; codecs="vp9, opus"') === 'probably' ||
    (typeof MediaSource !== 'undefined' &&
      MediaSource.isTypeSupported('video/webm; codecs="vp9, opus"'));

  return {
    windowedRemux: true,
    hevc,
    hevcMain10,
    av1,
    hdr,
    maxHeight,
    preferredMaxHeight,
    maxBitrateMbps,
    eac3,
    webm,
    decodingSmooth: false,
    powerEfficient: false,
    smoothMaxHeight: 0,
  };
}

let deviceProbe: Promise<Partial<ClientCapabilities>> | null = null;
/** Resolve once per page; never hold playback for a hanging platform API. */
export async function getDevicePlaybackCapabilities(): Promise<Partial<ClientCapabilities>> {
  if (typeof window === 'undefined' || !navigator.mediaCapabilities) return {};
  if (!deviceProbe) {
    deviceProbe = (async () => {
      const base = detectCapabilities();
      const codec = base.hevcMain10 ? 'hvc1.2.4.L153.B0' : base.hevc ? 'hvc1.1.6.L153.B0' : 'avc1.640033';
      const height = Math.min(await probeSmoothMaxHeight(codec), base.maxHeight);
      if (!height) return {};
      const result = await probeDecodingInfo(`video/mp4; codecs="${codec}"`, Math.round(height * 16 / 9), height, 5_000_000);
      return { smoothMaxHeight: height, decodingSmooth: result.smooth, powerEfficient: result.powerEfficient };
    })().catch(() => ({}));
  }
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<Partial<ClientCapabilities>>(resolve => { timer = setTimeout(() => resolve({}), 900); });
  const result = await Promise.race([deviceProbe, timeout]);
  clearTimeout(timer!);
  return result;
}
