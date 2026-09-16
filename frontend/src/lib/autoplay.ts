export type AutoplayResult = 'playing' | 'playing-muted' | 'aborted' | 'blocked';

type PlayableMedia = Pick<HTMLMediaElement, 'muted' | 'play'>;

const errorName = (error: unknown): string =>
    typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name?: unknown }).name || '')
        : '';

/**
 * Start a video after an asynchronous resolve without leaving it paused at 0.
 *
 * The click that opened the film is no longer an active browser gesture by the
 * time TorBox and the HLS manifest finish resolving. Browsers therefore reject
 * audible `play()` with NotAllowedError. A muted retry is allowed and gives the
 * viewer moving video immediately; the normal volume button restores sound.
 */
export const startPlaybackWithMutedFallback = async (
    video: PlayableMedia,
): Promise<AutoplayResult> => {
    try {
        await video.play();
        return 'playing';
    } catch (error) {
        if (errorName(error) === 'AbortError') return 'aborted';
        if (errorName(error) !== 'NotAllowedError' || video.muted) return 'blocked';
    }

    const wasMuted = video.muted;
    video.muted = true;
    try {
        await video.play();
        return 'playing-muted';
    } catch (error) {
        video.muted = wasMuted;
        return errorName(error) === 'AbortError' ? 'aborted' : 'blocked';
    }
};
