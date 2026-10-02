import { Router } from 'express';
import { h } from '../middleware/error.js';
import { getDb } from '../../db/index.js';
import { now, maskIdentifier } from '../../shared/constants.js';
import { enqueue } from '../../worker/queue.js';

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
    account_masked: row.account_masked || null,
    qty: row.qty,
    price: row.price,
    captcha_state: row.captcha_state,
    order_ref: row.order_ref,
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

// Quote step — allocate accounts, orders banao, price_check jobs enqueue
r.post(
  '/',
  h(async (req, res) => {
    const { product_id, section_id, qty, qty_mode = 'total', per_acc_qty, address_id } =
      req.body || {};
    const db = getDb();

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(product_id));
    if (!product) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such product' } });
    }
    const section = db.prepare('SELECT * FROM sections WHERE id = ?').get(Number(section_id));
    if (!section) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such section' } });
    }
    const address = db.prepare('SELECT * FROM addresses WHERE id = ?').get(Number(address_id));
    if (!address) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such address' } });
    }
    if (qty_mode !== 'total' && qty_mode !== 'per_account') {
      return res.status(400).json({ error: { code: 'invalid', message: 'qty_mode galat hai' } });
    }

    const q = Math.max(1, parseInt(qty, 10) || 1);
    const per = Math.max(1, parseInt(per_acc_qty, 10) || 1);
    const t = now();

    const eligible = db
      .prepare(
        `SELECT a.id FROM accounts a
         WHERE a.section_id = ? AND a.status = 'active'
           AND (a.booked_until IS NULL OR a.booked_until <= ?)
         ORDER BY a.id`
      )
      .all(section.id, t)
      .map((x) => x.id);

    let plan;
    if (qty_mode === 'per_account') {
      if (eligible.length === 0) {
        return res.status(409).json({
          error: {
            code: 'insufficient',
            message: 'Section me koi free active account nahi',
            available: 0,
            needed: per,
          },
        });
      }
      plan = eligible.map((account_id) => ({ account_id, qty: per }));
    } else {
      if (eligible.length < q) {
        return res.status(409).json({
          error: {
            code: 'insufficient',
            message: `Sirf ${eligible.length} free active accounts hain (chahiye ${q})`,
            available: eligible.length,
            needed: q,
          },
        });
      }
      plan = eligible.slice(0, q).map((account_id) => ({ account_id, qty: 1 }));
    }
    const totalOrders = plan.reduce((s, p) => s + p.qty, 0);
    const affiliate = product.affiliate_url || product.url;

    let bookingId = 0;
    const orderIds = [];
    const run = db.transaction(() => {
      const b = db
        .prepare(
          `INSERT INTO bookings (product_id, platform, affiliate_url, section_id, address_id,
                                 qty, qty_mode, per_acc_qty, status, total, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'quoting', ?, ?, ?)`
        )
        .run(
          product.id,
          product.platform || 'flipkart',
          affiliate,
          section.id,
          address.id,
          q,
          qty_mode,
          per,
          totalOrders,
          t,
          t
        );
      bookingId = Number(b.lastInsertRowid);
      const ins = db.prepare(
        `INSERT INTO orders (booking_id, account_id, product_id, address_id, qty,
                             captcha_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'auto', ?, ?)`
      );
      for (const p of plan) {
        for (let i = 0; i < p.qty; i++) {
          const oi = ins.run(bookingId, p.account_id, product.id, address.id, 1, t, t);
          orderIds.push(Number(oi.lastInsertRowid));
        }
      }
    });
    run();

    for (const id of orderIds) enqueue('price_check', id);
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
