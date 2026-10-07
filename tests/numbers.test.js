import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// isolated DB — import se pehle set hona zaroori hai
const TMP = path.resolve('.tmp-test/db-numbers');
fs.rmSync(TMP, { recursive: true, force: true });
process.env.KARTBULK_DATA_DIR = TMP;

const { migrate } = await import('../src/db/migrate.js');
const dbMod = await import('../src/db/index.js');
const pool = await import('../src/server/services/numberPool.js');

before(() => {
  migrate();
});

after(() => {
  dbMod.closeDb();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// Prod jaisi claim ke liye REAL order rows (sweep order state dekhta hai)
let pid = 0;
let bid = 0;
function mkOrder(state = 'auto') {
  const db = dbMod.getDb();
  const t = Date.now();
  if (!pid) {
    db.prepare(`INSERT INTO products (url, fetched_at) VALUES ('https://example.com/p', ?)`).run(t);
    pid = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
    db.prepare(
      `INSERT INTO bookings (product_id, qty, status, created_at, updated_at) VALUES (?, 1, 'running', ?, ?)`
    ).run(pid, t, t);
    bid = Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
  }
  db.prepare(
    `INSERT INTO orders (booking_id, qty, attempt_no, captcha_state, created_at, updated_at)
     VALUES (?, 1, 1, ?, ?, ?)`
  ).run(bid, state, t, t);
  return Number(db.prepare('SELECT last_insert_rowid() AS id').get().id);
}

function mkAccount(identifier) {
  const db = dbMod.getDb();
  const t = Date.now();
  const info = db
    .prepare(
      `INSERT INTO accounts (label, identifier, status, created_at, updated_at)
       VALUES (?, ?, 'active', ?, ?)`
    )
    .run(identifier, identifier, t, t);
  return Number(info.lastInsertRowid);
}

test('parse: plain lines, dup, garbage, comma/slash, 91-prefix', () => {
  const { numbers, invalid } = pool.parseImportText(
    ['6633991102', '6633991103', '6633991102', 'not a number', '916633991104', '6633991105/6633991106', ''].join('\n')
  );
  // parse raw deta hai (file ke andar ke dups samet) — dedup importNumbers karta hai
  assert.deepEqual(numbers, [
    '6633991102',
    '6633991103',
    '6633991102',
    '6633991104',
    '6633991105',
    '6633991106',
  ]);
  assert.deepEqual(invalid, ['not a number']);
});

test('import: dedup file+db, re-import = all skipped, pairing 0 (koi account nahi)', () => {
  const r1 = pool.importNumbers('6633991102\n6633991103\n6633991103\njunk line');
  assert.deepEqual(r1, { imported: 2, skipped_dupes: 1, invalid_lines: 1, paired: 0 });
  const r2 = pool.importNumbers('6633991102\n6633991199');
  assert.equal(r2.imported, 1);
  assert.equal(r2.skipped_dupes, 1);
  assert.equal(pool.countFree(), 3);
  assert.equal(pool.countBusy(), 0);
});

test('pairing: ensurePairs 1:1 connect, claim = account ka FIX number', () => {
  const acc1 = mkAccount('9000000001');
  const acc2 = mkAccount('9000000002');

  const paired = pool.ensurePairs();
  assert.equal(paired, 2, '2 accounts ↔ 2 numbers connect hue');
  assert.equal(pool.ensurePairs(), 0, 'dobara ensure = kuch nahi (already paired)');

  const db = dbMod.getDb();
  const n1 = db.prepare('SELECT number FROM number_pool WHERE account_id = ?').get(acc1).number;
  const n2 = db.prepare('SELECT number FROM number_pool WHERE account_id = ?').get(acc2).number;
  assert.ok(n1 && n2 && n1 !== n2, 'alag accounts ke alag fix numbers');

  const o1 = mkOrder();
  const claim1 = pool.claimForAccount(o1, acc1);
  assert.equal(claim1.ok, true);
  assert.equal(claim1.number, n1, 'order ko account ka FIX number mila');
  assert.equal(pool.countFree(), 2);

  // idempotent — same order wahi number
  assert.equal(pool.claimForAccount(o1, acc1).number, n1);

  // same account ka doosra order → busy (sweep retry ke baad bhi)
  const o2 = mkOrder();
  const dup = pool.claimForAccount(o2, acc1);
  assert.deepEqual(dup, { ok: false, reason: 'busy' });

  // bina-pair wala account → unpaired
  const acc3 = mkAccount('9000000003');
  const o3 = mkOrder();
  assert.deepEqual(pool.claimForAccount(o3, acc3), { ok: false, reason: 'unpaired' });

  // release ke baad wahi fix number doosre order ko milta hai
  assert.ok(pool.releaseNumber(o1), 'release o1');
  const o4 = mkOrder();
  assert.equal(pool.claimForAccount(o4, acc1).number, n1, 'release ke baad reuse');
  assert.ok(pool.releaseNumber(o4));
  assert.equal(pool.releaseNumber(99999), false, 'unknown order release = false');
  void n2;
});

test('missingPairs: unpaired account count, free na ho to bhi missing', () => {
  const db = dbMod.getDb();
  pool.ensurePairs(); // acc3 (pichhle test me chhoda) → baaki number se connect
  const accs = db.prepare('SELECT id FROM accounts ORDER BY id').all().map((x) => x.id);
  assert.equal(pool.missingPairs([]), 0, 'khali list = 0');

  // sab paired + free → 0 missing
  const allFree = pool.missingPairs(accs);
  assert.equal(allFree, 0, 'paired accounts free hain');

  // ek account busy karo → missing 1
  const acc1 = accs[0];
  const oid = mkOrder();
  const claim = pool.claimForAccount(oid, acc1);
  assert.equal(claim.ok, true);
  assert.equal(pool.missingPairs(accs), 1, 'busy pair = missing for next booking');
  assert.ok(pool.releaseNumber(oid), 'cleanup release');
  assert.equal(pool.missingPairs(accs), 0, 'release ke baad wapas 0');
});

test('sweep: missing/terminal order free, captcha pending KABHI nahi', () => {
  const db = dbMod.getDb();
  const acc1 = db.prepare('SELECT id FROM accounts ORDER BY id LIMIT 1').get().id;

  // busy row jiska order hi nahi (orphan) → free
  const orphan = pool.claimForAccount(987654, acc1);
  assert.equal(orphan.ok, true, 'orphan claim mila');
  assert.equal(pool.sweepStale(), 1, 'orphan busy free hui');

  // pending captcha order ka busy number sweep me rehna chahiye
  const oid = mkOrder('pending');
  const n2 = pool.claimForAccount(oid, acc1);
  assert.equal(n2.ok, true, 'pending order ko number mila');
  const t = Date.now();
  db.prepare('UPDATE number_pool SET updated_at = ? WHERE active_order_id = ?').run(t - 20 * 60 * 1000, oid);
  assert.equal(pool.sweepStale(), 0, 'pending captcha = attempt zinda, force-free nahi');
  assert.equal(pool.countBusy(), 1, 'pending ka number busy chhoda');

  // placed (terminal) → sweep free kar dega
  db.prepare(`UPDATE orders SET captcha_state = 'placed' WHERE id = ?`).run(oid);
  assert.equal(pool.sweepStale(), 1, 'terminal order → free');
  assert.equal(pool.countBusy(), 0);
});
