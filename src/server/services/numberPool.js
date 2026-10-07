import { getDb } from '../../db/index.js';
import { now } from '../../shared/constants.js';

/**
 * Invalid number pool — Settings "Import Invalid Num" se aate hain.
 * Har account (login number) ko EK FIX invalid number se PAIR kiya jaata hai
 * (account_id) — order ka address hamesha usi account ke pair ka number
 * lega. Pairing lazy: import/account-create pe ensurePairs() chalta hai.
 * Attempt SE pehle claim (free→busy), attempt khatam = release (both
 * success/fail). Ek number ek time pe sirf ek order me — atomic WHERE free.
 */

/** File/text se line-wise 10-15 digit runs nikal (comma/slash/newline sab chalega). */
export function parseImportText(text) {
  const numbers = [];
  const invalid = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const matches = line.match(/\d{10,15}/g);
    if (!matches) {
      invalid.push(line);
      continue;
    }
    for (let d of matches) {
      // 91XXXXXXXXXX / 0XXXXXXXXXX prefix hata (10-digit normalize)
      if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
      else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
      if (d.length >= 10 && d.length <= 15) numbers.push(d);
      else invalid.push(line);
    }
  }
  return { numbers, invalid };
}

/** Text import karo — {imported, skipped_dupes, invalid_lines, paired} */
export function importNumbers(text) {
  const { numbers, invalid } = parseImportText(text);
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM number_pool WHERE number = ?');
  const ins = db.prepare(
    'INSERT INTO number_pool (number, status, created_at, updated_at) VALUES (?, ?, ?, ?)'
  );
  let imported = 0;
  let skipped = 0;
  const seen = new Set();
  const t = now();
  const run = db.transaction(() => {
    for (const n of numbers) {
      if (seen.has(n) || exists.get(n)) {
        skipped++;
        continue;
      }
      seen.add(n);
      ins.run(n, 'free', t, t);
      imported++;
    }
  });
  run();
  const paired = ensurePairs();
  return { imported, skipped_dupes: skipped, invalid_lines: invalid.length, paired };
}

/**
 * Auto-pair: bina pair wale accounts (id order) ↔ bina pair wale numbers
 * (id order). Import, account-create aur booking pre-flight pe call hota hai
 * — "jo login number pe connect nahi hai usse connect".
 */
export function ensurePairs() {
  const db = getDb();
  const t = now();
  let paired = 0;
  const run = db.transaction(() => {
    const accs = db
      .prepare(
        `SELECT a.id FROM accounts a
         WHERE NOT EXISTS (SELECT 1 FROM number_pool np WHERE np.account_id = a.id)
         ORDER BY a.id`
      )
      .all();
    const nums = db
      .prepare('SELECT id FROM number_pool WHERE account_id IS NULL ORDER BY id')
      .all();
    const upd = db.prepare(
      'UPDATE number_pool SET account_id = ?, updated_at = ? WHERE id = ? AND account_id IS NULL'
    );
    const n = Math.min(accs.length, nums.length);
    for (let i = 0; i < n; i++) {
      upd.run(accs[i].id, t, nums[i].id);
      paired++;
    }
  });
  run();
  return paired;
}

/** Eligible accounts me se kitne ke paas free paired number nahi (missing=k). */
export function missingPairs(accountIds) {
  const db = getDb();
  if (!accountIds?.length) return 0;
  const has = db.prepare(
    "SELECT 1 FROM number_pool WHERE account_id = ? AND status = 'free'"
  );
  let missing = 0;
  for (const id of accountIds) if (!has.get(id)) missing++;
  return missing;
}

export function countFree() {
  return getDb().prepare("SELECT COUNT(*) AS c FROM number_pool WHERE status = 'free'").get().c;
}

export function countBusy() {
  return getDb().prepare("SELECT COUNT(*) AS c FROM number_pool WHERE status = 'busy'").get().c;
}

export function countTotal() {
  return getDb().prepare('SELECT COUNT(*) AS c FROM number_pool').get().c;
}

export function listNumbers(limit = 500) {
  return getDb()
    .prepare(
      `SELECT np.*, a.identifier AS account_identifier, a.label AS account_label, a.status AS account_status
       FROM number_pool np LEFT JOIN accounts a ON a.id = np.account_id
       ORDER BY np.id DESC LIMIT ?`
    )
    .all(Math.max(1, Math.min(2000, Number(limit) || 500)));
}

/**
 * Account ka FIX number claim. Idempotent — isi order ka pehle se busy hai
 * to wahi wapas. Unpaired (connect hi nahi) → {ok:false, reason:'unpaired'};
 * kisi doosre order ke paas busy → sweep retry ke baad {ok:false, reason:'busy'}.
 */
export function claimForAccount(orderId, accountId) {
  const db = getDb();
  const mine = db
    .prepare("SELECT number FROM number_pool WHERE active_order_id = ? AND status = 'busy'")
    .get(orderId);
  if (mine) return { ok: true, number: mine.number };

  const paired = db
    .prepare('SELECT id, number FROM number_pool WHERE account_id = ?')
    .get(accountId);
  if (!paired) return { ok: false, reason: 'unpaired' };

  const t = now();
  const SQL = `UPDATE number_pool SET status = 'busy', active_order_id = ?, updated_at = ?
       WHERE id = ? AND account_id = ? AND status = 'free'`;
  let info = db.prepare(SQL).run(orderId, t, paired.id, accountId);
  if (!info.changes) {
    // crash/terminal wale busy free karke ek retry (skipOrphan — fake ids recycle na hon).
    sweepStale(15 * 60 * 1000, true);
    info = db.prepare(SQL).run(orderId, t, paired.id, accountId);
  }
  if (!info.changes) return { ok: false, reason: 'busy' };
  return { ok: true, number: paired.number };
}

/** Attempt khatam → free. Sirf isi order ka busy row chhutega. */
export function releaseNumber(orderId) {
  const info = getDb()
    .prepare(
      `UPDATE number_pool SET status = 'free', active_order_id = NULL, updated_at = ?
       WHERE active_order_id = ? AND status = 'busy'`
    )
    .run(now(), orderId);
  return info.changes > 0;
}

/**
 * Crash recovery: terminal order (failed/placed) ke busy numbers turant
 * free; zinda attempt (auto/solved) sirf stale (default 15min) hone pe free;
 * manual captcha 'pending' KABHI force-free nahi (attempt zinda hai).
 * skipOrphan=true → jiska order row hi nahi hai usse chhod do (sirf startup
 * sweep orphan bhi hatata hai — claim-lazy path fake ids pe recycle na kare).
 */
export function sweepStale(staleMs = 15 * 60 * 1000, skipOrphan = false) {
  const db = getDb();
  const t = now();
  const rows = db.prepare("SELECT id, active_order_id, updated_at FROM number_pool WHERE status = 'busy'").all();
  let freed = 0;
  for (const r of rows) {
    const order = r.active_order_id
      ? db.prepare('SELECT captcha_state FROM orders WHERE id = ?').get(r.active_order_id)
      : null;
    const state = order?.captcha_state || null;
    if (!order && skipOrphan) continue;
    const terminal = !order || state === 'failed' || state === 'placed';
    const stale = r.updated_at < t - staleMs;
    if (terminal || (stale && state !== 'pending')) {
      freed += db
        .prepare(
          `UPDATE number_pool SET status = 'free', active_order_id = NULL, updated_at = ?
           WHERE id = ? AND status = 'busy'`
        )
        .run(t, r.id).changes;
    }
  }
  return freed;
}
