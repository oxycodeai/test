// Worker entry — handler registry + queue start.
// Phase 1: smoke. Phase 2: otp_request / otp_verify / health (F2, F3).
// Phase 4: price_check / order (booking engine).
import { getDb, getSetting } from '../db/index.js';
import { startWorker, registerHandler, enqueue, getJob } from './queue.js';
import { getBrowser, browserInfo } from './platform.js';
import {
  putRequest,
  getRequestForAccount,
  latestRequestId,
  closeRequestForAccount,
  takePendingOtp,
  takePendingCaptcha,
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
import {
  saveSession,
  loadSession,
  hasSession,
  toStorageState,
  tokenExpiry,
} from '../server/services/sessionStore.js';
import { fetchProductWithSession } from '../server/services/pageFetch.js';
import { refreshBooking } from '../server/services/bookingStore.js';
import { sendEvent } from '../server/routes/stream.js';
import { sleep, jitter, now, maskIdentifier, config } from '../shared/constants.js';
import { PRODUCT, CHECKOUT } from '../shared/selectors.js';

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

  // Token session (imported, bina OTP) — browser ki jagah JWT exp check
  if (state.auth === 'token') {
    const exp = tokenExpiry(state);
    const t = now();
    if (exp && exp > t) {
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
        .run(t, 'Access token expire ho gaya — naye token wala JSON dobara import karo', t, accountId);
      sendEvent('session_expired', { accountId, label: acc.label || null });
    }
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

// ── Handler: price_check — account session se real price quote ──
registerHandler('price_check', async (job) => {
  const orderId = job.ref_id;
  const db = getDb();
  const order = db
    .prepare(
      `SELECT o.*, b.affiliate_url AS booking_url, b.id AS bid
       FROM orders o JOIN bookings b ON b.id = o.booking_id WHERE o.id = ?`
    )
    .get(orderId);
  if (!order) throw new LoginError('Order nahi mila', 404);

  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(order.account_id);
  if (!acc) throw new LoginError('Account nahi mila', 404);

  const failQuote = (msg) => {
    db.prepare('UPDATE orders SET error = ?, updated_at = ? WHERE id = ?').run(
      String(msg).slice(0, 500),
      now(),
      orderId
    );
    refreshBooking(order.bid);
  };

  if (acc.status !== 'active' || !hasSession(acc.id)) {
    failQuote('Session nahi hai — OTP login karo');
    throw new LoginError(`account ${maskIdentifier(acc.identifier)}: no session`, 410);
  }
  const state = loadSession(acc.id);
  if (!state) {
    failQuote('Session file unreadable');
    throw new LoginError('session unreadable', 410);
  }

  await sleep(jitter());
  try {
    const data = await fetchProductWithSession(toStorageState(state), order.booking_url);
    if (!data.price) {
      failQuote('Price extract nahi hua');
      throw new LoginError('price extract failed', 422);
    }
    db.prepare('UPDATE orders SET price = ?, error = NULL, updated_at = ? WHERE id = ?').run(
      data.price,
      now(),
      orderId
    );
    console.log(`[worker] quote ok — order=${orderId} account=${acc.id} price=${data.price}`);
  } catch (e) {
    failQuote(e.message || 'price fetch fail');
    throw new LoginError(`quote fail: ${e.message || e}`, e.status || 429);
  } finally {
    refreshBooking(order.bid);
  }
});

// ── Handler: order — checkout flow (address → COD → captcha → place) ──
registerHandler('order', async (job) => {
  const orderId = job.ref_id;
  const db = getDb();
  const ctx = db
    .prepare(
      `SELECT o.*, b.affiliate_url AS booking_url, b.address_id, b.id AS bid, b.product_id,
              p.url AS product_url
       FROM orders o
       JOIN bookings b ON b.id = o.booking_id
       LEFT JOIN products p ON p.id = b.product_id
       WHERE o.id = ?`
    )
    .get(orderId);
  if (!ctx) throw new LoginError('Order nahi mila', 404);

  const acc = db.prepare('SELECT * FROM accounts WHERE id = ?').get(ctx.account_id);
  const address = ctx.address_id
    ? db.prepare('SELECT * FROM addresses WHERE id = ?').get(ctx.address_id)
    : null;
  if (!acc || !address) throw new LoginError('Account/address nahi mila', 404);

  const state = loadSession(acc.id);
  if (!state) throw new LoginError('Session nahi — pehle login karo', 410);

  const bookedDays = parseInt(getSetting('booked_days', '3'), 10) || 3;
  const orderCap = parseInt(getSetting('order_amount_cap', '49000'), 10) || 49000;
  const dryRun = config.checkoutDryRun;
  const manualCaptcha = takePendingCaptcha(orderId);

  const markError = (msg) => {
    db.prepare(
      `UPDATE orders SET captcha_state = 'failed', error = ?, updated_at = ? WHERE id = ?`
    ).run(String(msg).slice(0, 500), now(), orderId);
    refreshBooking(ctx.bid);
  };

  // Checkout ke beech login par redirect → session dead (token-cookie ya expire)
  const sessionExpired = () => {
    const t = now();
    db.prepare(
      `UPDATE accounts SET status = 'expired', last_error = ?, updated_at = ? WHERE id = ?`
    ).run('Checkout login par redirect — OTP login dobara karo', t, acc.id);
    sendEvent('session_expired', { accountId: acc.id, label: acc.label || null });
    return new LoginError(
      'Session expired — OTP login dobara karo (checkout login page par redirect)',
      410
    );
  };

  const browser = await getBrowser();
  const pageCtx = await browser.newContext({
    storageState: toStorageState(state),
    userAgent: LOGIN_UA,
    locale: 'en-IN',
  });
  const page = await pageCtx.newPage();
  try {
    await sleep(jitter());

    // 1. product page → live price pre-flight (±5%)
    await page.goto(ctx.booking_url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(1800);
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 20000)).catch(() => '');
    if (/access denied|captcha \/ enter the letters|too many requests/i.test(bodyText)) {
      throw new LoginError('Flipkart blocked this request — cooldown do (proxy use karo)', 429);
    }
    const liveM = bodyText.match(PRODUCT.fallbackPriceRegex);
    const livePrice = liveM ? Number(liveM[1].replace(/,/g, '')) : null;
    if (ctx.price != null && livePrice != null) {
      const diff = Math.abs(livePrice - ctx.price) / ctx.price;
      if (diff > 0.05) {
        throw new LoginError(
          `Price badal gayi: quote ₹${ctx.price} → live ₹${livePrice} (±5% se bahar)`,
          409
        );
      }
    }
    if (livePrice && livePrice > orderCap) {
      throw new LoginError(`Amount ₹${livePrice} cap (₹${orderCap}) se zyada — order cap diya`, 409);
    }

    // 2. Buy Now → checkout
    const buyBtn = page.getByRole('button', { name: PRODUCT.buyNowText }).or(
      page.getByRole('link', { name: PRODUCT.buyNowText })
    );
    await buyBtn.first().click({ timeout: 15000 });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2500);
    if (/\/account\/login/.test(page.url())) throw sessionExpired();

    // 3. address — sirf hamara saved address (match name+phone+pincode), add agar missing
    const addrText = `${address.name} ${address.phone} ${address.pincode}`;
    const pick = page.getByText(address.pincode, { exact: false });
    const pickCount = await pick.count().catch(() => 0);
    let matched = false;
    for (let i = 0; i < pickCount && i < 10; i++) {
      const txt = (await pick.nth(i).innerText().catch(() => '')) || '';
      const card = pick.nth(i).locator('xpath=ancestor::*[.//button or .//div[contains(text(),"Deliver")]][1]');
      const cardTxt = (await card.innerText().catch(() => txt)) || txt;
      if (cardTxt.includes(address.pincode) && (cardTxt.includes(address.phone.slice(-10)) || cardTxt.includes(address.name))) {
        await card.getByRole('button', { name: /deliver here|deliver to this address/i }).first().click({ timeout: 8000 }).catch(async () => {
          await card.click({ timeout: 5000 }).catch(() => {});
        });
        matched = true;
        break;
      }
    }
    if (!matched) {
      // add-address form → old addresses kabhi mat choose
      const addLink = page.getByRole('button', { name: /add a new address|add new address/i }).or(
        page.getByRole('link', { name: /add a new address|add new address/i })
      );
      if (await addLink.count()) {
        await addLink.first().click({ timeout: 8000 });
        await page.waitForTimeout(1200);
        const fill = async (selector, value) => {
          const el = page.locator(selector).first();
          if (await el.count().catch(() => 0)) await el.fill(value, { timeout: 5000 }).catch(() => {});
        };
        await fill('input[name="name"], input[placeholder*="ame"]', address.name);
        await fill('input[name="phone"], input[type="tel"]', address.phone);
        await fill('input[name="pincode"], input[placeholder*="incode"]', address.pincode);
        await fill('textarea[name="address"], input[name="address"]', `${address.line1}${address.line2 ? ', ' + address.line2 : ''}`);
        await fill('input[name="city"], input[placeholder*="ity"]', address.city);
        if (address.state) await fill('input[name="state"], input[placeholder*="tate"]', address.state);
        const save = page.getByRole('button', { name: /^save|save and deliver/i });
        await save.first().click({ timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(2000);
      } else {
        throw new LoginError('Address page par hamara pincode nahi mila aur Add-address link nahi dikha', 422);
      }
    }
    void addrText;
    if (/\/account\/login/.test(page.url())) throw sessionExpired();

    // 4. payment — COD only
    const cod = page.getByText(CHECKOUT.codText, { exact: false }).first();
    if (!(await cod.count().catch(() => 0))) {
      throw new LoginError('COD option nahi dikha — online payment kabhi use nahi karenge', 422);
    }
    await cod.click({ timeout: 8000 });
    await page.waitForTimeout(1200);

    // 5. captcha (agar dikhe) — manual pending queue ya diya hua text
    const captchaImg = page.locator(CHECKOUT.captchaImg).first();
    const captchaText = manualCaptcha;
    if (await captchaImg.count().catch(() => 0)) {
      if (!captchaText) {
        const png = await captchaImg.screenshot({ timeout: 5000 }).catch(() => null);
        if (png) {
          db.prepare(
            `UPDATE orders SET captcha_state = 'pending', captcha_png = ?, updated_at = ? WHERE id = ?`
          ).run(png.toString('base64'), now(), orderId);
          sendEvent('captcha_pending', { orderId, bookingId: ctx.bid, accountId: acc.id });
          refreshBooking(ctx.bid);
          throw new LoginError('CAPTCHA manual solve karo (Orders page se)', 410);
        }
      }
      const captchaInput = page.locator('input[name*="captcha"], input[placeholder*="aptcha"]').first();
      if (captchaText && (await captchaInput.count().catch(() => 0))) {
        await captchaInput.fill(captchaText, { timeout: 5000 }).catch(() => {});
      }
    }

    // 6. Place Order — dry run me sirf tak ruk jao
    const placeBtn = page.getByRole('button', { name: CHECKOUT.placeOrderBtn }).or(
      page.getByRole('button', { name: /place order/i })
    );
    await placeBtn.first().waitFor({ state: 'visible', timeout: 15000 });
    if (dryRun) {
      db.prepare(
        `UPDATE orders SET captcha_state = 'solved', order_ref = 'DRY-RUN', error = NULL, updated_at = ? WHERE id = ?`
      ).run(now(), orderId);
      refreshBooking(ctx.bid);
      console.log(`[worker] order DRY-RUN ok — order=${orderId} (Place Order click nahi hua)`);
      sendEvent('order_placed', { orderId, bookingId: ctx.bid, dryRun: true });
      return;
    }

    await placeBtn.first().click({ timeout: 10000 });
    await page.waitForTimeout(3500);
    const after = await page.evaluate(() => document.body.innerText.slice(0, 15000)).catch(() => '');

    // captcha galat → pending wapas (manual queue me rehne do)
    if (/invalid captcha|captcha does not match/i.test(after)) {
      db.prepare(
        `UPDATE orders SET captcha_state = 'pending', error = 'CAPTCHA galat — dobara solve karo', updated_at = ? WHERE id = ?`
      ).run(now(), orderId);
      sendEvent('captcha_pending', { orderId, bookingId: ctx.bid, accountId: acc.id });
      refreshBooking(ctx.bid);
      throw new LoginError('CAPTCHA galat — naya solve karo', 410);
    }
    const refM = after.match(/(?:order|order id|confirmation)[:\s#]*([A-Za-z0-9]{8,})/i);
    const orderRef = refM ? refM[1] : `FK-${orderId}-${Date.now().toString(36)}`;

    // 7. success → booked_until (default 3 din / delivery tak)
    const t = now();
    db.transaction(() => {
      db.prepare(
        `UPDATE orders SET captcha_state = 'placed', order_ref = ?, error = NULL, updated_at = ? WHERE id = ?`
      ).run(orderRef, t, orderId);
      db.prepare(
        `UPDATE accounts SET booked_until = ?, updated_at = ? WHERE id = ?`
      ).run(t + bookedDays * 86400_000, t, acc.id);
    })();
    refreshBooking(ctx.bid);
    sendEvent('order_placed', { orderId, bookingId: ctx.bid, accountId: acc.id, orderRef });
    console.log(`[worker] ORDER PLACED — order=${orderId} ref=${orderRef} account=${acc.id}`);
  } catch (e) {
    markError(e.message || String(e));
    const err =
      e instanceof LoginError
        ? e
        : new LoginError(`Order fail: ${e.message || e}`, e.status || 502);
    throw err;
  } finally {
    await pageCtx.close().catch(() => {});
  }
});

export function startJobWorker(opts) {
  return startWorker(opts);
}

export { registerHandler, enqueue, getJob, browserInfo, latestRequestId };
