import { Router } from 'express';
import { h } from '../middleware/error.js';
import { getDb } from '../../db/index.js';
import { now, maskIdentifier } from '../../shared/constants.js';
import { enqueue } from '../../worker/queue.js';
import { countTotal, ensurePairs, missingPairs } from '../services/numberPool.js';
import { resolveProduct } from '../services/productResolve.js';
import { tgSend, tgProgress } from '../services/tg.js';
import { progressText } from '../services/bookingStore.js';

const r = Router();

function shapeBooking(row) {
  return {
    id: row.id,
    product_id: row.product_id,
    product_title: row.product_title || null,
    product_image: row.product_image || null,
    platform: row.platform || 'flipkart',
    affiliate_url: row.affiliate_url,
    section_id: row.section_id,
    section_name: row.section_name || null,
    address_id: row.address_id,
    address_line: row.address_line || null,
    qty: row.qty,
    qty_mode: row.qty_mode,
    per_acc_qty: row.per_acc_qty,
    n_accounts: row.n_accounts ?? null,
    qty_per_cart: row.qty_per_cart ?? null,
    attempts_per_acc: row.attempts_per_acc ?? null,
    max_price: row.max_price ?? null,
    status: row.status,
    progress: row.progress,
    total: row.total,
    total_amount: row.total_amount,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function shapeOrder(row) {
  return {
    id: row.id,
    booking_id: row.booking_id,
    account_id: row.account_id,
    account_label: row.account_label || null,
    identifier: row.account_identifier || null,
    account_masked: row.account_masked || null,
    qty: row.qty,
    attempt_no: row.attempt_no ?? 1,
    price: row.price,
    captcha_state: row.captcha_state,
    order_ref: row.order_ref,
    step: row.step || null,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const LIST_SQL = `
  SELECT b.*, p.title AS product_title, p.image AS product_image,
         s.name AS section_name,
         (a.name || ', ' || a.pincode) AS address_line
  FROM bookings b
  LEFT JOIN products p ON p.id = b.product_id
  LEFT JOIN sections s ON s.id = b.section_id
  LEFT JOIN addresses a ON a.id = b.address_id
`;

const ORDERS_SQL = `
  SELECT o.*, ac.label AS account_label, ac.identifier AS account_identifier
  FROM orders o
  LEFT JOIN accounts ac ON ac.id = o.account_id
`;

r.get(
  '/',
  h(async (req, res) => {
    const rows = getDb()
      .prepare(`${LIST_SQL} ORDER BY b.id DESC LIMIT 50`)
      .all();
    res.json({ items: rows.map(shapeBooking) });
  })
);

r.get(
  '/:id',
  h(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const row = db.prepare(`${LIST_SQL} WHERE b.id = ?`).get(id);
    if (!row) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such booking' } });
    }
    const orders = db
      .prepare(`${ORDERS_SQL} WHERE o.booking_id = ? ORDER BY o.id`)
      .all(id)
      .map((o) => shapeOrder({ ...o, account_masked: maskIdentifier(o.account_identifier) }));
    res.json({ ...shapeBooking(row), orders });
  })
);

// New model — N accounts × A attempts (har account pe Q qty ka cart),
// seedha running + order jobs enqueue (quote/confirm 2-phase nahi)
r.post(
  '/',
  h(async (req, res) => {
    const { url, product_id, section_id, address_id, n_accounts, qty_per_cart, attempts_per_acc, max_price } =
      req.body || {};
    const db = getDb();

    // url mode (fetch-page hata diya): link se andar hi product resolve → COD gate.
    // product_id mode backward-compat me chalta rahega.
    let product;
    if (url && !product_id) {
      try {
        product = (await resolveProduct(url)).row;
      } catch (e) {
        return res.status(e.status || 502).json({
          error: { code: e.code || 'fetch_failed', message: e.message || 'Product resolve nahi hua' },
        });
      }
    } else {
      product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(product_id));
      if (!product) {
        return res.status(404).json({ error: { code: 'not_found', message: 'No such product' } });
      }
    }
    // COD gate — SOFT (COD dynamic hai: kisi account pe aata hai, kisi nahi).
    // Fetch-time cod=0 ab BLOCK nahi karta: har attempt payment page pe khud
    // check hota hai → COD missing ho to sirf wo attempt skip, baaki attempts
    // (admin ke A tries) aur baaki accounts chalte rahenge.
    if (!Number(product.cod_product)) {
      tgSend(
        `Note: COD fetch me nahi dikha — attempt-time check hoga (COD dynamic): ${(product.title || product.url || '').slice(0, 120)}`,
        3600,
        `cod:${product.id}`
      );
    }
    const address = db.prepare('SELECT * FROM addresses WHERE id = ?').get(Number(address_id));
    if (!address) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such address' } });
    }
    // Invalid-num pre-flight — Start tap karte hi bata do, process mat chalao.
    if (countTotal() === 0) {
      tgSend('Invalid number pool khaali — Settings me Import Invalid Num karo', 1800, 'pool:empty');
      return res.status(409).json({
        error: {
          code: 'no_invalid_number',
          message: 'Koi invalid number nahi — pehle Settings me Import Invalid Num karo',
          available: 0,
        },
      });
    }
    let section = null;
    if (section_id != null && section_id !== '') {
      section = db.prepare('SELECT * FROM sections WHERE id = ?').get(Number(section_id));
      if (!section) {
        return res.status(404).json({ error: { code: 'not_found', message: 'No such section' } });
      }
    }

    const N = Math.max(1, parseInt(n_accounts, 10) || 1);
    const Q = Math.max(1, parseInt(qty_per_cart, 10) || 1);
    const A = Math.max(1, parseInt(attempts_per_acc, 10) || 1);
    let cap = null;
    if (max_price != null && max_price !== '') {
      const n = parseInt(String(max_price).replace(/[^\d]/g, ''), 10);
      if (!n) {
        return res.status(400).json({ error: { code: 'invalid', message: 'max_price galat hai' } });
      }
      cap = n;
    }

    const t = now();
    // Free accounts: active + booked_until free + kisi running/quoting/quoted booking me na ho
    const eligible = db
      .prepare(
        `SELECT a.id FROM accounts a
         WHERE a.status = 'active'
           AND (a.booked_until IS NULL OR a.booked_until <= ?)
           AND (? IS NULL OR a.section_id = ?)
           AND NOT EXISTS (
             SELECT 1 FROM orders o JOIN bookings b ON b.id = o.booking_id
             WHERE o.account_id = a.id AND b.status IN ('running','quoting','quoted')
           )
         ORDER BY a.id
         LIMIT ?`
      )
      .all(t, section ? section.id : null, section ? section.id : null, N)
      .map((x) => x.id);

    if (eligible.length < N) {
      tgSend(
        `Booking block: sirf ${eligible.length} free active accounts (chahiye ${N}) — Accounts page pe inactive/expired check karo (SMS forwarder panel check karo)`,
        900,
        'acct:insufficient'
      );
      return res.status(409).json({
        error: {
          code: 'insufficient',
          message: `Sirf ${eligible.length} free active accounts hain (chahiye ${N})`,
          available: eligible.length,
          needed: N,
        },
      });
    }

    // Fix-pairing gate — har eligible account ka EK fix invalid number chahiye
    // (jo connect nahi hai unhe yahin se connect karo, phir bhi na mile to block).
    ensurePairs();
    const missing = missingPairs(eligible);
    if (missing > 0) {
      tgSend(
        `${missing} accounts se invalid number connect nahi — Settings me Import Invalid Num karo`,
        900,
        'pair:missing'
      );
      return res.status(409).json({
        error: {
          code: 'no_invalid_number',
          message: `${missing} accounts se invalid number connect nahi — Settings me Import Invalid Num karo`,
          missing,
        },
      });
    }

    const plan = eligible.slice(0, N);
    const totalOrders = N * A;
    const affiliate = product.affiliate_url || product.url;

    let bookingId = 0;
    const orderIds = [];
    const run = db.transaction(() => {
      const b = db
        .prepare(
          `INSERT INTO bookings (product_id, platform, affiliate_url, section_id, address_id,
                                 qty, qty_mode, per_acc_qty, n_accounts, qty_per_cart,
                                 attempts_per_acc, max_price, status, total, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'total', 1, ?, ?, ?, ?, 'running', ?, ?, ?)`
        )
        .run(
          product.id,
          product.platform || 'flipkart',
          affiliate,
          section ? section.id : null,
          address.id,
          Q,
          N,
          Q,
          A,
          cap,
          totalOrders,
          t,
          t
        );
      bookingId = Number(b.lastInsertRowid);
      const ins = db.prepare(
        `INSERT INTO orders (booking_id, account_id, product_id, address_id, qty, attempt_no,
                             captcha_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'auto', ?, ?)`
      );
      for (const account_id of plan) {
        for (let attempt = 1; attempt <= A; attempt++) {
          const oi = ins.run(bookingId, account_id, product.id, address.id, Q, attempt, t, t);
          orderIds.push(Number(oi.lastInsertRowid));
        }
      }
    });
    run();

    for (const id of orderIds) enqueue('order', id);
    // Start tap → TG me EK live message (baaki steps isi ko edit karte rahenge)
    tgProgress(bookingId, progressText(bookingId));
    res.status(201).json(await fetchDetail(bookingId));
  })
);

async function fetchDetail(id) {
  const db = getDb();
  const row = db.prepare(`${LIST_SQL} WHERE b.id = ?`).get(id);
  const orders = db
    .prepare(`${ORDERS_SQL} WHERE o.booking_id = ? ORDER BY o.id`)
    .all(id)
    .map((o) => shapeOrder({ ...o, account_masked: maskIdentifier(o.account_identifier) }));
  return { ...shapeBooking(row), orders };
}

// Confirm — quoted → running, order jobs enqueue
r.post(
  '/:id/confirm',
  h(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such booking' } });
    }
    if (booking.status !== 'quoted') {
      return res.status(409).json({
        error: { code: 'invalid_state', message: `Booking status "${booking.status}" — sirf quoted confirm ho sakta hai` },
      });
    }
    const ready = db
      .prepare('SELECT COUNT(*) n FROM orders WHERE booking_id = ? AND price IS NOT NULL AND captcha_state = ?')
      .get(id, 'auto').n;
    if (ready === 0) {
      return res.status(409).json({
        error: { code: 'no_quotes', message: 'Kisi account ka price ready nahi — thodi der baad try karo' },
      });
    }
    db.prepare(`UPDATE bookings SET status = 'running', updated_at = ? WHERE id = ?`).run(now(), id);
    const ids = db
      .prepare(
        `SELECT id FROM orders WHERE booking_id = ? AND price IS NOT NULL AND captcha_state IN ('auto','pending')`
      )
      .all(id)
      .map((x) => x.id);
    for (const oid of ids) enqueue('order', oid);
    res.json(await fetchDetail(id));
  })
);

// Requote — failed/stuck quote booking wapas quoting me + price-NULL orders dobara quote
r.post(
  '/:id/requote',
  h(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such booking' } });
    }
    if (!['quoting', 'quoted', 'failed'].includes(booking.status)) {
      return res.status(409).json({
        error: {
          code: 'invalid_state',
          message: `Booking status "${booking.status}" — requote sirf quote-stage (quoting/quoted/failed) me ho sakta hai`,
        },
      });
    }
    const need = db
      .prepare(
        `SELECT COUNT(*) n FROM orders
         WHERE booking_id = ? AND price IS NULL AND captcha_state = 'auto'`
      )
      .get(id).n;
    if (need === 0 && booking.status === 'failed') {
      // running-stage failed (sab quote ready, orders fail hue) → order retry path
      return res.status(409).json({
        error: {
          code: 'nothing_to_requote',
          message: 'Koi pending quote nahi — Orders page se Retry karo',
        },
      });
    }
    const t = now();
    const runnable = db
      .prepare(
        `SELECT o.id FROM orders o
         WHERE o.booking_id = ? AND o.price IS NULL AND o.captcha_state = 'auto'
           AND NOT EXISTS (
             SELECT 1 FROM jobs j WHERE j.type = 'price_check' AND j.ref_id = o.id
               AND j.status IN ('queued','running')
           )`
      )
      .all(id);
    if (need > 0) {
      const run = db.transaction(() => {
        db.prepare(
          `UPDATE orders SET error = NULL, updated_at = ? WHERE booking_id = ? AND price IS NULL AND captcha_state = 'auto'`
        ).run(t, id);
        db.prepare(
          `UPDATE bookings SET status = 'quoting', error = NULL, updated_at = ? WHERE id = ? AND status IN ('quoted','failed')`
        ).run(t, id);
      });
      run();
    }
    for (const o of runnable) enqueue('price_check', o.id);
    res.json({ ...(await fetchDetail(id)), requeued: runnable.length });
  })
);

// Cancel — running/quoted booking ruk jaye
r.post(
  '/:id/cancel',
  h(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such booking' } });
    }
    if (['done', 'failed', 'cancelled'].includes(booking.status)) {
      return res.status(409).json({
        error: { code: 'invalid_state', message: `Booking already "${booking.status}"` },
      });
    }
    db.transaction(() => {
      db.prepare(
        `UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?`
      ).run(now(), id);
      db.prepare(
        `UPDATE orders SET error = COALESCE(error, 'booking cancelled'), updated_at = ?
         WHERE booking_id = ? AND captcha_state = 'auto' AND price IS NULL`
      ).run(now(), id);
      db.prepare(
        `UPDATE jobs SET status = 'failed', last_error = 'booking cancelled', updated_at = ?
         WHERE status = 'queued' AND type IN ('price_check','order')
           AND ref_id IN (SELECT id FROM orders WHERE booking_id = ?)`
      ).run(now(), id);
    })();
    res.json(await fetchDetail(id));
  })
);

export { fetchDetail };
export default r;
