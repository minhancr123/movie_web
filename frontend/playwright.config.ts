import { defineConfig, devices } from '@playwright/test';

const BRAVE_PATH =
  'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';

/**
 * Browser tests against the RUNNING dev servers
 * (frontend :3000, backend :5001). No webServer here on purpose: starting
 * another Next instance would fight the dev server for the port.
 *
 * Two projects: stock `chromium` (DOM/smoke only — Playwright's build ships
 * without H.264/AAC, so no real media can play) and `brave` (the machine's
 * real Brave in headless mode: full codecs, same engine family the site is
 * actually watched in — required for any HLS/playback test).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000',
    headless: true,
    viewport: { width: 1366, height: 900 },
  },
  projects: [
    // DOM smoke needs no media: stock Chromium is enough.
    { name: 'chromium', testMatch: /smoke\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // Debug project for resolve investigation
    { name: 'debug', testMatch: /debug\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    // Media/seek/subtitle specs need real H.264+AAC decoding.
    {
      name: 'brave',
      testMatch: /(seek|subtitles)\.spec\.ts/,
      use: {
        launchOptions: { executablePath: BRAVE_PATH },
      },
    },
  ],
});
