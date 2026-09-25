import { test, expect } from '@playwright/test';

/**
 * Smoke: home renders, header + hero show, no uncaught page errors.
 * Deliberately shallow — full playback needs a real debrid account and
 * minutes of remuxing, so that stays manual. This catches dead pages,
 * hydration crashes and console-error spam (like resolve-stage 404 loops).
 */
test('home loads with header and no page errors', async ({ page }) => {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));
  page.on('requestfailed', (req) =>
    failedRequests.push(`${req.method()} ${req.url()} :: ${req.failure()?.errorText}`),
  );

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('header').first()).toBeVisible({ timeout: 30_000 });

  // Brand or nav must paint: the shell is never a blank page.
  await expect(
    page.getByText(/CineVN|CineStream|Trang chủ|Phim lẻ/i).first(),
  ).toBeVisible({ timeout: 30_000 });

  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  const fatalFailed = failedRequests.filter(
    (line) => !line.includes('/api/') || !/401|404/.test(line),
  );
  expect(
    fatalFailed,
    `non-API request failures:\n${fatalFailed.join('\n')}`,
  ).toEqual([]);
});
