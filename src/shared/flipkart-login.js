// Flipkart OTP login flow — text-first selectors (docs/INTEGRATIONS.md B1).
// Sab kuch page actions se; CSS class rotation se independent.

export const LOGIN_URL = 'https://www.flipkart.com/account/login';
export const ACCOUNT_URL = 'https://www.flipkart.com/account';
export const LOGIN_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36';

/** Login-flow error — status + noRetry queue me honor hote hain. */
export class LoginError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
    this.noRetry = true;
  }
}

const BLOCKED_RE = /access blocked|something went wrong|too many attempts|try later|not a robot|captcha/i;

/** Page par Flipkart ka block/interstitial ho to throw. */
export async function assertNotBlocked(page) {
  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 20000) || '');
  if (BLOCKED_RE.test(text)) {
    throw new LoginError('Flipkart ne login page block kiya — 60s baad retry karo', 429);
  }
}

export async function openLogin(page) {
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  await assertNotBlocked(page);
}

/** Identifier fill karo — phone (tel input) ya email (tab switch best-effort). */
export async function fillIdentifier(page, identifier) {
  const id = String(identifier || '').trim();
  if (!id) throw new LoginError('identifier missing', 400);
  if (id.includes('@')) {
    await page
      .getByText(/^email$/i)
      .first()
      .click({ timeout: 3000 })
      .catch(() => {
        /* tab nahi mila — direct input try */
      });
    const input = page
      .locator(
        'input[type="email"], input[placeholder*="mail" i], input[placeholder*="Email" i]'
      )
      .first();
    await input.waitFor({ timeout: 8000 });
    await input.fill(id);
  } else {
    const input = page
      .locator(
        'input[type="tel"], input[placeholder*="Mobile" i], input[placeholder*="number" i]'
      )
      .first();
    await input.waitFor({ timeout: 8000 });
    await input.fill(id.replace(/^\+/, ''));
  }
}

/** Continue / Send OTP / Sign in button (text-based). */
export async function clickSendOtp(page) {
  const btn = page
    .getByRole('button', { name: /continue|send otp|get otp|sign in|login/i })
    .first();
  await btn.waitFor({ timeout: 8000 });
  await btn.click();
}

/** OTP input screen ka wait — boxes (maxlength=1) ya single one-time-code input. */
export async function waitOtpScreen(page, timeout = 25000) {
  try {
    await page.waitForFunction(
      () => {
        if (document.querySelectorAll('input[maxlength="1"]').length >= 4) return true;
        if (document.querySelector('input[autocomplete="one-time-code"]')) return true;
        return [...document.querySelectorAll('input')].some((i) =>
          /otp|verification|one.time/i.test(i.placeholder || '')
        );
      },
      { timeout }
    );
  } catch {
    throw new LoginError(
      'OTP input nahi aaya (block/rate-limit ho sakta hai) — 60s baad retry karo',
      429
    );
  }
  await assertNotBlocked(page);
}

/** 6-digit OTP fill + Verify click (auto-submit bhi handle). */
export async function submitOtp(page, otp) {
  const code = String(otp || '').replace(/\D/g, '');
  if (code.length !== 6) throw new LoginError('OTP 6 digit hona chahiye', 400);

  const boxes = page.locator('input[maxlength="1"]');
  const n = await boxes.count().catch(() => 0);
  if (n >= 6) {
    for (let i = 0; i < 6; i++) {
      await boxes.nth(i).fill(code[i]);
      if (i < 5) await page.waitForTimeout(60); // natural typing rhythm
    }
  } else {
    const single = page
      .locator(
        'input[autocomplete="one-time-code"], input[placeholder*="OTP" i], input[placeholder*="verification" i]'
      )
      .first();
    await single.waitFor({ timeout: 8000 });
    await single.fill(code);
  }

  await page
    .getByRole('button', { name: /verify|login|sign in|continue/i })
    .first()
    .click({ timeout: 4000 })
    .catch(() => {
      /* auto-submit hua to button nahi milega */
    });
}

/** Login-complete ka wait — redirect se /account/login hat jaye.
 *  Wrong-OTP error text dikhi to LoginError(400). */
export async function waitLoggedIn(page, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!/\/account\/login/.test(page.url())) return true;
    const errText = await page
      .evaluate(() => document.body?.innerText?.slice(0, 8000) || '')
      .catch(() => '');
    if (/incorrect|invalid otp|wrong|expired.*(otp|code)/i.test(errText)) {
      throw new LoginError('Invalid OTP — dobara try karo (ya naya OTP le)', 400);
    }
    if (BLOCKED_RE.test(errText)) {
      throw new LoginError('Flipkart ne login block kar diya — 60s baad retry', 429);
    }
    await page.waitForTimeout(400);
  }
  if (!/\/account\/login/.test(page.url())) return true;
  throw new LoginError('Login complete nahi hua — OTP galat ya session timeout', 400);
}
