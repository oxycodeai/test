// Auto-relogin — order flow ke beech login wall pe: wahi page pe OTP login,
// Firebase inbox (otpInbox) se OTP khud lao, session persist karo.
// Ek retry per attempt (order handler call karta hai).
import { getDb } from '../db/index.js';
import { now, sleep } from '../shared/constants.js';
import { fetchLatestOtp, isConfigured } from '../server/services/otpInbox.js';
import { assertLoginRate } from './otp-store.js';
import {
  LoginError,
  openLogin,
  fillIdentifier,
  clickSendOtp,
  waitOtpScreen,
  submitOtp,
  waitLoggedIn,
} from '../shared/flipkart-login.js';
import { saveSession } from '../server/services/sessionStore.js';

const OTP_POLL_MS = 3000;
const OTP_TRIES = 15; // 45s me OTP inbox se code nahi mila → honest fail

/**
 * Login wall → OTP auto-login. Success: session saved + account active.
 * Fail: LoginError with code OTP_UNAVAILABLE (queue noRetry).
 */
export async function autoRelogin(page, pageCtx, acc) {
  assertLoginRate();
  if (!isConfigured()) {
    const e = new LoginError(
      'Session expired — OTP auto-fetch band hai (.env FIREBASE_DB_URL check karo)',
      501
    );
    e.code = 'OTP_UNAVAILABLE';
    throw e;
  }
  const since = Date.now();
  await openLogin(page);
  await fillIdentifier(page, acc.identifier);
  await clickSendOtp(page);
  await waitOtpScreen(page);

  let otp = null;
  for (let i = 0; i < OTP_TRIES && !otp; i++) {
    await sleep(OTP_POLL_MS);
    const out = await fetchLatestOtp(acc.identifier, since).catch(() => null);
    if (out?.found) otp = out.otp;
  }
  if (!otp) {
    const e = new LoginError(
      'Session expired — OTP 45s me inbox me nahi mila (SMS forwarder panel check karo)',
      410
    );
    e.code = 'OTP_UNAVAILABLE';
    throw e;
  }

  await submitOtp(page, otp);
  try {
    await waitLoggedIn(page);
  } catch (e) {
    // Invalid/galat OTP — ek baar naya OTP maang ke dobara try (stale/wrong
    // pick ka recovery). Doosri baar bhi fail hui to asli error bahar.
    if (!(e instanceof LoginError) || e.status !== 400) throw e;
    console.log(`[worker] invalid OTP (tried ${otp}) → resend + retry (account=${acc.id})`);
    await page.waitForTimeout(1000);
    await clickSendOtp(page).catch(() => {});
    await waitOtpScreen(page).catch(() => {});
    const since2 = Date.now() - 3000;
    let otp2 = null;
    for (let i = 0; i < 12 && !otp2; i++) {
      await sleep(OTP_POLL_MS);
      const out = await fetchLatestOtp(acc.identifier, since2).catch(() => null);
      if (out?.found && out.otp !== otp) otp2 = out.otp;
    }
    if (!otp2) throw e;
    await submitOtp(page, otp2);
    await waitLoggedIn(page);
  }
  saveSession(acc.id, await pageCtx.storageState());
  const t = now();
  getDb()
    .prepare(
      `UPDATE accounts SET status = 'active', last_checked = ?, last_error = NULL, updated_at = ? WHERE id = ?`
    )
    .run(t, t, acc.id);
  console.log(`[worker] auto-relogin ok — account=${acc.id}`);
  return true;
}
