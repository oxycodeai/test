#!/usr/bin/env node
// Smoke test: platform detect + browser launch + Flipkart reachability.
// Usage: npm run smoke
import { migrate } from '../src/db/migrate.js';
import { getBrowser, closeBrowser, browserInfo } from '../src/worker/platform.js';

migrate();
console.log('[smoke] platform:', browserInfo());

try {
  const browser = await getBrowser();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const started = Date.now();
  await page.goto('https://www.flipkart.com/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  const title = await page.title();
  console.log(`[smoke] ✔ browser launched, flipkart loaded in ${Date.now() - started}ms`);
  console.log(`[smoke] ✔ title: ${title}`);
  await ctx.close();
  console.log('[smoke] ALL OK');
} catch (err) {
  console.error('[smoke] ✖ FAILED:', err.message);
  console.error('  → Termux: pkg install chromium; check CHROMIUM_PATH (.env)');
  console.error('  → PC: npx playwright install chromium');
  process.exitCode = 1;
} finally {
  await closeBrowser();
}
