import { test, expect } from '@playwright/test';

test.describe('Playback Resolve Debug', () => {
  test('investigate slow resolve for movie 1393326', async ({ page }) => {
    // 1. Log network requests
    page.on('request', request => {
      if (request.url().includes('/api/playback/resolve')) {
        console.log(`>> Request: ${request.method()} ${request.url()}`);
      }
    });

    page.on('response', response => {
      if (response.url().includes('/api/playback/resolve')) {
        console.log(`<< Response: ${response.status()} ${response.url()}`);
      }
    });

    // 2. Go to the movie page
    console.log('Navigating to movie page...');
    await page.goto('http://localhost:3000/xem-phim/movie/1393326/ma-tu', { waitUntil: 'domcontentloaded' });
    
    // Wait for the button or some element that triggers resolve if it's not automatic
    console.log('Current URL:', page.url());
    
    // Try to click play if there is a button
    const playButton = page.getByRole('button', { name: /xem ngay|phát|play/i });
    if (await playButton.isVisible()) {
        console.log('Clicking play button...');
        await playButton.click();
    }

    // 3. Wait for resolve to start and monitor stages
    console.log('Waiting for playback resolve indicator...');
    // Relaxed locator as it might be in an iframe or nested component
    const loadingText = page.getByText(/Đang chuẩn bị nguồn phát/i);
    try {
      await expect(loadingText).toBeVisible({ timeout: 20000 });
    } catch (e) {
      console.log('Indicator not found by text, searching for loading components...');
      await page.screenshot({ path: 'not-found-indicator.png' });
      // Fallback: wait for ANY response to resolve API
    }

    // 4. Monitor polling stages if they exist
    const stageLogs = [];
    page.on('response', async response => {
      if (response.url().includes('/stage')) {
        try {
          const json = await response.json();
          const timestamp = new Date().toLocaleTimeString();
          console.log(`[${timestamp}] Stage Update:`, JSON.stringify(json.data?.stage || json.data));
          stageLogs.push(json.data);
        } catch (e) {}
      }
    });

    // 5. Wait for a long time to see where it gets stuck
    console.log('Monitoring for 45 seconds...');
    await page.waitForTimeout(45000);

    // 6. Check if player appeared
    const video = page.locator('video');
    const isVisible = await video.isVisible();
    console.log(`Player visible after 45s: ${isVisible}`);

    if (!isVisible) {
      console.log('Taking screenshot of stuck state...');
      await page.screenshot({ path: 'playback-stuck.png' });
      
      const statusText = await page.locator('.text-cinema-subtle').first().textContent();
      console.log(`Final status text: ${statusText}`);
    }
  });
});
