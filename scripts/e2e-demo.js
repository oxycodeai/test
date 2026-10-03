#!/usr/bin/env node
// Phase 1 E2E demo: PIN setup → dashboard → account add → real product fetch
// Chalne ke liye server up hona chahiye: npm run start (TUNNEL=0)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'logs');
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const shot = async (page, name) => {
  const p = path.join(OUT, `e2e-${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  console.log(`  📸 ${p}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

try {
  // 1) first-run PIN setup
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const isSetup = await page
    .getByText('Set your PIN')
    .isVisible()
    .catch(() => false);
  if (isSetup) {
    await page.fill('#pin', '4747');
    await page.fill('#pin2', '4747');
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Dashboard', { timeout: 8000 });
    console.log('✔ PIN setup done');
  } else {
    // already set → login
    await page.fill('#pin', '4747').catch(() => {});
    await page.click('button[type="submit"]').catch(() => {});
    await page.waitForSelector('text=Dashboard', { timeout: 8000 });
    console.log('✔ login done');
  }
  await page.waitForTimeout(800);
  await shot(page, 'dashboard');

  // 2) accounts: add single
  await page.click('a[href="/accounts"]');
  await page.waitForSelector('text=+ Add Account', { timeout: 5000 });
  await page.click('text=+ Add Account');
  await page.fill('input[placeholder*="981234"], input[placeholder*="mail"]', '9998887776');
  await page.fill('input[placeholder="Shop-05"]', 'E2E-Acc');
  await page.click('.modal button.primary');
  // OTP request browser-path chalta hai — blocked IP par ~15s me honest error aata hai
  await page.waitForSelector('text=E2E-Acc', { timeout: 40000 });
  console.log('✔ account added (masked row visible)');
  await shot(page, 'accounts');

  // 3) fetch: real product URL (homepage/search throttled hota hai, product page alag tier)
  const productUrl =
    process.env.E2E_PRODUCT_URL ||
    'https://www.flipkart.com/apple-iphone-17-white-256-gb/p/itmf98e89534d806';
  console.log(`  product: ${productUrl.slice(0, 90)}…`);

  await page.goto(`${BASE}/fetch`, { waitUntil: 'networkidle' });
  await page.fill('#url', productUrl);
  await page.click('button[type="submit"]');

  // product card OR clear error (blocked) — dono ka wait race
  const outcome = await Promise.race([
    page
      .waitForSelector('.product-card', { timeout: 90000 })
      .then(() => 'ok')
      .catch(() => 'timeout'),
    page
      .waitForSelector('.error-text', { timeout: 90000 })
      .then(() => 'err')
      .catch(() => 'timeout'),
  ]);

  if (outcome !== 'ok') {
    const msg = (await page.locator('.error-text').first().innerText().catch(() => '')) || outcome;
    const blocked = /blocked|throttl|429/i.test(msg);
    if (blocked && process.env.E2E_ALLOW_BLOCK === '1') {
      console.log(`⚠ fetch BLOCKED (IP throttle) — allowed by E2E_ALLOW_BLOCK=1: ${msg}`);
    } else {
      throw new Error(
        blocked
          ? `fetch blocked by Flipkart (IP throttle) — cooldown pending, ya E2E_ALLOW_BLOCK=1 lagao: ${msg}`
          : `fetch failed: ${msg}`
      );
    }
  } else {
    const title = await page.locator('.product-card .title').innerText();
    const price = await page.locator('.product-card .price').innerText();
    // sanity: homepage-title/₹2 jaisa garbage PASS nahi hona chahiye
    if (/Online Shopping India Mobile, Cameras/i.test(title)) {
      throw new Error(`garbage fetch — homepage title mila: "${title}"`);
    }
    const num = parseInt(String(price).replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(num) || num < 10) {
      throw new Error(`garbage fetch — suspicious price: "${price}"`);
    }
    console.log(`✔ REAL product fetched: ${title.slice(0, 60)} | ${price}`);
    await shot(page, 'fetch-real-product');
  }

  // 4) scan page — qty guard
  await page.goto(`${BASE}/scan`, { waitUntil: 'networkidle' });
  await shot(page, 'scan-config');

  console.log('\nE2E ALL OK');
} catch (err) {
  console.error('✖ E2E FAILED:', err.message);
  await shot(page, 'failure').catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
