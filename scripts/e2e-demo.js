#!/usr/bin/env node
// E2E (new ordering model): API-driven, server up hona chahiye (npm run start).
// CASE-A: max_price=1 → har attempt PRICE_OUT_OF_RANGE (fast fail gate).
// CASE-B: N=2 × A=2, Q=2 → 4 attempt rows → 4 × DRY-RUN (CHECKOUT_DRY_RUN=true).
// Env: E2E_PIN (default 4747), E2E_PRODUCT_ID, E2E_ADDRESS_ID, BASE_URL.
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PIN = process.env.E2E_PIN || '4747';

let token = '';
async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'x-auth-token': token } : {}),
      ...(opts.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !opts.allowFail) {
    const msg = body?.error?.message || `${res.status} ${path}`;
    throw new Error(msg);
  }
  return { status: res.status, body };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
let pass = 0,
  fail = 0;
const ok = (cond, name, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`  ✖ ${name} ${extra}`);
  }
};

// login
const login = await api('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ pin: PIN }),
  allowFail: true,
});
token = login.body?.token;
if (!token) {
  console.error('LOGIN FAIL:', login.status, JSON.stringify(login.body));
  process.exit(1);
}
log('login ok');

// refs — product + address (env override)
let productId = Number(process.env.E2E_PRODUCT_ID) || 0;
let addressId = Number(process.env.E2E_ADDRESS_ID) || 0;
if (!productId) {
  const ps = await api('/api/products');
  productId = ps.body.items?.[0]?.id || 0;
}
if (!addressId) {
  const ad = await api('/api/addresses');
  addressId = ad.body.items?.find((a) => a.is_default)?.id || ad.body.items?.[0]?.id || 0;
}
if (!productId || !addressId) {
  console.error(`REFS MISSING: product=${productId} address=${addressId} (pehle fetch + address add karo)`);
  process.exit(1);
}
log(`product=${productId} address=${addressId}`);

async function createBooking(body) {
  const c = await api('/api/bookings', { method: 'POST', body: JSON.stringify(body) });
  if (c.status !== 201) throw new Error(`create ${c.status}: ${JSON.stringify(c.body)}`);
  return c.body;
}

async function pollBooking(bid, minutes) {
  const deadline = Date.now() + minutes * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    await sleep(2500);
    const d = await api(`/api/bookings/${bid}`);
    if (d.status !== 200) continue;
    const o = d.body.orders?.[0] || {};
    const cur = `progress=${d.body.progress}/${d.body.total} step=${o.step || '-'} state=${o.captcha_state} err=${(o.error || '-').slice(0, 70)}`;
    if (cur !== last) {
      log(`booking=${bid} ${d.body.status} | ${cur}`);
      last = cur;
    }
    if (['done', 'failed', 'cancelled'].includes(d.body.status)) return d.body;
  }
  const d = await api(`/api/bookings/${bid}`);
  return d.body;
}

// ── CASE-A: max_price gate ──
console.log('\n== CASE-A: max_price=1 → PRICE_OUT_OF_RANGE ==');
try {
  const a = await createBooking({
    product_id: productId,
    address_id: addressId,
    n_accounts: 1,
    qty_per_cart: 1,
    attempts_per_acc: 1,
    max_price: 1,
  });
  log(`booking=${a.id} status=${a.status}`);
  const fin = await pollBooking(a.id, 8);
  const err = fin.orders?.[0]?.error || '';
  ok(fin.status === 'failed', 'booking failed', `status=${fin.status}`);
  ok(err.startsWith('PRICE_OUT_OF_RANGE'), 'error PRICE_OUT_OF_RANGE', err.slice(0, 90));
} catch (e) {
  ok(false, 'CASE-A ran', e.message);
}

// ── CASE-B: N=2 × A=2, Q=2 → 4 × DRY-RUN ──
console.log('\n== CASE-B: N=2 A=2 Q=2 → 4 × DRY-RUN ==');
try {
  const b = await createBooking({
    product_id: productId,
    address_id: addressId,
    n_accounts: 2,
    qty_per_cart: 2,
    attempts_per_acc: 2,
    max_price: 100000,
  });
  log(`booking=${b.id} status=${b.status} orders=${b.orders?.length}`);
  ok(b.status === 'running' && b.orders?.length === 4, '4 attempt rows enqueued', `orders=${b.orders?.length}`);
  const fin = await pollBooking(b.id, 15);
  ok(fin.status === 'done', 'booking done', `status=${fin.status}`);
  const placed = (fin.orders || []).filter((o) => o.captcha_state === 'placed');
  ok(placed.length === 4, '4/4 orders placed', `${placed.length}/${fin.orders?.length}`);
  const dry = placed.filter((o) => o.order_ref === 'DRY-RUN');
  ok(
    dry.length === placed.length,
    'all refs DRY-RUN (CHECKOUT_DRY_RUN=true)',
    `dry=${dry.length}/${placed.length}`
  );
} catch (e) {
  ok(false, 'CASE-B ran', e.message);
}

console.log(`\n======== E2E: ${pass} pass, ${fail} fail ========`);
process.exit(fail ? 1 : 0);
