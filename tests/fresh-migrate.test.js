// Fresh DB pe migrate + schema completeness + guarded ALTER idempotency
import fs from 'node:fs';
import path from 'node:path';

const TMP = path.resolve('.tmp-test/fresh-migrate');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
process.env.KARTBULK_DATA_DIR = TMP;

const { migrate } = await import('../src/db/migrate.js');
const { getDb, closeDb } = await import('../src/db/index.js');

let pass = 0,
  fail = 0;
const ok = (cond, name) => {
  if (cond) {
    pass++;
    console.log(`  ✔ ${name}`);
  } else {
    fail++;
    console.log(`  ✖ ${name}`);
  }
};

// 1. fresh migrate
const r = migrate();
ok(r.ok, 'fresh migrate runs');

// 2. all tables exist
const db = getDb();
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
  .all()
  .map((t) => t.name);
for (const t of ['accounts', 'products', 'orders', 'sections', 'addresses', 'bookings', 'jobs', 'settings', 'sessions', 'scan_jobs', 'scan_results', 'commission_events']) {
  ok(tables.includes(t), `table ${t}`);
}

// 3. new columns present
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
ok(cols('accounts').includes('section_id'), 'accounts.section_id');
ok(cols('accounts').includes('booked_until'), 'accounts.booked_until');
ok(cols('products').includes('platform'), 'products.platform');
ok(cols('products').includes('affiliate_url'), 'products.affiliate_url');
ok(cols('orders').includes('booking_id'), 'orders.booking_id');
ok(cols('orders').includes('address_id'), 'orders.address_id');
ok(cols('orders').includes('price'), 'orders.price');
ok(cols('orders').includes('captcha_state'), 'orders.captcha_state');

// 4. guarded ALTER idempotency — dobara migrate chalao (columns already there → skip, no throw)
const r2 = migrate();
ok(r2.ok, 'second migrate idempotent (no duplicate column error)');

// 5. bookings constraints
const bCols = cols('bookings');
for (const c of ['status', 'qty_mode', 'total_amount', 'progress', 'affiliate_url', 'address_id']) {
  ok(bCols.includes(c), `bookings.${c}`);
}

// 6. sections FK behavior — account assign + section delete → NULL
db.prepare(
  `INSERT INTO sections (id, name, created_at) VALUES (99, 'T', ?)`
).run(Date.now());
db.prepare(
  `INSERT INTO accounts (identifier, status, section_id, created_at, updated_at) VALUES ('9990001112', 'active', 99, ?, ?)`
).run(Date.now(), Date.now());
db.prepare(`DELETE FROM sections WHERE id = 99`).run();
const acc = db.prepare(`SELECT section_id FROM accounts WHERE identifier='9990001112'`).get();
ok(acc.section_id === null, 'section delete → account.section_id NULL (FK)');

// 7. booked filter query (Accounts API wala) chalta hai
const booked = db
  .prepare(`SELECT COUNT(*) n FROM accounts WHERE booked_until IS NOT NULL AND booked_until > ?`)
  .get(Date.now()).n;
ok(typeof booked === 'number', 'booked filter query works');

closeDb();
console.log(`\nfresh-migrate: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
