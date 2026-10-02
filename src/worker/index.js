// Worker entry — handler registry + queue start.
// Phase 1: infrastructure only; health/scan/order handlers Phase 2-4 me add honge.
import { startWorker, registerHandler, enqueue, getJob } from './queue.js';
import { getBrowser, browserInfo } from './platform.js';
import { sleep, jitter } from '../shared/constants.js';

// ── Handler: smoke (browser launch check) ───────────────────
registerHandler('smoke', async () => {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.goto('https://www.flipkart.com/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    const title = await page.title();
    console.log(`[worker] smoke ok — page title: ${title}`);
  } finally {
    await page.close();
  }
  await sleep(jitter());
});

export function startJobWorker(opts) {
  return startWorker(opts);
}

export { registerHandler, enqueue, getJob, browserInfo };
