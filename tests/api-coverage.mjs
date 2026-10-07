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

// ── NUMBERS (Import Invalid Num pool — fix pairing) ──
console.log('\n== numbers (import invalid num) ==');
r = await H('GET', '/numbers');
ok(
  r.s === 200 && Array.isArray(r.d.items) && typeof r.d.free === 'number' && typeof r.d.paired === 'number',
  'list numbers (items/free/busy/paired/total)'
);
r = await H('POST', '/numbers/import', { text: '' });
ok(r.s === 400, 'empty import → 400');
r = await H('POST', '/numbers/import', { text: 'not-a-number\nxx yy' });
ok(r.s === 400, 'sirf garbage → 400');

// fresh unique numbers (har run me naye — pehle se exist kar rahe to imported=0 na ho)
const uNums = String(Date.now()).slice(-6);
const uA = `66${uNums}01`;
const uB = `66${uNums}02`;
const uC = `91${uNums}03`;
const coverageNums = [uA, uB, uC]; // cleanup ke liye track (end me delete)
r = await H('POST', '/numbers/import', {
  text: `${uA}\n${uB}\n${uB}\njunk line\n${uC}`,
});
ok(
  r.s === 201 && r.d.imported === 3 && r.d.skipped_dupes === 1 && r.d.invalid_lines === 1,
  'import: dedup + garbage count',
  JSON.stringify(r.d)
);
ok((r.d.paired || 0) >= 1, 'import pe auto-pair (connect) chala', `paired=${r.d.paired}`);
r = await H('POST', '/numbers/import', { text: `${uA}\n${uB}` });
ok(r.s === 400 && r.d.imported === undefined, 're-import pe sab dup → 400 (kuch importa nahi hua)');

// SAARE paired numbers ko claim karke busy karo (non-destructive — baad me release)
r = await H('GET', '/numbers');
const pairedRows = r.d.items.filter((n) => n.account_id);
const claimedForTest = [];
let firstClaimed = '';
for (let i = 0; i < pairedRows.length; i++) {
  const oid = 771000 + i;
  const c = await H('POST', '/numbers/claim', { order_id: oid, account_id: pairedRows[i].account_id });
  if (c.s !== 200 || !c.d.number) break;
  claimedForTest.push(oid);
  if (!firstClaimed) firstClaimed = c.d.number;
}
ok(claimedForTest.length >= 1, 'claim loop → paired sab busy', `claimed=${claimedForTest.length}`);

r = await H('GET', '/numbers');
ok(
  r.d.busy >= 1 && r.d.free === r.d.total - r.d.busy,
  'state: paired busy, free = total - busy',
  `free=${r.d.free} busy=${r.d.busy}`
);

// sab accounts missing (paired busy + baki unpaired) → booking Start turant 409
const { DatabaseSync: DS } = await import('node:sqlite');
const db0 = new DS('data/app.db');
let p0 = db0.prepare('SELECT id FROM products LIMIT 1').get();
if (!p0) {
  db0
    .prepare(
      `INSERT INTO products (url, platform, pid, title, price, mrp, in_stock, cod_product, fetched_at)
       VALUES ('https://www.flipkart.com/t/p/itmN', 'flipkart', 'itmN', 'Num Test Prod', 500, 600, 1, 1, ?)`
    )
    .run(Date.now());
  p0 = db0.prepare('SELECT id FROM products LIMIT 1').get();
}
let a0 = db0.prepare('SELECT id FROM addresses LIMIT 1').get();
if (!a0) {
  db0
    .prepare(
      `INSERT INTO addresses (name, pincode, line1, city, is_default, created_at)
       VALUES ('Test Addr', '411001', '12 MG Road', 'Pune', 1, ?)`
    )
    .run(Date.now());
  a0 = db0.prepare('SELECT id FROM addresses LIMIT 1').get();
}
db0.close();
r = await H('POST', '/bookings', { product_id: p0.id, address_id: a0.id, n_accounts: 1 });
ok(
  r.s === 409 && r.d.error?.code === 'no_invalid_number',
  'sab missing pairs → Start pe hi 409 no_invalid_number',
  JSON.stringify(r.d.error)
);

// idempotent claim (wahi order wahi number)
if (claimedForTest.length) {
  const again = await H('POST', '/numbers/claim', {
    order_id: claimedForTest[0],
    account_id: pairedRows[0].account_id,
  });
  ok(again.s === 200 && again.d.number === firstClaimed, 'claim idempotent (same order = same number)');
}

// bina-pair account claim → 409 no_invalid_number
{
  const g = await H('GET', '/numbers');
  if (g.d.items.some((n) => !n.account_id)) {
    const c = await H('POST', '/numbers/claim', { order_id: 771400, account_id: 99999999 });
    ok(
      c.s === 409 && c.d.error?.code === 'no_invalid_number',
      'bina-pair account claim → 409',
      JSON.stringify(c.d.error)
    );
  } else {
    ok(true, 'bina-pair account claim → skip (sab paired)');
  }
}

// busy delete → 409, phir sab release
r = await H('GET', '/numbers');
const busyRow = r.d.items.find((n) => n.status === 'busy');
if (busyRow) {
  r = await H('DELETE', `/numbers/${busyRow.id}`);
  ok(r.s === 409, 'busy delete → 409', `status=${r.s}`);
}
for (const oid of claimedForTest) {
  const rel = await H('POST', '/numbers/release', { order_id: oid });
  ok(rel.s === 200 && rel.d.released === true, `release ${oid}`);
}
r = await H('POST', '/numbers/release', { order_id: 999999999 });
ok(r.s === 200 && r.d.released === false, 'unknown release → released=false');
r = await H('GET', '/numbers');
ok(
  r.d.total >= 3 && r.d.free + r.d.busy === r.d.total && r.d.busy === 0,
  'pool intact after test',
  `free=${r.d.free} busy=${r.d.busy}`
);

// ── BOOKINGS ──
console.log('\n== bookings (N accounts × A attempts model) ==');
// seed: section with active accounts + product (reuse earlier seeds)
const { DatabaseSync } = await import('node:sqlite');
const db = new DatabaseSync('data/app.db');
// test debris: purani running bookings eligible accounts ko busy rakhti hain
// (real-e2e runs chhode hue) → cancel taaki N accounts free milein.
db.prepare(
  `UPDATE bookings SET status='cancelled', updated_at=? WHERE status IN ('running','quoting','quoted')`
).run(Date.now());
db.prepare(`UPDATE accounts SET status='active', section_id=?, booked_until=NULL WHERE id IN (SELECT id FROM accounts WHERE status='active' LIMIT 2)`).run(sec2);
let prod = db.prepare('SELECT id FROM products LIMIT 1').get();
if (!prod) {
  db.prepare(
    `INSERT INTO products (url, platform, pid, title, price, mrp, in_stock, cod_product, fetched_at) VALUES ('https://www.flipkart.com/t/p/itmT', 'flipkart', 'itmT', 'API Test Prod', 500, 600, 1, 1, ?)`
  ).run(Date.now());
  prod = db.prepare('SELECT id FROM products LIMIT 1').get();
}
// COD gate seed: COD nahi wala product (order blocked chahiye)
let nonCod = db
  .prepare(`SELECT id FROM products WHERE cod_product = 0 LIMIT 1`)
  .get();
if (!nonCod) {
  db.prepare(
    `INSERT INTO products (url, platform, pid, title, price, mrp, in_stock, cod_product, fetched_at) VALUES ('https://www.flipkart.com/t/p/itmNC', 'flipkart', 'itmNC', 'Non COD Test Prod', 300, 350, 1, 0, ?)`
  ).run(Date.now());
  nonCod = db.prepare(`SELECT id FROM products WHERE cod_product = 0 LIMIT 1`).get();
}
const activeInSec = db.prepare(`SELECT COUNT(*) n FROM accounts WHERE section_id=? AND status='active'`).get(sec2).n;
// pairing top-up: HAR account ke paas free pair ho (bookings block deterministic)
const acctot = db.prepare('SELECT COUNT(*) n FROM accounts').get().n;
db.close();
console.log(`  (active in section: ${activeInSec})`);
{
  const nl = await H('GET', '/numbers');
  if (nl.d.total < acctot) {
    const need = acctot - nl.d.total;
    const top = [];
    for (let i = 0; i < need; i++) top.push(`67${uNums}${String(i).padStart(4, '0')}`);
    const imp = await H('POST', '/numbers/import', { text: top.join('\n') });
    if (imp.s === 201) coverageNums.push(...top);
    console.log(`  (pairing top-up: +${imp.d?.imported ?? 0} numbers)`);
  }
}

r = await H('POST', '/bookings', { product_id: 99999, section_id: sec2, address_id: addrId, n_accounts: 1 });
ok(r.s === 404, 'booking bad product → 404');
r = await H('POST', '/bookings', { product_id: prod.id, section_id: 99999, address_id: addrId, n_accounts: 1 });
ok(r.s === 404, 'booking bad section → 404');
r = await H('POST', '/bookings', { product_id: prod.id, section_id: sec2, address_id: 99999, n_accounts: 1 });
ok(r.s === 404, 'booking bad address → 404');
// COD gate — COD nahi wale product pe Start blocked
r = await H('POST', '/bookings', { product_id: nonCod.id, section_id: sec2, address_id: addrId, n_accounts: 1 });
ok(
  r.s === 409 && r.d.error?.code === 'cod_unavailable',
  'COD nahi → 409 cod_unavailable (order block)',
  JSON.stringify(r.d.error)
);
r = await H('POST', '/bookings', { product_id: prod.id, section_id: sec2, address_id: addrId, n_accounts: 99 });
ok(r.s === 409 && r.d.error?.available != null, 'insufficient → 409 + available', JSON.stringify(r.d.error));
r = await H('POST', '/bookings', { product_id: prod.id, section_id: sec2, address_id: addrId, n_accounts: 1, max_price: 'abc' });
ok(r.s === 400, 'bad max_price → 400');

// N = active in section, A = 2 → running booking with N×2 attempt rows
const A1 = 2;
const q1 = await H('POST', '/bookings', {
  product_id: prod.id, section_id: sec2, address_id: addrId,
  n_accounts: activeInSec, qty_per_cart: 1, attempts_per_acc: A1, max_price: 1000,
});
ok(
  q1.s === 201 && q1.d.status === 'running' && q1.d.orders?.length === activeInSec * A1,
  'booking created running (N×A rows)',
  `id=${q1.d.id} orders=${q1.d.orders?.length} status=${q1.d.status}`
);
const bid = q1.d?.id;

r = await H('GET', `/bookings/${bid}`);
ok(
  r.s === 200 && r.d.orders.length === activeInSec * A1 && r.d.max_price === 1000,
  'booking detail + orders + max_price',
  `orders=${r.d.orders?.length}`
);
ok(r.d.orders?.every((o) => o.attempt_no >= 1 && o.attempt_no <= A1), 'attempt_no 1..A present');
const someOrderId = r.d.orders?.[0]?.id;

r = await H('POST', `/bookings/${bid}/confirm`);
ok(r.s === 409, 'confirm while running → 409 (2-phase nahi)');

// q1 ke accounts running booking me hain → naye booking ke liye insufficient
r = await H('POST', '/bookings', { product_id: prod.id, section_id: sec2, address_id: addrId, n_accounts: activeInSec });
ok(r.s === 409 && r.d.error?.available === 0, 'busy accounts → insufficient (available=0)', JSON.stringify(r.d.error));

r = await H('POST', `/bookings/${bid}/cancel`);
ok(r.s === 200 && r.d.status === 'cancelled', 'cancel running → cancelled');

// N=1, A=3, Q=2 → 3 rows, har row qty=2; attempt_no 1..3
const q2 = await H('POST', '/bookings', {
  product_id: prod.id, section_id: sec2, address_id: addrId,
  n_accounts: 1, qty_per_cart: 2, attempts_per_acc: 3,
});
ok(
  q2.s === 201 && q2.d.orders?.length === 3 && q2.d.qty_per_cart === 2,
  'N=1 A=3 Q=2 → 3 rows',
  `orders=${q2.d.orders?.length}`
);
if (q2.s === 201) {
  ok(
    q2.d.orders.map((o) => o.attempt_no).join(',') === '1,2,3' && q2.d.orders.every((o) => o.qty === 2),
    'attempt_no 1,2,3 + qty=2 per row'
  );
  const c2 = await H('POST', `/bookings/${q2.d.id}/cancel`);
  ok(c2.s === 200, 'cancel q2');
}
r = await H('GET', `/bookings/99999`);
ok(r.s === 404, 'booking missing → 404');

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
ok(r.s === 409 || r.s === 404, 'retry invalid state', `status=${r.s}`);

// ── STREAM (SSE headers) ──
console.log('\n== stream ==');
const sse = await fetch(`${BASE}/api/stream?token=${encodeURIComponent(token)}`, {
  headers: { Accept: 'text/event-stream' },
});
ok(sse.status === 200 && (sse.headers.get('content-type') || '').includes('text/event-stream'), 'SSE stream 200 + event-stream');
// cancel body read
await sse.body?.cancel().catch(() => {});

// ── CLEANUP: coverage ke test numbers pool se hatao (user ke asli numbers safe) ──
{
  const nl = await H('GET', '/numbers');
  let removed = 0;
  for (const n of nl.d.items) {
    if (coverageNums.includes(n.number) && n.status === 'free') {
      const d = await H('DELETE', `/numbers/${n.id}`);
      if (d.s === 200) removed++;
    }
  }
  console.log(`  (cleanup: ${removed} test numbers removed from pool)`);
}

console.log(`\n======== API COVERAGE: ${pass} pass, ${fail} fail ========`);
process.exit(fail ? 1 : 0);
