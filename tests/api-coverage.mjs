// Full API coverage — live server (PORT 3001). Happy paths + error paths.
const BASE = process.env.BASE_URL || 'http://localhost:3001';

let token = '';
let pass = 0,
  fail = 0;

async function H(m, p, b, q) {
  const res = await fetch(`${BASE}/api${p}${q ? `?${q}` : ''}`, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'x-auth-token': token } : {}) },
    body: b ? JSON.stringify(b) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { s: res.status, d: data };
}
const ok = (cond, name, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    fail++;
    console.log(`  ✖ ${name} ${extra}`);
  }
};

// ── AUTH ──
console.log('\n== auth ==');
let r = await H('POST', '/auth/login', { pin: '0000' });
ok(r.s === 400 || r.s === 401, 'wrong PIN rejected', `status=${r.s}`);
r = await H('POST', '/auth/login', { pin: '4747' });
token = r.d?.token;
ok(r.s === 200 && !!token, 'login 4747 → token');

r = await H('GET', '/stats');
ok(r.s === 200, 'stats authed');

// no token → 401
const noTok = await fetch(`${BASE}/api/accounts`);
ok(noTok.status === 401, 'no token → 401', `got ${noTok.status}`);

// public health
const pub = await fetch(`${BASE}/api/health`);
const pubJ = await pub.json().catch(() => ({}));
ok(pub.status === 200 && (pubJ.ok ?? pubJ.status), 'public /api/health 200');

// ── SECTIONS ──
console.log('\n== sections ==');
r = await H('POST', '/sections', { name: 'T-Alpha' });
const secId = r.d?.id;
ok(r.s === 201, 'create section', `id=${secId}`);
r = await H('POST', '/sections', { name: 'T-Alpha' });
ok(r.s === 409, 'duplicate → 409');
r = await H('POST', '/sections', { name: '' });
ok(r.s === 400, 'empty name → 400');
r = await H('GET', '/sections');
ok(r.s === 200 && Array.isArray(r.d.items), 'list sections');
r = await H('DELETE', `/sections/${secId}`);
ok(r.s === 200, 'delete section');
r = await H('DELETE', `/sections/${secId}`);
ok(r.s === 404, 'delete again → 404');

// ── ADDRESSES ──
console.log('\n== addresses ==');
r = await H('POST', '/addresses', { name: '', phone: '', pincode: '', line1: '', city: '' });
ok(r.s === 400, 'empty address → 400');
r = await H('POST', '/addresses', {
  name: 'T User', phone: '9811122233', pincode: '411001',
  line1: '5 Test Lane', city: 'Pune', state: 'MH', is_default: true,
});
const addrId = r.d?.id;
ok(r.s === 201 && r.d.is_default === true, 'create address (default)', `id=${addrId}`);
r = await H('POST', '/addresses', {
  name: 'T2', phone: '9811122244', pincode: '11', line1: 'x', city: 'Delhi',
});
ok(r.s === 400, 'bad pincode → 400');
r = await H('POST', '/addresses', {
  name: 'T3', phone: '981', pincode: '110001', line1: 'x', city: 'Delhi',
});
ok(r.s === 400, 'bad phone → 400');
r = await H('POST', '/addresses', {
  name: 'T Second', phone: '9811122255', pincode: '110001',
  line1: '9 Other St', city: 'Delhi', is_default: true,
});
const addr2 = r.d?.id;
ok(r.s === 201, 'second address');
r = await H('GET', '/addresses');
const defaults = r.d.items.filter((a) => a.is_default);
ok(defaults.length === 1 && defaults[0].id === addr2, 'single default enforced');
r = await H('PUT', `/addresses/${addrId}`, { name: 'T User2', phone: '9811122233', pincode: '411001', line1: '5B', city: 'Pune' });
ok(r.s === 200 && r.d.name === 'T User2', 'update address');
r = await H('DELETE', `/addresses/${addr2}`);
ok(r.s === 200, 'delete address');
r = await H('DELETE', `/addresses/99999`);
ok(r.s === 404, 'delete missing → 404');

// ── ACCOUNTS ──
console.log('\n== accounts + import ==');
const RUN = String(Date.now()).slice(-6); // unique per run (idempotent)
const ph = (n) => `97${RUN.slice(0, 3)}${String(n).padStart(5, '0')}`; // 10-digit phone
r = await H('GET', '/accounts?limit=200');
r = await H('POST', '/accounts/bulk', {
  items: [
    { phone: `+91 ${ph(1).slice(0, 5)} ${ph(1).slice(5)}`, label: 'API-1' },
    { mobile: ph(2), username: 'API-2' },
    { email: `api${RUN}@mail.com` },
    ph(3),
    ph(1), // dup of first (normalized)
    'garbage', // invalid
    { phone_number: ph(4) },
    { number: ph(5) },
  ],
});
ok(r.s === 200 && r.d.created === 6 && r.d.skipped === 2, 'flexible import 6/2', JSON.stringify(r.d));

// fresh DB me id1 nahi hota — ek real account id lo (assign/release tests ke liye)
r = await H('GET', '/accounts?limit=1');
const accId = r.d.items?.[0]?.id;
ok(!!accId, 'real account id for assign tests', `id=${accId}`);

r = await H('POST', '/accounts', { identifier: 'not-valid' });
ok(r.s === 400, 'bad identifier → 400');
r = await H('POST', '/accounts', { identifier: ph(3) });
ok(r.s === 409 && r.d.error?.accountId, 'duplicate → 409 + accountId');

r = await H('POST', '/accounts/assign-section', { ids: [], section_id: null });
ok(r.s === 400, 'assign empty ids → 400');
r = await H('POST', '/accounts/assign-section', { ids: [accId], section_id: 9999 });
ok(r.s === 404, 'assign bad section → 404');

// section for assign (unique name — rerun safe)
r = await H('POST', '/sections', { name: `T-Beta-${RUN}` });
const sec2 = r.d.id;
ok(r.s === 201 && sec2, 'create section sec2', `id=${sec2}`);
r = await H('POST', '/accounts/assign-section', { ids: [accId], section_id: sec2 });
ok(r.s === 200 && r.d.updated === 1, 'assign section ok');
r = await H('GET', `/accounts`, null, `section_id=${sec2}`);
ok(r.s === 200 && r.d.items.length >= 1, 'section filter list');

r = await H('POST', `/accounts/${accId}/release`);
ok(r.s === 200, 'release booked flag');
r = await H('POST', '/accounts/99999/release');
ok(r.s === 404, 'release missing → 404');

r = await H('GET', '/accounts?status=booked');
ok(r.s === 200 && Array.isArray(r.d.items), 'status=booked filter');
r = await H('GET', '/accounts?status=bogus');
ok(r.s === 200, 'unknown status → no crash');

// health batch
r = await H('POST', '/accounts/health', { ids: [] });
ok(r.s === 200 && typeof r.d.queued === 'number', 'health batch queued');

// ── PRODUCTS ──
console.log('\n== products ==');
r = await H('POST', '/products/fetch', { url: 'https://evil.com/x' });
ok(r.s === 422, 'evil url → 422 (resolve fail, honest)');
r = await H('POST', '/products/fetch', { url: 'not a url' });
ok(r.s === 400, 'garbage url → 400');
r = await H('GET', '/products');
ok(r.s === 200 && Array.isArray(r.d.items), 'list products');

// ── BOOKINGS ──
console.log('\n== bookings (quote engine) ==');
// seed: section with 2 active accounts + product (reuse earlier seeds)
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync('data/app.db');
db.prepare(`UPDATE accounts SET status='active', section_id=?, booked_until=NULL WHERE id IN (SELECT id FROM accounts WHERE status='active' LIMIT 2)`).run(sec2);
let prod = db.prepare('SELECT id FROM products LIMIT 1').get();
if (!prod) {
  db.prepare(
    `INSERT INTO products (url, platform, pid, title, price, mrp, in_stock, cod_product, fetched_at) VALUES ('https://www.flipkart.com/t/p/itmT', 'flipkart', 'itmT', 'API Test Prod', 500, 600, 1, 1, ?)`
  ).run(Date.now());
  prod = db.prepare('SELECT id FROM products LIMIT 1').get();
}
const activeInSec = db.prepare(`SELECT COUNT(*) n FROM accounts WHERE section_id=? AND status='active'`).get(sec2).n;
db.close();
console.log(`  (active in section: ${activeInSec})`);

r = await H('POST', '/bookings', { product_id: 99999, section_id: sec2, address_id: addrId, qty: 1 });
ok(r.s === 404, 'booking bad product → 404');
r = await H('POST', '/bookings', { product_id: prod.id, section_id: 99999, address_id: addrId, qty: 1 });
ok(r.s === 404, 'booking bad section → 404');
r = await H('POST', '/bookings', { product_id: prod.id, section_id: sec2, address_id: 99999, qty: 1 });
ok(r.s === 404, 'booking bad address → 404');
r = await H('POST', '/bookings', { product_id: prod.id, section_id: sec2, address_id: addrId, qty: 99, qty_mode: 'total' });
ok(r.s === 409 && r.d.error?.available != null, 'insufficient → 409 + available', JSON.stringify(r.d.error));

const q1 = await H('POST', '/bookings', {
  product_id: prod.id, section_id: sec2, address_id: addrId,
  qty: activeInSec, qty_mode: 'total',
});
ok(q1.s === 201 && q1.d.status === 'quoting' && q1.d.orders?.length === activeInSec, 'quote created', `id=${q1.d.id} orders=${q1.d.orders?.length}`);
const bid = q1.d.id;

r = await H('GET', `/bookings/${bid}`);
ok(r.s === 200 && r.d.orders.length === activeInSec, 'booking detail + orders');
const someOrderId = r.d.orders?.[0]?.id;

r = await H('POST', `/bookings/${bid}/confirm`);
ok(r.s === 409, 'confirm while quoting → 409');

// wait for price_check jobs (session/block → honest error; slow browser path ke liye poll)
let st = 'quoting';
for (let i = 0; i < 30 && st === 'quoting'; i++) {
  await new Promise((res) => setTimeout(res, 3000));
  r = await H('GET', `/bookings/${bid}`);
  st = r.d.status;
}
const allErrored = r.d.orders.every((o) => o.error);
ok(st === 'failed' || st === 'quoted', 'quote jobs finished', `status=${st}`);
ok(allErrored || r.d.orders.some((o) => o.price != null), 'every order priced or honest error');
if (st === 'quoted') {
  const c = await H('POST', `/bookings/${bid}/confirm`);
  ok(c.s === 200 && c.d.status === 'running', 'confirm quoted → running');
}
r = await H('POST', `/bookings/${bid}/cancel`);
ok([200, 409].includes(r.s), 'cancel (state-dependent)', `status=${r.s}`);
r = await H('GET', `/bookings/99999`);
ok(r.s === 404, 'booking missing → 404');

// per_account mode
const q2 = await H('POST', '/bookings', {
  product_id: prod.id, section_id: sec2, address_id: addrId,
  qty: 1, qty_mode: 'per_account', per_acc_qty: 2,
});
ok(q2.s === 201 && q2.d.orders?.length === activeInSec * 2, 'per_account mode = accounts×qty', `orders=${q2.d.orders?.length}`);
if (q2.s === 201) await H('POST', `/bookings/${q2.d.id}/cancel`);

// ── ORDERS ──
console.log('\n== orders ==');
r = await H('GET', '/orders?state=pending');
ok(r.s === 200 && Array.isArray(r.d.items), 'orders pending list');
r = await H('GET', '/orders?state=all');
ok(r.s === 200, 'orders all');
r = await H('POST', '/orders/99999/captcha', { text: 'AB12' });
ok(r.s === 404, 'captcha missing order → 404');
r = await H('POST', `/orders/${someOrderId ?? 1}/captcha`, { text: 'AB' });
ok(r.s === 400 || r.s === 409, 'captcha short/wrong-state', `status=${r.s}`);
r = await H('POST', '/orders/99999/retry');
ok(r.s === 404, 'retry missing → 404');
r = await H('POST', '/orders/1/retry');
ok(r.s === 409 || r.s === 404, 'retry invalid state/no price', `status=${r.s}`);

// ── STREAM (SSE headers) ──
console.log('\n== stream ==');
const sse = await fetch(`${BASE}/api/stream?token=${encodeURIComponent(token)}`, {
  headers: { Accept: 'text/event-stream' },
});
ok(sse.status === 200 && (sse.headers.get('content-type') || '').includes('text/event-stream'), 'SSE stream 200 + event-stream');
// cancel body read
await sse.body?.cancel().catch(() => {});

console.log(`\n======== API COVERAGE: ${pass} pass, ${fail} fail ========`);
process.exit(fail ? 1 : 0);
