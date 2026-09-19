import { test, expect } from '@playwright/test';

/**
 * Subtitle/session-offset sync against the fake remux origin
 * (e2e/media/server.mjs on :5099 + the subtest harness route).
 *
 * The canned sidecar is timed in FULL-FILM coordinates: a cue at 8:02 and a
 * decoy at 0:02. On a startAt=480 session the 8:02 cue must show while the
 * element plays its local ~2-6s (offset applied); the decoy must not (it
 * would show iff the player forgot the session offset). startAt=0 inverts
 * the expectation (control case proving the test discriminates).
 *
 * Media tests run on the `brave` project (real H.264/AAC decoding).
 * Requires `node e2e/media/server.mjs 5099` running.
 */

const SUB_URL = 'http://localhost:5099/subs/vi.vtt';

async function mockSubtitles(page: any) {
  await page.route('**/api/playback/subtitles', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          audio: [],
          tracks: [
            {
              id: 'vi-online-1',
              language: 'vi',
              label: 'Tieng Viet 1',
              url: SUB_URL,
              ready: true,
              source: 'online',
            },
          ],
          note: 'mocked',
          jobId: null,
          probe: { audio: [], subtitles: [] },
          source: 'external',
          match: { checked: true, languages: {} },
        },
      }),
    });
  });
}

async function play(page: any, startAt: number) {
  await page.goto(`/subtest?startAt=${startAt}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('video')).toBeVisible({ timeout: 30_000 });
  // Converge to playing state without ever pausing an already-playing video.
  for (let i = 0; i < 6; i += 1) {
    const t = await page.evaluate(
      () => (document.querySelector('video') as any)?.currentTime ?? -1,
    );
    if (t > 0.5) return;
    const paused = await page.evaluate(
      () => (document.querySelector('video') as any)?.paused ?? true,
    );
    if (paused) {
      await page.getByRole('button', { name: 'Phát' }).first().click({ timeout: 15_000 });
    }
    await page.waitForTimeout(1500);
  }
}

/** Overlay text while the element's local clock is inside [min, max]. */
async function overlayInWindow(page: any, min: number, max: number): Promise<string> {
  const deadline = Date.now() + 30_000;
  let last = '';
  for (;;) {
    const state = await page.evaluate(() => ({
      t: (document.querySelector('video') as any)?.currentTime ?? -1,
      // Subtitle overlay: pointer-events-none text layer above the video.
      text: Array.from(
        document.querySelectorAll('div.pointer-events-none.absolute p'),
      )
        .map((el) => (el as HTMLElement).innerText)
        .join('\n'),
    }));
    last = state.text;
    if (state.t >= min && state.t <= max) return state.text;
    if (Date.now() > deadline) {
      throw new Error(`local clock never entered [${min}, ${max}] (last t=${state.t}, text=${JSON.stringify(last)})`);
    }
    await page.waitForTimeout(400);
  }
}

test('seek-started session shows full-film-timed cues with the offset applied', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  await mockSubtitles(page);

  await play(page, 480);
  const text = await overlayInWindow(page, 2.5, 5.5);
  expect(text, '8:02 cue visible at local ~2-6s on a startAt=480 session').toContain(
    'CAU DUNG TAM PHUT',
  );
  expect(text, '0:02 decoy must not show (offset forgotten)').not.toContain('CAU SAI DAU PHIM');
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
});

test('from-start session shows the early cue (control case)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  await mockSubtitles(page);

  await play(page, 0);
  const text = await overlayInWindow(page, 2.5, 5.5);
  expect(text, '0:02 decoy visible at local ~2-6s on a startAt=0 session').toContain(
    'CAU SAI DAU PHIM',
  );
  expect(text, '8:02 cue must not show yet').not.toContain('CAU DUNG TAM PHUT');
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
});
