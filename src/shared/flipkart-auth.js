// Login marker — health check aur verify dono ek jagah (INTEGRATIONS B2).
import { ACCOUNT_URL, LOGIN_UA } from './flipkart-login.js';

/**
 * Logged in? → /account par redirect hone ya na hone se pata chalta hai.
 * Logged OUT ho to Flipkart /account/login par bhej deta hai.
 * Network error throw hota hai (caller retry kare) — false sirf login-wall par.
 */
export async function isLoggedIn(page, { timeout = 30000 } = {}) {
  await page.goto(ACCOUNT_URL, { waitUntil: 'domcontentloaded', timeout });
  await page.waitForTimeout(1200); // redirect settle
  if (/\/account\/login/.test(page.url())) return false;

  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 12000) || '');
  // login-wall modal / "Login to view" without redirect bhi expired hai
  if (/log in|sign in/i.test(text) && /login/i.test(page.url())) return false;
  return true;
}

export { LOGIN_UA };
