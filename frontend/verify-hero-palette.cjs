/* Verify: resume hero shows with seeded history + fallback intact; ⌘K palette works */
const { chromium } = require('playwright');
const BASE = 'https://cinevn.me';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'vi-VN' });
  const page = await ctx.newPage();

  // 1) Without history → trending hero renders
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const hasTrending = await page.locator('text=Thịnh hành tuần này').count();
  console.log('trending section present (no-history case):', hasTrending > 0);

  // 2) Seed a resumable history entry (Dược Sư Tự Sự ep 1 at 5:00 of 22:50)
  await page.evaluate(() => {
    localStorage.setItem('watch_history', JSON.stringify([{
      id: 'tmdb:tv:220542', slug: 'duoc-su-tu-su', name: 'Dược Sư Tự Sự',
      poster_url: '', timeSaved: Date.now(), currentEpisode: '1', season: 1,
      progress: 300, duration: 1370, mediaType: 'tv', tmdbId: 220542,
      episodeProgress: { 's1e1': { progress: 300, duration: 1370, timeSaved: Date.now() } },
    }]));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const chip = await page.locator('text=Đang xem').count();
  const cta = await page.locator('button:has-text("Tiếp tục từ"), a:has-text("Tiếp tục từ")').count();
  const title = await page.locator('h2:has-text("Dược Sư Tự Sự")').count();
  const ep = await page.locator('text=Mùa 1 · Tập 1').count();
  console.log('resume hero:', JSON.stringify({ chip: chip > 0, cta: cta > 0, title: title > 0, epLabel: ep > 0 }));
  await page.screenshot({ path: '/tmp/iphone-verify/resume-hero.png' });

  // CTA href points at the right watch URL
  const href = await page.locator('a:has-text("Tiếp tục từ")').first().getAttribute('href');
  console.log('CTA href:', href);

  // dismiss X restores trending hero for this session
  await page.click('button[aria-label="Ẩn gợi ý xem tiếp"]');
  await page.waitForTimeout(600);
  const trendingBack = await page.locator('text=Thịnh hành tuần này').count();
  console.log('after dismiss, trending visible:', trendingBack > 0);

  // 3) ⌘K palette (on home, fresh tab without history noise)
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(500);
  const paletteVisible = await page.locator('input[placeholder*="Tìm phim"]').count();
  console.log('palette opened via ⌘K:', paletteVisible > 0);
  await page.keyboard.type('nguoi nhen');
  await page.waitForTimeout(1800);
  const results = await page.locator('button:has-text("Phim lẻ"), button:has-text("Phim bộ")').count();
  console.log('palette results:', results);
  await page.screenshot({ path: '/tmp/iphone-verify/palette.png' });
  // keyboard: down + enter navigates to a detail page
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  console.log('navigated to:', page.url().slice(21, 80));

  // Esc closes
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed = await page.locator('input[placeholder*="Tìm phim"]').count();
  console.log('palette closed by Esc:', closed === 0);
  console.log('DONE');
  await browser.close();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
