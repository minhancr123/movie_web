/**
 * Whether the player's media element is safe to read from in JavaScript.
 *
 * Web Audio and canvas hit the same wall from the same cause: a media element
 * that loaded a cross-origin resource is tainted, so createMediaElementSource()
 * yields silence and drawImage()/getImageData() throws SecurityError. Neither is
 * recoverable, and the audio case cannot even be detected after the fact.
 *
 * The remux path is safe because hls.js feeds the element through MSE — the
 * bytes arrive from JS as blobs, so the element never loads a cross-origin
 * resource itself. A direct upstream URL is not safe, and neither is native HLS
 * (Safari fetches the playlist itself and the element carries no crossOrigin
 * attribute), so both are refused rather than risked.
 */
export const prefersNativeHls = (userAgent: string, platform = '', maxTouchPoints = 0): boolean =>
    /iPhone|iPad|iPod/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)
    || (/Macintosh/i.test(userAgent) && /AppleWebKit\//i.test(userAgent)
        && /Version\/[\d.]+.*Safari\//i.test(userAgent)
        && !/Chrome|Chromium|Edg\/|OPR\/|Firefox|FxiOS|CriOS/i.test(userAgent));

/** Let native HLS select the destination segment before its first data load.
 * The exact decoded-position restore still validates the requested frame.
 */
export const withNativeStartHint = (src: string, localTarget: number): string => {
    if (!Number.isFinite(localTarget) || localTarget <= 0) return src;
    try {
        const url = new URL(src, 'https://cinevn.invalid');
        if (!url.pathname.startsWith('/api/playback/hls/') || !url.pathname.endsWith('.m3u8')) return src;
        url.searchParams.set('start', String(localTarget));
        return /^[a-z][a-z\d+.-]*:/i.test(src) ? url.href : `${url.pathname}${url.search}${url.hash}`;
    } catch { return src; }
};

export const isTaintFreePipeline = (src: string, hlsSupported: boolean, nativePreferred = false): boolean => {
    // Mirrors the player's own branch: the MSE path, and only that.
    const isHlsSrc = /\.m3u8(\?|#|$)/i.test(src);
    return isHlsSrc && hlsSupported && !nativePreferred;
};
