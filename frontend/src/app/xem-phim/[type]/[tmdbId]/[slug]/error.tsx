'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * Route-level crash net for the watch page.
 *
 * Without this, a client render error (blocked storage, a failed chunk after
 * a dev-server restart, an unexpected API shape) unmounts the whole segment
 * and leaves the layout's empty background — a blank void with no message and
 * no way back. This turns that into a message plus one-tap recovery.
 */
export default function WatchError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Watch page crashed:', error);
  }, [error]);

  return (
    <div className="relative mx-auto -mt-8 max-w-5xl px-4 pb-8 pt-8">
      <div className="relative z-10">
        <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-xl border border-white/10 bg-surface-dark p-6 text-center shadow-2xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-gold">
            Rạp gặp sự cố
          </p>
          <p className="max-w-md text-sm leading-relaxed text-cinema-muted">
            Trang chiếu bị lỗi bất ngờ nên không hiển thị được. Bấm thử lại, nếu
            vẫn trắng trang hãy tải lại bằng Ctrl+F5.
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => reset()}
              className="rounded-lg bg-amber-primary px-4 py-2 text-sm font-bold text-black transition hover:bg-amber-600"
            >
              Thử lại
            </button>
            <Link
              href="/"
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/15"
            >
              Về trang chủ
            </Link>
          </div>
          {error?.digest && (
            <p className="font-mono text-[10px] text-cinema-subtle">
              Mã lỗi: {error.digest}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
