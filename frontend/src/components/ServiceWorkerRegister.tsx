'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker and, more importantly, applies its updates.
 *
 * A registered worker that never reloads is worse than none: the page keeps
 * running the bundle it loaded at install time, so after a deploy the tabs look
 * alive and quietly execute code that is no longer deployed. That is exactly how
 * "the fix is live but my tab still reloads the page" happens, and it is
 * indistinguishable from the bug it is meant to fix. So: take the waiting worker
 * immediately, and reload once the new one has taken over.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    // Dev serves modules unbundled and a cached worker would only shadow them.
    // NOTE the polarity: the early return is for DEVELOPMENT. Written the other
    // way round this is not a no-op in the served bundle — Next folds
    // process.env.NODE_ENV to "production", the guard becomes an unconditional
    // return, the minifier deletes the rest of the effect, and the worker is
    // never registered anywhere while the code still reads as if it were.
    if (process.env.NODE_ENV !== 'production') return;

    let reloading = false;

    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

        // A worker already waiting was installed by an earlier visit.
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // "installed" with a controller already in place means an OLD worker
            // finished installing and a NEW one is waiting behind it. The first
            // install has no controller, and is not a replacement.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              installing.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      } catch {
        // A failed registration must never break the app.
      }
    };

    void register();
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
