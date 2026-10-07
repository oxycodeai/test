// Login marker — health check aur verify dono ek jagah (INTEGRATIONS B2).
import { LOGIN_UA } from './flipkart-login.js';

/**
 * Logged in? — sirf auth cookies se (koi navigation nahi).
 *
 * Flipkart ab `/account` par DONO state (guest aur logged-in) me
 * ERR_TOO_MANY_REDIRECTS loop deta hai — navigation-based probe unreliable
 * hai. Session save hote waqt `at`/`S` cookies aati hain; guest ke paas
 * ye cookies hoti hi nahi. Stale cookies (server-side dead) pe flow checkout
 * wall par auto-relogin se khud heal hota hai.
 */
export async function isLoggedIn(page) {
  try {
    const ck = await page.context().cookies('https://www.flipkart.com');
    return ck.some((c) => c.name === 'at' || c.name === 'S');
  } catch {
    return true; // cookie read fail → age badho (wall heal dega)
  }
}

export { LOGIN_UA };
