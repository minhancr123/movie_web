/**
 * Whether the decorative background shader may run.
 *
 * Kept outside React because the shader is mounted by page-level layouts while
 * the switch for it lives in the player's settings panel, and the two never
 * share a tree. A stored flag plus an event reaches both without threading a
 * prop through server components.
 */
export const SHADER_PREF_KEY = 'cine_shader_enabled';
export const SHADER_PREF_EVENT = 'cine-shader-change';

export const readShaderEnabled = (): boolean => {
    if (typeof window === 'undefined') return true;
    try {
        // Absent means on: the shader is the design's default, and a viewer who
        // has never touched the switch should see the page as intended.
        return localStorage.getItem(SHADER_PREF_KEY) !== 'off';
    } catch {
        return true;
    }
};

export const setShaderEnabled = (on: boolean): void => {
    try {
        localStorage.setItem(SHADER_PREF_KEY, on ? 'on' : 'off');
    } catch {
        // Storage unavailable; the change still applies for this page's life.
    }
    window.dispatchEvent(new CustomEvent(SHADER_PREF_EVENT, { detail: on }));
};

/** Subscribes to changes; returns the unsubscribe. */
export const onShaderEnabledChange = (fn: (on: boolean) => void): (() => void) => {
    const handler = (e: Event) => fn((e as CustomEvent<boolean>).detail === true);
    window.addEventListener(SHADER_PREF_EVENT, handler);
    return () => window.removeEventListener(SHADER_PREF_EVENT, handler);
};
