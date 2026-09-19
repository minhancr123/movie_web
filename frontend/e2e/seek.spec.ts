import { test, expect } from '@playwright/test';

/**
 * Far-seek reproduction against the fake remux origin
 * (e2e/media/server.mjs on :5099 + the seektest harness route).
 *
 * Setup: 600s film, only the first 30s "written" (EVENT, no ENDLIST).
 * Seeking to 8:00 must: show the Đang tải overlay, HOLD it until the new
 * pipeline arrives (no flash-off), then play from 8:00 with the seek bar
 * reading ~480/600. Requires `node e2e/media/server.mjs 5099` running.
 *
 * Media tests run on the `brave` project: Playwright's bundled Chromium
 * ships without H.264/AAC, so MSE rejects every real segment there.
 */
test('far seek holds its loading state until the new pipeline lands', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));

  await playTo(page, 2);

  // Seek to 8:00 (480s) — far past the 30s written head. A single input
  // event (exactly what a real slider drag emits per tick).
  await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Tua video"]') as HTMLInputElement;
    if (!input) throw new Error('no seek slider');
    input.focus();
    (window as any).__nativeInputValueSetter ??= Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set;
    (window as any).__nativeInputValueSetter.call(input, '480');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // The blocking overlay pill (not the transient toast, which shares text).
  const overlay = page.getByText('Vui lòng đợi trong giây lát');
  await expect(overlay).toBeVisible({ timeout: 10_000 });

  // THE BUG: the overlay must NOT flash off before the resolve lands
  // (fake resolve takes 2.5s after a 650ms debounce ≈ 3.2s earliest).
  await page.waitForTimeout(1500);
  await expect(overlay).toBeVisible();

  // Resolve lands: overlay clears, harness mapped startAt=480, playback
  // continues from ~8:00 with the bar reading display time.
  await expect(overlay).toBeHidden({ timeout: 20_000 });
  await expect
    .poll(async () => page.evaluate(() => (document.querySelector('video') as any)?.currentTime ?? -1), {
      timeout: 20_000,
    })
    .toBeGreaterThanOrEqual(0);
  const calls = await page.evaluate(() => (window as any).__seekHarness?.calls ?? []);
  expect(calls.length, 'exactly one debounced resolve').toBe(1);
  expect(calls[0].at).toBe(480);
  const startAt = await page.evaluate(() => (window as any).__seekHarness?.startAt);
  expect(startAt).toBe(480);

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
});

async function playTo(page: any, seconds: number) {
  await page.goto('/seektest', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('video')).toBeVisible({ timeout: 30_000 });
  // Race-proof start: mount autoplay may or may not win before our click
  // lands (a click aimed at "Play" can execute as "Pause"). Converge by
  // observing actual progress: while time stalls, toggle and re-check.
  let last = -1;
  for (let i = 0; i < 4; i += 1) {
    const t = await page.evaluate(() => (document.querySelector('video') as any)?.currentTime ?? -1);
    if (t > seconds) return;
    if (t <= last + 0.05) {
      const paused = await page.evaluate(() => (document.querySelector('video') as any)?.paused ?? true);
      // Click only to start playback; never to pause here.
      if (paused) {
        await page.getByRole('button', { name: 'Phát' }).first().click({ timeout: 15_000 });
      } else {
        return;
      }
    }
    last = t;
    await page.waitForTimeout(1500);
  }
  await expect
    .poll(async () => page.evaluate(() => (document.querySelector('video') as any)?.currentTime ?? -1), {
      timeout: 30_000,
    })
    .toBeGreaterThan(seconds);
}

async function sliderSeek(page: any, value: string) {
  await page.evaluate((v: string) => {
    const input = document.querySelector('input[aria-label="Tua video"]') as HTMLInputElement;
    if (!input) throw new Error('no seek slider');
    input.focus();
    (window as any).__nativeInputValueSetter ??= Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set;
    (window as any).__nativeInputValueSetter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('seek while paused lands paused (no surprise autoplay)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  await playTo(page, 2);

  // Pause, then seek far past the head while paused (nudge the mouse first:
  // controls auto-hide a few seconds into playback).
  await page.mouse.move(450, 400);
  await page.getByRole('button', { name: 'Tạm dừng' }).first().click({ timeout: 15_000 });
  await expect
    .poll(async () => page.evaluate(() => (document.querySelector('video') as any)?.paused ?? null), {
      timeout: 10_000,
    })
    .toBe(true);

  await sliderSeek(page, '480');
  const overlay = page.getByText('Vui lòng đợi trong giây lát');
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(overlay).toBeHidden({ timeout: 20_000 });

  // Lands at the target AND stays paused: no autoplay from the rebuild.
  const state = await page.evaluate(() => ({
    paused: (document.querySelector('video') as any)?.paused,
    t: (document.querySelector('video') as any)?.currentTime,
    startAt: (window as any).__seekHarness?.startAt,
  }));
  expect(state.startAt).toBe(480);
  expect(state.paused, 'rebuild of a paused player stays paused').toBe(true);
  expect(state.t).toBeLessThan(15);
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
});

test('failed seek shows its reason and keeps the old picture', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err?.message || err)));
  await page.goto('/seektest?fail=1', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('video')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Phát' }).first().click({ timeout: 15_000 });
  await expect
    .poll(async () => page.evaluate(() => (document.querySelector('video') as any)?.currentTime ?? -1), {
      timeout: 30_000,
    })
    .toBeGreaterThan(2);

  await sliderSeek(page, '480');
  await expect(page.getByText('Vui lòng đợi trong giây lát')).toBeVisible({ timeout: 10_000 });

  // Failure surfaces over the still-playing old picture — never silent.
  await expect(page.getByText(/Không tua được/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Vui lòng đợi trong giây lát')).toBeHidden({ timeout: 10_000 });
  const t = await page.evaluate(() => (document.querySelector('video') as any)?.currentTime ?? -1);
  expect(t, 'old position keeps playing').toBeLessThan(120);
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([]);
});
