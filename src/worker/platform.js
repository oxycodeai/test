import fs from 'node:fs';
import { chromium } from 'playwright';
import { isTermux, platformName, paths } from '../shared/constants.js';

/**
 * Browser launch options — Termux (system Chromium, Android flags)
 * vs PC (Playwright bundled Chromium). TRD §3.
 */
export function launchOptions() {
  if (isTermux()) {
    const executablePath =
      process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
    if (!fs.existsSync(executablePath)) {
      throw new Error(
        `Chromium not found at ${executablePath} — set CHROMIUM_PATH in .env (see docs/SETUP.md)`
      );
    }
    return {
      executablePath,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--single-process',
        '--js-flags=--jitless',
      ],
    };
  }
  return {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  };
}

let browser = null;
let launching = null;

/** Shared browser instance (server + worker same process me). */
export async function getBrowser() {
  if (browser && browser.isConnected()) return browser;
  if (launching) return launching;
  launching = chromium.launch(launchOptions()).then((b) => {
    browser = b;
    launching = null;
    b.on('disconnected', () => {
      if (browser === b) browser = null;
    });
    return b;
  });
  return launching;
}

export async function closeBrowser() {
  if (launching) {
    try {
      (await launching).close();
    } catch {
      /* ignore */
    }
    launching = null;
  }
  if (browser) {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    browser = null;
  }
}

export function browserInfo() {
  return {
    platform: platformName(),
    termux: isTermux(),
    executable: isTermux()
      ? process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser'
      : 'playwright:chromium',
    userDataDir: paths.sessions,
  };
}
