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
import {
  fetchProductWithSession,
  resolveAffiliateUrl,
  isFlipkartUrl,
  isProductUrl,
} from '../server/services/pageFetch.js';
import { refreshBooking, setOrderStep } from '../server/services/bookingStore.js';
import { claimForAccount, releaseNumber, sweepStale } from '../server/services/numberPool.js';
import { sendEvent } from '../server/routes/stream.js';
import { tgSend } from '../server/services/tg.js';
import { sleep, jitter, now, maskIdentifier, config } from '../shared/constants.js';
import { PRODUCT, CHECKOUT, CART } from '../shared/selectors.js';
import { autoRelogin } from './relogin.js';

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

/** Session expired — SSE event + TG alert (per-account 1 ghante ka cooldown). */
function notifySessionExpired(accountId, label) {
  sendEvent('session_expired', { accountId, label });
  const total = getDb()
    .prepare(`SELECT COUNT(*) n FROM accounts WHERE status = 'expired'`)
    .get().n;
  tgSend(
    `Account ${label || accountId} expired (${total} expired total) — re-login karo (SMS forwarder panel check karo)`,
    3600,
    `acc:${accountId}`
  );
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
    notifySessionExpired(accountId, acc.label || null);
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
      notifySessionExpired(accountId, acc.label || null);
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
      notifySessionExpired(accountId, acc.label || null);
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
    // booking_url affiliate link ho to pehle direct resolve (affid final URL) —
    // session fetch uske baad product page par lagega, junk page nahi.
    let target = order.booking_url;
    if (!(isFlipkartUrl(target) && isProductUrl(target))) {
      const resolved = await resolveAffiliateUrl(target).catch(() => null);
      if (resolved?.url) target = resolved.url;
    }
    const data = await fetchProductWithSession(toStorageState(state), target);
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

// ── Cart helpers (RN-web: hamesha real mouse clicks; DOM el.click() fail) ──

/** Leaf exact-text element pe real click (left-rail preference + mouse). */
async function clickExactLeaf(page, text) {
  const pt = await page.evaluate((t) => {
    const cands = Array.from(document.querySelectorAll('div,button,span,a')).filter(
      (e) =>
        e.offsetParent &&
        (e.innerText || '').trim().toLowerCase() === t &&
        !Array.from(e.children).some((c) => (c.innerText || '').trim().toLowerCase() === t)
    );
    if (!cands.length) return null;
    cands.sort((a, b) => a.getBoundingClientRect().x - b.getBoundingClientRect().x);
    const el = cands[0];
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, String(text).toLowerCase());
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y).catch(() => {});
  return true;
}

/** JS click — overlays/tooltip locator click intercept karte hain (checkout compat). */
async function jsClick(page, src) {
  return page.evaluate((s) => {
    const rx = new RegExp(s, 'i');
    const els = Array.from(document.querySelectorAll('button,div,span,a,li')).filter((e) => {
      if (!e.offsetParent) return false;
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim();
      return t && t.length < 60 && rx.test(t);
    });
    if (!els.length) return false;
    els.reduce((a, b) => (a.contains(b) ? b : a)).click();
    return true;
  }, src);
}

/** Cart scan — Remove leaves ke saath card-match (matched = hamara product, chhodo). */
async function scanCart(page, key) {
  return page.evaluate((k) => {
    const leaves = Array.from(document.querySelectorAll('div,button,span,a')).filter(
      (e) =>
        e.offsetParent &&
        /^remove$/i.test((e.innerText || '').trim()) &&
        !Array.from(e.children).some((c) => /remove/i.test(c.innerText || ''))
    );
    return leaves.map((leaf) => {
      let p = leaf;
      let card = null;
      for (let up = 0; up < 8 && p; up++) {
        p = p.parentElement;
        if (p && (p.innerText || '').length > 120) {
          card = (p.innerText || '').toLowerCase();
          break;
        }
      }
      const r = leaf.getBoundingClientRect();
      return {
        matched: !!(k && card && card.includes(k)),
        point: card ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null,
      };
    });
  }, key);
}

/** Cart se non-target items hatao (title match wale chhodo) — 0 removable tak. */
async function cleanCart(page, productTitle) {
  const key = String(productTitle || '').toLowerCase().slice(0, 30).trim();
  const useKey = key.length >= 8 ? key : '';
  for (let i = 0; i < 30; i++) {
    const items = await scanCart(page, useKey).catch(() => null);
    if (!items) return { ok: false, reason: 'Cart scan fail (page load nahi hua?)' };
    if (items.length === 0) return { ok: false, reason: 'Cart me item nahi dikhe (ATC fail?)' };
    const removable = items.filter((x) => !x.matched && x.point);
    if (removable.length === 0) {
      const stuck = items.some((x) => !x.matched);
      return {
        ok: !stuck,
        reason: stuck ? 'Kuch purana item remove nahi hua (card detect fail)' : '',
      };
    }
    await page.mouse.click(removable[0].point.x, removable[0].point.y).catch(() => {});
    await page.waitForTimeout(1800);
  }
  return { ok: false, reason: 'Cart clean nahi hua (30 Remove tries) — Remove click fail' };
}

/** Qty set: Q (dropdown ≤3 / more-dialog >3) → verify Qty: Q. */
async function setQty(page, Q) {
  const readQty = () =>
    page.evaluate(() => {
      const line = (document.body.innerText || '')
        .split('\n')
        .map((s) => s.trim())
        .find((l) => /^qty:\s*\d+$/i.test(l));
      return line ? Number(line.match(/\d+/)[0]) : null;
    });
  const current = await readQty().catch(() => null);
  if (current === Q) return { ok: true };

  const box = page.getByText(/^Qty:\s*\d+$/i).first();
  if (!(await box.count().catch(() => 0))) return { ok: false, reason: 'Qty box nahi mila' };
  await box.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(700);

  if (Q <= 3) {
    if (!(await clickExactLeaf(page, String(Q)))) {
      return { ok: false, reason: `Qty option ${Q} click nahi hui` };
    }
  } else {
    if (!(await clickExactLeaf(page, 'more'))) {
      return { ok: false, reason: '"more" option click nahi hui' };
    }
    const inp = page.locator('input[placeholder="Quantity"]:visible').first();
    if (!(await inp.count().catch(() => 0))) {
      return { ok: false, reason: 'Quantity dialog input nahi mila' };
    }
    await inp.fill(String(Q), { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    // APPLY — dialog wala (coupon row ke Apply ko chhodo)
    const pt = await page.evaluate(() => {
      const cands = Array.from(document.querySelectorAll('div,button,span')).filter(
        (e) =>
          e.offsetParent &&
          /^apply$/i.test((e.innerText || '').trim()) &&
          !Array.from(e.children).some((c) => /apply/i.test(c.innerText || ''))
      );
      const inDialog = cands.find((e) => {
        let p = e.parentElement;
        for (let up = 0; up < 6 && p; up++, p = p.parentElement) {
          if (/enter quantity|quantity/i.test(p.innerText || '')) return true;
        }
        return false;
      });
      const el = inDialog || cands[cands.length - 1];
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (!pt) return { ok: false, reason: 'APPLY button nahi mila (dialog badla?)' };
    await page.mouse.click(pt.x, pt.y).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const got = await page
    .waitForFunction(
      (q) => {
        const line = (document.body.innerText || '')
          .split('\n')
          .map((s) => s.trim())
          .find((l) => /^qty:\s*\d+$/i.test(l));
        return line ? Number(line.match(/\d+/)[0]) === q : false;
      },
      Q,
      { timeout: 8000 }
    )
    .then(() => true)
    .catch(() => false);
  return got ? { ok: true } : { ok: false, reason: `Qty ${Q} set verify nahi hua` };
}

/** Sheet me saved address row click (name > pincode match) — real click. */
async function pickSavedAddress(page, address) {
  const pt = await page.evaluate((a) => {
    const wantName = String(a.name || '').toLowerCase().trim();
    const pin = String(a.pincode || '');
    // Scope: sirf open address sheet. Poore page me scan karne se header ka
    // "Deliver to" widget (name+pin dono) hi best-score jeet jaata hai.
    let root = null;
    for (const e of document.querySelectorAll('div')) {
      if (
        e.offsetParent &&
        /^select delivery address/i.test((e.innerText || '').replace(/\s+/g, ' ').trim())
      ) {
        root = e;
        break;
      }
    }
    const scope = root || document;
    const cands = Array.from(scope.querySelectorAll('div,span,p,li')).filter(
      (e) => e.offsetParent && e.children.length <= 6
    );
    let best = null;
    let bestScore = 0;
    for (const e of cands) {
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!t || t.length > 220) continue;
      const hitName = wantName && t.includes(wantName);
      const hitPin = pin && t.includes(pin);
      const score = (hitName ? 2 : 0) + (hitPin ? 1 : 0);
      if (score > bestScore) {
        best = e;
        bestScore = score;
      }
    }
    if (!best) return null;
    best.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = best.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { name: address.name, pincode: address.pincode });
  if (!pt) {
    console.log('[worker] pick: row nahi mila');
    return false;
  }
  console.log(`[worker] pick: click at ${Math.round(pt.x)},${Math.round(pt.y)}`);
  await page.mouse.click(pt.x, pt.y).catch(() => {});
  return true;
}

/**
 * status=match two-pick ke liye: target ke ALAWA koi bhi saved row (revalidation
 * force karne ke liye). Row me pincode nahi hota — isliye exclusion-based pick.
 */
async function pickOtherSavedAddress(page, address) {
  return page.evaluate((a) => {
    const root = Array.from(document.querySelectorAll('div')).find(
      (e) =>
        e.offsetParent &&
        /^select delivery address/i.test((e.innerText || '').replace(/\s+/g, ' ').trim())
    );
    if (!root) return null;
    const wantName = String(a.name || '').toLowerCase().trim();
    const pin = String(a.pincode || '');
    const cands = Array.from(root.querySelectorAll('div,span,p,li')).filter(
      (e) => e.offsetParent && e.children.length <= 6
    );
    let best = null;
    let bestLen = 0;
    for (const e of cands) {
      const t = (e.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (t.length < 10 || t.length > 220) continue;
      if (wantName && t.includes(wantName)) continue;
      if (pin && t.includes(pin)) continue;
      if (t.length > bestLen) {
        best = e;
        bestLen = t.length;
      }
    }
    if (!best) return null;
    best.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = best.getBoundingClientRect();
    return {
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      t: (best.innerText || '').replace(/\s+/g, ' ').slice(0, 60),
    };
  }, { name: address.name, pincode: address.pincode });
}

/**
 * Address sheet me "+ Add New" — checkout wala map-pin flow cart sheet pe
 * (Phase 2 decision 1: address saved na ho to khud add karo). Save ke baad
 * sheet wapas; caller pickSavedAddress se select karega.
 */
async function addAddressViaSheet(page, address, acc) {
  await jsClick(page, '^add new$');
  await page
    .getByPlaceholder(/search by area/i)
    .first()
    .waitFor({ timeout: 12000 })
    .catch(() => {});
  const searchInp = page.getByPlaceholder(/search by area/i).first();
  if (!(await searchInp.count().catch(() => 0))) {
    return { ok: false, reason: 'Address search field nahi khula (sheet layout badla?)' };
  }
  await searchInp.fill(address.pincode, { timeout: 5000 }).catch(() => {});
  const gotSug = await page
    .waitForFunction(
      (pin) =>
        document.body.innerText.includes(pin) && /India/.test(document.body.innerText),
      address.pincode,
      { timeout: 12000 }
    )
    .then(() => true)
    .catch(() => false);
  if (gotSug) {
    await page.evaluate((pin) => {
      const nodes = Array.from(document.querySelectorAll('div,li,span,p')).filter(
        (e) => e.offsetParent && (e.textContent || '').includes(pin) && e.children.length <= 3
      );
      if (nodes.length) {
        nodes[nodes.length - 1].dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true })
        );
      }
    }, address.pincode);
  }
  await page.waitForTimeout(3000);
  // state machine: pin-fail retry → away sheet → details CTA → form
  let formOpen = false;
  for (let i = 0; i < 7; i++) {
    const t = await page
      .evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
      .catch(() => '');
    if (/flat\/house/i.test(t)) {
      formOpen = true;
      break;
    }
    if (/unable to pin your location/i.test(t)) {
      await jsClick(page, '^try again$');
      await page.waitForTimeout(4000);
      continue;
    }
    if (/away from my location/i.test(t)) {
      await jsClick(page, 'away from my location');
      await page.waitForTimeout(2500);
      continue;
    }
    if (/add address details/i.test(t)) {
      await jsClick(page, '^add address details$');
      await page.waitForTimeout(2500);
      continue;
    }
    await page.waitForTimeout(2000);
  }
  if (!formOpen) {
    return { ok: false, reason: 'Address form nahi khula (map pin fail?)' };
  }
  const allInp = page.locator('input:visible, textarea:visible');
  const full = `${address.line1}${address.line2 ? ', ' + address.line2 : ''}`;
  const phone = String(address.phone || acc.identifier || '');
  await allInp.nth(1).fill(full, { timeout: 5000 }).catch(() => {});
  await allInp.nth(2).fill(address.name, { timeout: 5000 }).catch(() => {});
  await allInp.nth(3).fill(phone, { timeout: 5000 }).catch(() => {});
  const filledOk = await page.evaluate(
    (want) => {
      const vals = Array.from(document.querySelectorAll('input,textarea'))
        .filter((i) => i.offsetParent)
        .map((i) => i.value);
      return vals.some((v) => v.includes(want.name)) && vals.includes(want.phone);
    },
    { name: address.name, phone }
  );
  if (!filledOk) return { ok: false, reason: 'Address form fill nahi hua (fields badle?)' };
  await jsClick(page, '^home$');
  await page.waitForTimeout(300);
  await jsClick(page, '^save address$');
  await page.waitForTimeout(3000);
  return { ok: true };
}

const sheetOpen = (page) =>
  page.evaluate(
    (src) => new RegExp(src, 'i').test(document.body.innerText || ''),
    CART.addrSheetText.source
  );

/** Address sheet band karo — Escape, phir fallback sheet-root ✕ leaf click.
 *  viewcart bounce ke baad sheet AUTO-open ho jaata hai (FK redirect race) —
 *  tab PO click overlay pe chala jaata hai, isliye har PO click se PEHLE. */
async function closeAddrSheet(page) {
  if (!(await sheetOpen(page))) return;
  console.log('[worker] payment: sheet DOBARA khula — closing');
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(700);
  if (await sheetOpen(page)) {
    await page.evaluate(() => {
      const root = Array.from(document.querySelectorAll('div')).find(
        (e) =>
          e.offsetParent &&
          /^select delivery address/i.test((e.innerText || '').replace(/\s+/g, ' ').trim())
      );
      if (!root) return;
      const x = Array.from(root.querySelectorAll('div,span,button')).find(
        (e) => e.offsetParent && /^(✕|×|x|close)$/i.test((e.innerText || '').trim())
      );
      if (x) x.click();
    });
    await page.waitForTimeout(700);
  }
  console.log('[worker] payment: sheetOpen after close=', await sheetOpen(page));
}

/** Address gate: fresh viewcart reload (widget-state reset) → pincode path
 *  se sheet → saved select (miss pe Add New) → sheet close. Sheet fail par
 *  PO yellow ho to pass. */
async function selectCartAddress(page, address, acc) {
  // PROVEN (probe14): widget already target address dikhata hai to same-row
  // re-pick NO-OP hai — FK serviceability revalidation fire hi nahi hoti,
  // stale "not available" state → PO grey. Fix: status=match ho to PEHLE
  // koi DOOSRA saved address select karo (selection change → revalidation →
  // PO yellow), phir target wapas select karo (yellow rehti hai). status=none
  // (pincode path) me target pick = pehli selection = khud revalidation.
  const status = await page.evaluate((a) => {
    const txt = (document.body.innerText || '').replace(/\s+/g, ' ');
    if (!/deliver to/i.test(txt)) return 'none';
    const wantName = String(a.name || '').toLowerCase().trim();
    const pin = String(a.pincode || '');
    const hitName = wantName && txt.toLowerCase().includes(wantName);
    const hitPin = pin && txt.includes(pin);
    return hitName || hitPin ? 'match' : 'mismatch';
  }, { name: address.name, pincode: address.pincode });
  console.log(`[worker] addr: status=${status}`);
  let opened = false;
  const openers = [
    CART.addrOpenText,
    /from saved addresses/i,
    ...(status === 'match' || status === 'mismatch' ? [/change/i] : []),
  ];
  for (const re of openers) {
    const loc = page.getByText(re).first();
    if (!(await loc.count().catch(() => 0))) continue;
    await loc.click({ timeout: 5000 }).catch(() => {});
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (await sheetOpen(page)) {
        opened = true;
        break;
      }
      await page.waitForTimeout(300);
    }
    if (opened) break;
  }
  if (!opened) {
    console.log(`[worker] addr: sheet open fail (status=${status})`);
    // Address pehle se selected hai aur PO bhi enabled hai → gate pass
    if (status === 'match' && (await poBg(page)) === CART.poEnabledBg) return { ok: true };
    return { ok: false, code: 'ADDRESS', reason: 'Address sheet nahi khuli' };
  }
  console.log('[worker] addr: sheet open, 700ms settle');
  // Sheet open = title text aana (tabhi skeleton "- - -" hota hai) → content
  // settle ka wait, warna row click overlay pe chala jaata hai.
  await page.waitForTimeout(700);

  // ── PRIMARY (probe16 proven): Add New (phone = claimed number) ──
  // FK save karte hi naya address AUTO-SELECT + serviceability revalidation
  // khud fire → PO yellow (1-2s). Repick BILKUL nahi — repick = purani row
  // re-select = purana phone checkout me (6622005501 wala bug) + bounce.
  const added = await addAddressViaSheet(page, address, acc);
  console.log(`[worker] addr: add-new=${added.ok}${added.ok ? '' : ` (${added.reason})`}`);
  if (added.ok) {
    let yellow = false;
    for (let i = 0; i < 14; i++) {
      if ((await poBg(page)) === CART.poEnabledBg) {
        yellow = true;
        break;
      }
      await page.waitForTimeout(1000);
    }
    await closeAddrSheet(page); // sheet bachi ho to band (PO click overlay-safe)
    console.log(`[worker] addr: add-new yellow=${yellow}`);
    if (yellow) return { ok: true };
  }

  // ── FALLBACK: add-new fail/no-yellow → sheet reopen → purana two-pick ──
  // (flow chalega par FK address ka phone old ho sakta hai)
  console.log('[worker] addr: fallback two-pick');
  let reopened = await sheetOpen(page);
  if (!reopened) {
    for (const re of openers) {
      const loc = page.getByText(re).first();
      if (!(await loc.count().catch(() => 0))) continue;
      await loc.click({ timeout: 5000 }).catch(() => {});
      const t1 = Date.now();
      while (Date.now() - t1 < 8000) {
        if (await sheetOpen(page)) {
          reopened = true;
          break;
        }
        await page.waitForTimeout(300);
      }
      if (reopened) break;
    }
  }
  if (!reopened) return { ok: false, code: 'ADDRESS', reason: 'Fallback me address sheet nahi khuli' };
  await page.waitForTimeout(700);

  // status=match: pehle DOOSRA address select (revalidation force), phir
  // target. Order115/proof: same-address re-pick se PO kabhi yellow nahi hota.
  if (status === 'match') {
    const other = await pickOtherSavedAddress(page, address);
    console.log(`[worker] addr: other-pick=${JSON.stringify(other)}`);
    if (other?.x) {
      await page.mouse.click(other.x, other.y).catch(() => {});
      const t2 = Date.now();
      while (Date.now() - t2 < 5000) {
        if (!(await sheetOpen(page))) break;
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(1500); // revalidation settle
      const loc2 = page.getByText(/change/i).first();
      if (await loc2.count().catch(() => 0)) {
        await loc2.click({ timeout: 5000 }).catch(() => {});
        const t3 = Date.now();
        while (Date.now() - t3 < 8000) {
          if (await sheetOpen(page)) break;
          await page.waitForTimeout(300);
        }
        await page.waitForTimeout(700);
      } else {
        console.log('[worker] addr: reopen fail (change btn nahi mila)');
      }
    }
  }

  const picked = await pickSavedAddress(page, address);
  console.log(`[worker] addr: first pick=${picked}`);
  if (!picked) return { ok: false, code: 'ADDRESS', reason: 'Address row select nahi hui' };

  // Close poll + retry: click swallow hua to content settle ke baad dobara pick.
  let closed = false;
  for (let i = 0; i < 3 && !closed; i++) {
    const t1 = Date.now();
    while (Date.now() - t1 < 4000) {
      if (!(await sheetOpen(page))) {
        closed = true;
        break;
      }
      await page.waitForTimeout(300);
    }
    console.log(`[worker] addr: close attempt ${i + 1} closed=${closed} poBg=${await poBg(page)}`);
    if (closed) break;
    await page.waitForTimeout(700);
    await pickSavedAddress(page, address);
  }
  if (!closed) {
    await page.screenshot({ path: '.tmp-test/addr-fail.png' }).catch(() => {});
    if ((await poBg(page)) === CART.poEnabledBg) return { ok: true }; // select ho gaya par sheet modal
    return { ok: false, code: 'ADDRESS', reason: 'Address select ke baad sheet close nahi hua' };
  }
  console.log(`[worker] addr: returned, sheetOpen=${await sheetOpen(page)} poBg=${await poBg(page)}`);
  return { ok: true };
}

/** Cart Place Order ka leaf bg color (yellow = enabled). */
const poBg = (page) =>
  page
    .evaluate(() => {
      const leaf = Array.from(document.querySelectorAll('div,button,a,span')).filter(
        (e) =>
          /^place order$/i.test((e.innerText || '').trim()) &&
          e.offsetParent &&
          !Array.from(e.children).some((k) => /place order/i.test(k.innerText || ''))
      ).pop();
      if (!leaf) return null;
      return getComputedStyle(leaf.parentElement || leaf).backgroundColor;
    })
    .catch(() => null);

/** Cart Place Order yellow (enabled) hone ka poll — revalidate ke baad. */
async function waitPoEnabled(page, ms = CART.revalidateMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await poBg(page)) === CART.poEnabledBg) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

// ── Handler: order — naya cart checkout flow (Phase 2) ──────────────────────
// affiliate → cart(cleanup) → qty → price(max_price gate) → address(cart gate)
// → payment(PO → checkout → COD) → captcha → place. Login wall pe auto-relogin
// ek baar (relogin.js). Attempt = 1 job = terminal row.
registerHandler('order', async (job) => {
  const orderId = job.ref_id;
  const db = getDb();
  const ctx = db
    .prepare(
      `SELECT o.*, b.affiliate_url AS booking_url, b.address_id, b.id AS bid, b.product_id,
              p.url AS product_url, p.title AS product_title
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

  // naya model (Phase 1) me bookings.max_price; column abhi na ho to gate skip
  const bk = db.prepare('SELECT * FROM bookings WHERE id = ?').get(ctx.bid) || {};
  const maxPrice =
    bk.max_price != null && Number.isFinite(Number(bk.max_price))
      ? Number(bk.max_price)
      : null;
  const qty = Math.max(1, parseInt(ctx.qty, 10) || 1);

  const state = loadSession(acc.id);
  if (!state) throw new LoginError('Session nahi — pehle login karo', 410);

  const bookedDays = parseInt(getSetting('booked_days', '3'), 10) || 3;
  const dryRun = config.checkoutDryRun;
  const manualCaptcha = takePendingCaptcha(orderId);

  /** Attempt fail — row failed + order_failed SSE (pending captcha preserve). */
  const attemptFail = (code, msg) => {
    const cur = db.prepare('SELECT captcha_state FROM orders WHERE id = ?').get(orderId);
    if (cur?.captcha_state !== 'pending') {
      db.prepare(
        `UPDATE orders SET captcha_state = 'failed', error = ?, updated_at = ? WHERE id = ?`
      ).run(`${code}: ${String(msg)}`.slice(0, 500), now(), orderId);
      refreshBooking(ctx.bid);
      sendEvent('order_failed', {
        orderId,
        bookingId: ctx.bid,
        accountId: acc.id,
        code,
        error: `${code}: ${String(msg)}`.slice(0, 500),
      });
      // error TG me alag message NAHI — refreshBooking ke live progress
      // message me hi error line edit ho jati hai (single-message rule).
    }
    const e = new LoginError(`${code}: ${msg}`, 422);
    e.code = code;
    e.handled = true; // catch-block dobara mark na kare
    return e;
  };

  /** Catch-all fail — 'pending' row ko failed MAT banao (manual captcha wait). */
  const markError = (e) => {
    if (e?.handled) return;
    const cur = db.prepare('SELECT captcha_state FROM orders WHERE id = ?').get(orderId);
    if (cur?.captcha_state === 'pending') return;
    db.prepare(
      `UPDATE orders SET captcha_state = 'failed', error = ?, updated_at = ? WHERE id = ?`
    ).run(String(e.message || e).slice(0, 500), now(), orderId);
    refreshBooking(ctx.bid);
    sendEvent('order_failed', {
      orderId,
      bookingId: ctx.bid,
      accountId: acc.id,
      code: e.code || 'ORDER_FAIL',
      error: String(e.message || e).slice(0, 500),
    });
    // error alag TG message nahi — live progress message me hi (single-message rule)
  };

  const loginWall = () => {
    const e = new LoginError('Session expired — checkout login par redirect', 410);
    e.wall = true;
    e.code = 'SESSION_EXPIRED';
    return e;
  };

  const browser = await getBrowser();
  const pageCtx = await browser.newContext({
    storageState: toStorageState(state),
    userAgent: LOGIN_UA,
    locale: 'en-IN',
  });
  const page = await pageCtx.newPage();
  const step = (key) => setOrderStep(orderId, ctx.bid, key);
  const bodyNow = () =>
    page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ')).catch(() => '');
  const wallNow = async () => {
    const t = await bodyNow();
    if (/\/account\/login/.test(page.url()) || /log in to complete your shopping/i.test(t)) {
      throw loginWall();
    }
  };

  const runAttempt = async () => {
    await sleep(jitter());
    // 1. affiliate landing — booking_url (user ki apni affiliate link) se goto;
    // final URL flipkart /p/ par land karna chahiye. Na land ho to direct resolve
    // (affid wala final URL) try karo, phir bhi na mile to honest fail — bina
    // user ki affiliate link ke order kabhi nahi chalega (tracking safe).
    step('affiliate');
    await page.goto(ctx.booking_url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page
      .waitForURL((u) => isFlipkartUrl(u.href) && isProductUrl(u.href), { timeout: 12000 })
      .catch(() => {});
    if (!(isFlipkartUrl(page.url()) && isProductUrl(page.url()))) {
      const resolved = await resolveAffiliateUrl(ctx.booking_url).catch(() => null);
      if (resolved?.url) {
        await page.goto(resolved.url, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(1500);
      }
    }
    if (!(isFlipkartUrl(page.url()) && isProductUrl(page.url()))) {
      throw attemptFail(
        'AFFILIATE_LAND_FAIL',
        'Affiliate link se Flipkart product page land nahi hua — bina aapki link ke ' +
          'checkout nahi karenge (tracking safe). Link check karke Retry karo.'
      );
    }
    await wallNow();
    await page.waitForTimeout(1800);

    // 2. cart — block check → ATC → viewcart → purane items hatao (cleanup)
    step('cart');
    const bodyText = await page
      .evaluate(() => document.body.innerText.slice(0, 20000))
      .catch(() => '');
    if (/access denied|captcha \/ enter the letters|too many requests/i.test(bodyText)) {
      throw attemptFail('BLOCKED', 'Flipkart blocked — cooldown do (proxy use karo)');
    }
    const atc = page.getByText(PRODUCT.addToCartText).first();
    // Product page heavy hoti hai (ads) — ATC late render karta hai, isliye
    // explicit wait, warna count 0 → false CART_ADD_FAIL.
    await atc.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    if (!(await atc.count().catch(() => 0))) {
      await page.screenshot({ path: '.tmp-test/cart-add-fail.png' }).catch(() => {});
      throw attemptFail('CART_ADD_FAIL', 'Add to cart button nahi mila (page layout badla?)');
    }
    await atc.evaluate((el) => el.click()).catch(() => {});
    await page.goto(CART.viewcartUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page
      .waitForFunction(
        (src) => new RegExp(src, 'i').test(document.body.innerText || ''),
        CART.readyText.source,
        { timeout: 25000 }
      )
      .catch(() => {});
    await page.waitForTimeout(CART.settleMs);
    await wallNow();
    const cleaned = await cleanCart(page, ctx.product_title);
    if (!cleaned.ok) throw attemptFail('CART_CLEAN_FAIL', cleaned.reason);

    // 3. qty — Q set (dropdown ≤3 / more-dialog >3) → verify
    step('qty');
    const q = await setQty(page, qty);
    if (!q.ok) throw attemptFail('QTY_SET_FAIL', q.reason);

    // 4. price — final bill (qty + offers ke baad) vs max_price — naya single gate
    step('price');
    const bill = await page
      .evaluate(() => {
        const m = (document.body.innerText || '').match(/Total Amount\s*₹\s?([\d,]+)/);
        return m ? Number(m[1].replace(/,/g, '')) : null;
      })
      .catch(() => null);
    if (bill == null || !Number.isFinite(bill)) {
      throw attemptFail('PRICE_READ_FAIL', 'Cart bill padha nahi (page layout badla?)');
    }
    db.prepare('UPDATE orders SET price = ?, updated_at = ? WHERE id = ?').run(
      bill,
      now(),
      orderId
    );
    if (maxPrice != null && bill > maxPrice) {
      throw attemptFail('PRICE_OUT_OF_RANGE', `cart bill ₹${bill} > limit ₹${maxPrice}`);
    }

    // 4. address — cart sheet: saved select (miss pe Add New) → PO yellow gate
    step('address');
    const addr = await selectCartAddress(page, address, acc);
    if (!addr.ok) throw attemptFail(addr.code, addr.reason);
    if (!(await waitPoEnabled(page))) {
      const dbg = await page
        .evaluate(() => {
          const txt = document.body.innerText.replace(/\s+/g, ' ');
          const leaves = Array.from(document.querySelectorAll('div,button,a,span'))
            .filter(
              (e) =>
                /^place order$/i.test((e.innerText || '').trim()) &&
                e.offsetParent &&
                !Array.from(e.children).some((k) => /place order/i.test(k.innerText || ''))
            )
            .map((e) => ({
              parent: (e.parentElement || e).tagName,
              bg: getComputedStyle(e.parentElement || e).backgroundColor,
              cls: String((e.parentElement || e).className || '').slice(0, 80),
            }));
          return {
            leaves,
            notAvail: /not available in your pincode/i.test(txt),
            deliverTo: /deliver to/i.test(txt),
            rajesh: /rajesh/i.test(txt),
            addrHead: txt.slice(0, 300),
          };
        })
        .catch((e) => ({ err: e.message.split('\n')[0] }));
      console.log('[worker] PO_DISABLED dbg:', JSON.stringify(dbg));
      await page.screenshot({ path: '.tmp-test/po-disabled.png' }).catch(() => {});
      throw attemptFail('PO_DISABLED', 'Address select ke baad bhi Place Order grey hai');
    }
    // Target-pick ke baad FK ka address commit + revalidate thoda late settle
    // hota hai — jaldi PO click karne pe viewcart bounce ho jaata hai.
    await page.waitForTimeout(1500);

    // 5. payment — cart PO (yellow) → viewcheckout → inline verify → Continue → COD
    // FK kabhi viewcheckout se 1-2s me wapas viewcart redirect kar deta hai
    // (race, logic nahi) — PO click + stable-nav ko 3 baar tak retry karo.
    step('payment');
    const navCheckout = () =>
      page
        .waitForURL(/viewcheckout|pay\.flipkart\.com/, { timeout: 10000 })
        .then(() => true)
        .catch(() => false);
    let onCheckout = false;
    for (let i = 0; i < 3 && !onCheckout; i++) {
      if (i > 0) {
        console.log(`[worker] po retry #${i + 1}`);
        await page.waitForTimeout(2500);
      }
      // Sheet kabhi re-open ho jaye to PO click overlay pe gayega — assert+close.
      await closeAddrSheet(page);
      // NBSP problem + pointer race: mouse coords sometimes overlay pe chale
      // jaate hain — pehle native leaf click (jsClick-style, overlay-proof),
      // fallback viewport mouse click.
      const clicked = await jsClick(page, '^place order$');
      console.log(`[worker] po click(native)=${clicked} try=${i + 1}`);
      let navd = await navCheckout();
      if (!navd) {
        const poPt = await page.evaluate(() => {
          const leaves = Array.from(document.querySelectorAll('div,button,a,span')).filter(
            (e) =>
              /^place order$/i.test((e.innerText || '').trim()) &&
              e.offsetParent &&
              !Array.from(e.children).some((k) => /place order/i.test(k.innerText || ''))
          );
          if (!leaves.length) return null;
          const target =
            leaves.find((e) => {
              const r = e.getBoundingClientRect();
              return r.width > 0 && r.top >= 0 && r.bottom <= window.innerHeight;
            }) || leaves[leaves.length - 1];
          target.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r = target.getBoundingClientRect();
          return {
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2),
            n: leaves.length,
          };
        });
        if (poPt) {
          console.log(`[worker] po click(fallback coords)=${JSON.stringify(poPt)}`);
          await page.mouse.click(poPt.x, poPt.y).catch(() => {});
          navd = await navCheckout();
        }
      }
      if (navd) {
        // Page load ke baad FK redirect abhi bhi kar sakta hai — settle hua
        // ya nahi (URL wapas viewcart) ye 2.5s baad pata chalega.
        await page.waitForTimeout(2500);
        onCheckout = /viewcheckout|pay\.flipkart\.com/.test(page.url());
        if (!onCheckout) {
          console.log(
            `[worker] po bounce → viewcart, sheetOpen=${await sheetOpen(page)} url=${page.url().slice(0, 70)}`
          );
        }
      } else {
        console.log(`[worker] po nav fail try=${i + 1} url=${page.url().slice(0, 70)}`);
      }
    }
    if (!onCheckout) {
      const url = page.url();
      const ctas = await page
        .evaluate(() =>
          ['continue', 'pay', 'place order', 'proceed', 'deliver here', 'confirm'].map((k) => {
            const hit = Array.from(document.querySelectorAll('div,button,a,span')).find(
              (e) =>
                e.offsetParent &&
                new RegExp('^' + k + '$', 'i').test((e.innerText || '').replace(/\s+/g, ' ').trim())
            );
            return hit
              ? (hit.innerText || '').replace(/\s+/g, ' ').trim() +
                  '@' +
                  Math.round(hit.getBoundingClientRect().x) +
                  ',' +
                  Math.round(hit.getBoundingClientRect().y)
              : null;
          }).filter(Boolean)
        )
        .catch(() => []);
      console.log('[worker] continue dbg:', JSON.stringify({ url: url.slice(0, 90), ctas }));
      await page.screenshot({ path: '.tmp-test/continue-fail.png' }).catch(() => {});
      throw attemptFail('CHECKOUT_FAIL', 'Checkout page nahi khula (Place Order click fail?)');
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await wallNow();
    console.log(`[worker] after PO click: url=${page.url().slice(0, 70)} sheetOpen=${await sheetOpen(page)}`);
    await page
      .getByText(/deliver to:/i)
      .first()
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    const inlineAddr = async () => {
      const t = (await bodyNow()).toLowerCase();
      return (
        t.includes(String(address.pincode)) &&
        (t.includes(String(address.name).toLowerCase()) ||
          (address.phone && t.includes(String(address.phone).slice(-10))))
      );
    };
    if (!(await inlineAddr())) {
      await jsClick(page, '^change$');
      await page.waitForTimeout(1500);
      await page
        .getByText(/select delivery address/i)
        .first()
        .waitFor({ timeout: 8000 })
        .catch(() => {});
      const pick = await pickSavedAddress(page, address);
      if (!pick || !(await inlineAddr())) {
        const dbgT = await bodyNow().catch(() => '');
        const m = dbgT.match(/deliver to:.{0,220}/i);
        console.log('[worker] checkout addr dbg:', JSON.stringify(m ? m[0] : dbgT.slice(0, 220)));
        await page
          .screenshot({ path: '.tmp-test/checkout-addr-fail.png' })
          .catch(() => {});
        throw attemptFail('ADDRESS', 'Checkout par hamara address select nahi hua');
      }
    }
    await wallNow();
    let contClicked = await jsClick(page, '^continue$');
    await page.waitForURL(/pay\.flipkart\.com/, { timeout: 20000 }).catch(() => {});
    if (!/pay\.flipkart\.com/.test(page.url())) {
      // viewcheckout stable par Continue miss ho gaya (render/settle race) —
      // ek baar dobara click.
      console.log(`[worker] continue miss, retry (prev=${contClicked})`);
      await page.waitForTimeout(1500);
      contClicked = (await jsClick(page, '^continue$')) || contClicked;
      await page.waitForURL(/pay\.flipkart\.com/, { timeout: 20000 }).catch(() => {});
    }
    await wallNow();
    if (!/pay\.flipkart\.com/.test(page.url())) {
      const ctas = await page
        .evaluate(() =>
          ['continue', 'pay', 'place order', 'proceed', 'deliver here', 'confirm']
            .map((k) => {
              const hit = Array.from(document.querySelectorAll('div,button,a,span')).find(
                (e) => e.offsetParent && new RegExp('^' + k + '$', 'i').test((e.innerText || '').replace(/\s+/g, ' ').trim())
              );
              return hit ? (hit.innerText || '').replace(/\s+/g, ' ').trim() + '@' + Math.round(hit.getBoundingClientRect().x) + ',' + Math.round(hit.getBoundingClientRect().y) : null;
            })
            .filter(Boolean)
        )
        .catch(() => []);
      const pagesDump = page.context().pages().map((p) => p.url().slice(0, 70));
      console.log('[worker] continue dbg:', JSON.stringify({ contClicked, url: page.url().slice(0, 90), pages: pagesDump, ctas }));
      await page.screenshot({ path: '.tmp-test/continue-fail.png' }).catch(() => {});
      throw attemptFail('CHECKOUT_FAIL', 'Payments page nahi khula (Continue fail?)');
    }
    // COD option payment page pe async aata hai — settle hone tak poll (~12s).
    // COD DYNAMIC hai (kisi account pe aata hai, kisi nahi) — missing ye
    // attempt skip karta hai, flow CONTINUE: baaki attempts (admin ke A tries)
    // aur baaki accounts chalte rahenge. Har account ka A rows = A tries.
    const cod = page.getByText(CHECKOUT.codText, { exact: false }).first();
    const codDeadline = Date.now() + 12000;
    let codFound = !!(await cod.count().catch(() => 0));
    while (!codFound && Date.now() < codDeadline) {
      await page.waitForTimeout(1000);
      codFound = !!(await cod.count().catch(() => 0));
    }
    if (!codFound) {
      await page.screenshot({ path: '.tmp-test/cod-missing.png' }).catch(() => {});
      const e = attemptFail(
        'COD_MISSING',
        `COD option nahi dikha (attempt ${ctx.attempt_no || 1}/${bk.attempts_per_acc || '?'}) — ye attempt skip, baaki attempts chalte rahenge`
      );
      e.noRetry = true; // row = ek attempt exactly (job dobara same row run na kare)
      throw e;
    }
    await cod.click({ timeout: 8000 }).catch(() => jsClick(page, 'cash on delivery'));
    await page.waitForTimeout(1200);

    // 7. captcha (agar dikhe) — manual pending queue ya diya hua text
    step('captcha');
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

    // 8. Place Order — dry run me sirf tak ruk jao
    step('place');
    const placeBtn = page.getByRole('button', { name: CHECKOUT.placeOrderBtn }).or(
      page.getByRole('button', { name: /place order/i })
    );
    let placeVisible = await placeBtn
      .first()
      .waitFor({ state: 'visible', timeout: 12000 })
      .then(() => true)
      .catch(() => false);
    if (!placeVisible) {
      // RN-web: button role missing — leaf text se dhundho
      placeVisible = await page
        .waitForFunction(
          () =>
            [...document.querySelectorAll('button,div,span,a')].some(
              (e) =>
                e.offsetParent &&
                /^(place order|pay)$/i.test((e.innerText || '').replace(/\s+/g, ' ').trim())
            ),
          null,
          { timeout: 12000 }
        )
        .then(() => true)
        .catch(() => false);
    }
    if (!placeVisible) {
      throw attemptFail('PLACE_MISSING', 'Place Order button nahi mila (page layout badla?)');
    }
    if (dryRun) {
      // step('place') ko pollers (e2e/UI SSE) ko dikhne ka time do
      await sleep(1600);
      db.prepare(
        `UPDATE orders SET captcha_state = 'solved', order_ref = 'DRY-RUN', error = NULL, updated_at = ? WHERE id = ?`
      ).run(now(), orderId);
      step('done');
      refreshBooking(ctx.bid);
      console.log(`[worker] order DRY-RUN ok — order=${orderId} (Place Order click nahi hua)`);
      sendEvent('order_placed', { orderId, bookingId: ctx.bid, dryRun: true });
      return;
    }

    if (await placeBtn.count().catch(() => 0)) {
      await placeBtn.first().click({ timeout: 10000 });
    } else {
      const done = await jsClick(page, '^place order$');
      if (!done) throw attemptFail('PLACE_CLICK_FAIL', 'Place Order click nahi hua');
    }
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

    // success → booked_until (default 3 din / delivery tak)
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
    step('done');
    sendEvent('order_placed', { orderId, bookingId: ctx.bid, accountId: acc.id, orderRef });
    console.log(`[worker] ORDER PLACED — order=${orderId} ref=${orderRef} account=${acc.id}`);
  };

  try {
    // Fix-pairing — attempt ke liye US ACCOUNT ka fix invalid number claim
    // (busy pe kabhi nahi milta, idempotent). Try-andar = koi bhi fail path
    // ho finally release karega; captcha pending me busy rehta hai.
    const claim = claimForAccount(orderId, acc.id);
    if (!claim.ok) {
      throw attemptFail(
        claim.reason === 'unpaired' ? 'NO_INVALID_NUMBER' : 'NUMBER_BUSY',
        claim.reason === 'unpaired'
          ? `Account se invalid number connect nahi — Settings → Import Invalid Num karo`
          : 'Account ka fix number abhi kisi doosre order me hai'
      );
    }
    const claimedNum = claim.number;
    console.log(`[worker] num claim order=${orderId} acc=${acc.id} → ${claimedNum}`);
    address.phone = claimedNum; // form-fill + inline verify dono ab yahi number dekhenge
    // Live status — pehle se hi dikhao ki attempt login/session stage pe hai
    step('login');
    // Pre-flight: logged-out/stub session se GUEST cart chalta hai jahan
    // address sheet aur checkout alag hote hain (fail hota hai) — pehle login.
    const loggedIn = await isLoggedIn(page).catch(() => true); // network err → age badho
    if (!loggedIn) {
      console.log(`[worker] session expired → auto-relogin (order=${orderId} account=${acc.id})`);
      await autoRelogin(page, pageCtx, acc);
    }
    try {
      await runAttempt();
    } catch (e) {
      if (!e?.wall) throw e;
      // login wall → ek baar auto-relogin (OTP inbox) → pura attempt dobara
      console.log(
        `[worker] login wall → auto-relogin (order=${orderId} account=${acc.id})`
      );
      step('login');
      await autoRelogin(page, pageCtx, acc);
      await runAttempt();
    }
  } catch (e) {
    if (e?.wall || e?.code === 'OTP_UNAVAILABLE') {
      const t = now();
      db.prepare(
        `UPDATE accounts SET status = 'expired', last_error = ?, updated_at = ? WHERE id = ?`
      ).run(String(e.message).slice(0, 500), t, acc.id);
      notifySessionExpired(acc.id, acc.label || null);
    }
    markError(e);
    const err =
      e instanceof LoginError
        ? e
        : new LoginError(`Order fail: ${e.message || e}`, e.status || 502);
    throw err;
  } finally {
    // Attempt khatam (success/fail) = number free; captcha pending = busy rehne do.
    const fin = db.prepare('SELECT captcha_state FROM orders WHERE id = ?').get(orderId);
    if (fin?.captcha_state !== 'pending') releaseNumber(orderId);
    await pageCtx.close().catch(() => {});
  }
});

export function startJobWorker(opts) {
  sweepStale(); // crash recovery — atak gaye busy numbers free
  return startWorker(opts);
}

export { registerHandler, enqueue, getJob, browserInfo, latestRequestId };
// test hooks — probes (.tmp-test/probe16-addnew.js) isko reuse karte hain
export { jsClick, addAddressViaSheet, selectCartAddress, sheetOpen };
