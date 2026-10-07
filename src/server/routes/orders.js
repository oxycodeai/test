import { Router } from 'express';
import { h } from '../middleware/error.js';
import { getDb } from '../../db/index.js';
import { now, maskIdentifier } from '../../shared/constants.js';
import { enqueue } from '../../worker/queue.js';
import { setPendingCaptcha } from '../../worker/otp-store.js';

const r = Router();

const SQL = `
  SELECT o.*, ac.label AS account_label, ac.identifier AS account_identifier,
         b.status AS booking_status, p.title AS product_title
  FROM orders o
  LEFT JOIN accounts ac ON ac.id = o.account_id
  LEFT JOIN bookings b ON b.id = o.booking_id
  LEFT JOIN products p ON p.id = o.product_id
`;

function shape(row) {
  return {
    id: row.id,
    booking_id: row.booking_id,
    booking_status: row.booking_status,
    account_id: row.account_id,
    account_label: row.account_label,
    identifier: row.account_identifier || null,
    account_masked: maskIdentifier(row.account_identifier),
    product_title: row.product_title,
    qty: row.qty,
    attempt_no: row.attempt_no ?? 1,
    price: row.price,
    captcha_state: row.captcha_state,
    captcha_png: row.captcha_png,
    order_ref: row.order_ref,
    step: row.step || null,
    error: row.error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Order list — ?booking_id=&state=pending (captcha queue) / placed / failed / all
r.get(
  '/',
  h(async (req, res) => {
    const { booking_id, state } = req.query;
    const where = [];
    const args = [];
    if (booking_id) {
      where.push('o.booking_id = ?');
      args.push(Number(booking_id));
    }
    if (state === 'pending') {
      where.push("o.captcha_state = 'pending'");
    } else if (state === 'placed') {
      where.push("o.captcha_state = 'placed'");
    } else if (state === 'failed') {
      where.push("(o.captcha_state = 'failed' OR (o.error IS NOT NULL AND o.captcha_state != 'pending'))");
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = getDb()
      .prepare(`${SQL} ${clause} ORDER BY o.id DESC LIMIT 200`)
      .all(...args);
    res.json({ items: rows.map(shape) });
  })
);

// Manual captcha solve — text aaya, order job dubara enqueue (flow replay)
r.post(
  '/:id/captcha',
  h(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such order' } });
    }
    if (order.captcha_state !== 'pending') {
      return res.status(409).json({
        error: { code: 'invalid_state', message: 'Order captcha pending nahi hai' },
      });
    }
    const text = String(req.body?.text || '').trim();
    if (!text || text.length > 8) {
      return res.status(400).json({ error: { code: 'invalid', message: 'Captcha text galat hai' } });
    }
    setPendingCaptcha(id, text);
    db.prepare(
      `UPDATE orders SET error = NULL, step = NULL, updated_at = ? WHERE id = ?`
    ).run(now(), id);
    enqueue('order', id);
    res.json({ ok: true });
  })
);

// Retry failed order — naya model: seedha order flow (price step khud set karta hai)
r.post(
  '/:id/retry',
  h(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
    if (!order) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such order' } });
    }
    if (order.captcha_state === 'placed') {
      return res.status(409).json({ error: { code: 'invalid_state', message: 'Order already placed' } });
    }
    db.prepare(
      `UPDATE orders SET error = NULL, captcha_state = 'auto', step = NULL, updated_at = ? WHERE id = ?`
    ).run(now(), id);
    enqueue('order', id);
    res.json({ ok: true, step: 'order' });
  })
);

export default r;
