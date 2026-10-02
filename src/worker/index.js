// Worker entry — handler registry + queue start.
// Phase 1: smoke. Phase 2: otp_request / otp_verify / health (F2, F3).
import { getDb } from '../db/index.js';
import { startWorker, registerHandler, enqueue, getJob } from './queue.js';
import { getBrowser, browserInfo } from './platform.js';
import {
  putRequest,
  getRequestForAccount,
  latestRequestId,
  closeRequestForAccount,
  takePendingOtp,
} from './otp-store.js';
import {
  LoginError,
  LOGIN_UA,
  openLogin,
  fillIdentifier,
  clickSendOtp,
  waitOtpScreen,
  submitOtp,
  waitLoggedIn,
} from '../shared/flipkart-login.js';
import { isLoggedIn } from '../shared/flipkart-auth.js';
import { saveSession, loadSession, hasSession } from '../server/services/sessionStore.js';
import { sendEvent } from '../server/routes/stream.js';
import { sleep, jitter, now, maskIdentifier } from '../shared/constants.js';

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

function markAccountError(accountId, message) {
  getDb()
    .prepare('UPDATE accounts SET status = ?, last_error = ?, updated_at = ? WHERE id = ?')
    .run('error', String(message).slice(0, 500), now(), accountId);
}

// ── Handler: otp_request — login page kholo, identifier bharo, Send OTP ──
registerHandler('otp_request', async (job) => {
  const accountId = job.ref_id;
  const acc = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!acc) throw new LoginError('Account nahi mila', 404);

  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: LOGIN_UA, locale: 'en-IN' });
  const page = await context.newPage();
  try {
    await openLogin(page);
    await fillIdentifier(page, acc.identifier);
    await clickSendOtp(page);
    await waitOtpScreen(page);
    putRequest(accountId, context, page); // ownership → store (TTL 5 min)
    console.log(`[worker] otp-request ok — account=${maskIdentifier(acc.identifier)}`);
  } catch (e) {
    await context.close().catch(() => {});
    const err =
      e instanceof LoginError
        ? e
        : new LoginError(
            `OTP request fail: ${e.message || e} (block/timeout ho sakta hai — retry)`,
            429
          );
    markAccountError(accountId, err.message);
    throw err;
  }
});

// ── Handler: otp_verify — OTP bharo → session save ──────────
registerHandler('otp_verify', async (job) => {
  const accountId = job.ref_id;
  const otp = takePendingOtp(accountId);
  if (!otp) throw new LoginError('OTP pending nahi hai — Send OTP dobara', 410);

  const req = getRequestForAccount(accountId);
  if (!req) throw new LoginError('OTP window (5 min) khatam — Send OTP dobara', 410);

  try {
    await submitOtp(req.page, otp);
    await waitLoggedIn(req.page);
    const state = await req.context.storageState();
    saveSession(accountId, state);
    const t = now();
    getDb()
      .prepare(
        `UPDATE accounts SET status = 'active', last_checked = ?, last_error = NULL, updated_at = ? WHERE id = ?`
      )
      .run(t, t, accountId);
    console.log(`[worker] login ok — account_id=${accountId} (session saved)`);
  } catch (e) {
    const err =
      e instanceof LoginError
        ? e
        : new LoginError(`Verify fail: ${e.message || e} — retry karo`, 429);
    if (err.status !== 400) markAccountError(accountId, err.message);
    throw err;
  } finally {
    closeRequestForAccount(accountId);
  }
});

// ── Handler: health — session load → isLoggedIn marker ─────
registerHandler('health', async (job) => {
  const accountId = job.ref_id;
  const acc = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!acc) throw new LoginError('Account nahi mila', 404);

  const t0 = now();
  if (acc.status === 'pending' || !hasSession(accountId)) {
    getDb()
      .prepare('UPDATE accounts SET last_checked = ?, last_error = ? WHERE id = ?')
      .run(t0, 'No session — OTP login pending', accountId);
    return;
  }

  const state = loadSession(accountId);
  if (!state) {
    getDb()
      .prepare(
        `UPDATE accounts SET status = 'expired', last_checked = ?, last_error = ?, updated_at = ? WHERE id = ?`
      )
      .run(t0, 'Session file unreadable (missing/corrupt key)', t0, accountId);
    sendEvent('session_expired', { accountId, label: acc.label || null });
    return;
  }

  await sleep(jitter()); // batch spacing (2-5s)
  const browser = await getBrowser();
  const context = await browser.newContext({
    storageState: state,
    userAgent: LOGIN_UA,
    locale: 'en-IN',
  });
  const page = await context.newPage();
  try {
    // network error yahan throw hota hai → queue retry (status safe)
    const ok = await isLoggedIn(page);
    const t = now();
    if (ok) {
      getDb()
        .prepare(
          `UPDATE accounts SET status = 'active', last_checked = ?, last_error = NULL, updated_at = ? WHERE id = ?`
        )
        .run(t, t, accountId);
    } else {
      getDb()
        .prepare(
          `UPDATE accounts SET status = 'expired', last_checked = ?, last_error = ?, updated_at = ? WHERE id = ?`
        )
        .run(t, 'Session expired — re-login karo', t, accountId);
      console.log(`[worker] session EXPIRED — account_id=${accountId}`);
      sendEvent('session_expired', { accountId, label: acc.label || null });
    }
  } finally {
    await context.close().catch(() => {});
  }
});

export function startJobWorker(opts) {
  return startWorker(opts);
}

export { registerHandler, enqueue, getJob, browserInfo, latestRequestId };
