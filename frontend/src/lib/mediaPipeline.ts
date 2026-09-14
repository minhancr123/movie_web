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
export const isTaintFreePipeline = (src: string, hlsSupported: boolean): boolean => {
    // Mirrors the player's own branch: the MSE path, and only that.
    const isHlsSrc = /\.m3u8(\?|#|$)/i.test(src);
    return isHlsSrc && hlsSupported;
};
