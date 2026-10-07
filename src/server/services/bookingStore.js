// Booking status bookkeeping — worker + routes dono use karte hain.
import { getDb } from '../../db/index.js';
import { now } from '../../shared/constants.js';
import { sendEvent } from '../routes/stream.js';
import { stepLabel } from '../../shared/steps.js';
import { tgProgress } from './tg.js';

const ICON = { running: '▶', quoting: '🔍', quoted: '💬', done: '✅', failed: '❌' };

/**
 * TG live-progress ka text — ek booking = ek message (tgProgress edit karta hai).
 * Header: status + plan + done count + bill · Rows: har order (acc, step, price, error).
 */
export function progressText(bookingId) {
  const db = getDb();
  const b = db
    .prepare(
      `SELECT b.*, p.title AS product_title FROM bookings b
       LEFT JOIN products p ON p.id = b.product_id WHERE b.id = ?`
    )
    .get(bookingId);
  if (!b) return '';
  const rows = db
    .prepare(
      `SELECT o.attempt_no, o.step, o.price, o.error, o.captcha_state, a.label
       FROM orders o JOIN accounts a ON a.id = o.account_id
       WHERE o.booking_id = ? ORDER BY o.id`
    )
    .all(bookingId);
  const isDone = (r) => r.captcha_state === 'placed' || r.captcha_state === 'solved';
  const isFail = (r) => r.captcha_state === 'failed' || r.error;
  const finished = rows.filter((r) => isDone(r) || isFail(r)).length;
  const A = b.attempts_per_acc || 1;
  const head =
    `${ICON[b.status] || '▶'} Booking #${b.id} [${b.status}] — ` +
    `${String(b.product_title || b.affiliate_url || '').slice(0, 70)}\n` +
    `${b.n_accounts || rows.length}×${A} · Q=${b.qty_per_cart ?? b.qty}` +
    `${b.max_price ? ' · ≤₹' + Number(b.max_price).toLocaleString('en-IN') : ''}` +
    ` · ${finished}/${rows.length} done` +
    `${b.total_amount ? ' · bill ₹' + Number(b.total_amount).toLocaleString('en-IN') : ''}`;
  const lines = rows.map((r, i) => {
    const base = `#${i + 1} ${r.label} ${r.attempt_no}/${A} · `;
    if (isDone(r)) return `${base}✅ done${r.price ? ' · ₹' + r.price : ''}`;
    if (isFail(r))
      return `${base}❌ ${stepLabel(r.step)}${r.error ? ' — ' + String(r.error).slice(0, 140) : ''}`;
    return `${base}${stepLabel(r.step) || '…'}${r.price != null ? ' · ₹' + r.price : ''}`;
  });
  return [head, ...lines].join('\n').slice(0, 3700);
}

/** Booking progress update — status/error change pe UI + TG live message dono. */
export function refreshBooking(bookingId) {
  const db = getDb();
  const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(bookingId);
  if (!b) return null;
  const t = now();

  const stats = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN price IS NOT NULL OR error IS NOT NULL THEN 1 ELSE 0 END),0) AS quoted_done,
              COALESCE(SUM(CASE WHEN price IS NOT NULL THEN 1 ELSE 0 END),0) AS priced,
              COALESCE(SUM(CASE WHEN captcha_state IN ('placed','solved') THEN 1 ELSE 0 END),0) AS placed,
              COALESCE(SUM(CASE WHEN captcha_state = 'failed' THEN 1 ELSE 0 END),0) AS failed,
              COALESCE(SUM(CASE WHEN captcha_state IN ('placed','solved','failed') OR error IS NOT NULL THEN 1 ELSE 0 END),0) AS finished,
              COALESCE(SUM(CASE WHEN captcha_state = 'pending' THEN 1 ELSE 0 END),0) AS pending
       FROM orders WHERE booking_id = ?`
    )
    .get(bookingId);

  // price = cart ka final bill (qty + offers ke baad) — SUM(price) hi total
  const totalAmount = db
    .prepare(
      'SELECT COALESCE(SUM(price), 0) AS amt FROM orders WHERE booking_id = ? AND price IS NOT NULL'
    )
    .get(bookingId).amt;

  let status = b.status;
  let progress = 0;

  if (b.status === 'quoting') {
    progress = stats.quoted_done;
    if (stats.total > 0 && stats.quoted_done >= stats.total) {
      status = stats.priced > 0 ? 'quoted' : 'failed';
    }
  } else if (b.status === 'running' || b.status === 'quoted') {
    progress = stats.finished;
    if (stats.total > 0 && stats.finished >= stats.total) {
      status = stats.placed > 0 ? 'done' : 'failed';
    }
  }

  // booking-level error: sabse zyada baar aane wala order error (UI ko clean
  // dikhane ke liye) — koi order error nahi to NULL (retry/captcha clear pe bhi).
  const topErr = db
    .prepare(
      `SELECT error FROM orders WHERE booking_id = ? AND error IS NOT NULL
       GROUP BY error ORDER BY COUNT(*) DESC, MAX(id) DESC LIMIT 1`
    )
    .get(bookingId);
  const bookingError = topErr?.error ?? null;

  const changed = status !== b.status;
  const errorChanged = (b.error ?? null) !== bookingError;
  db.prepare(
    `UPDATE bookings SET progress = ?, status = ?, total_amount = ?, error = ?, updated_at = ? WHERE id = ?`
  ).run(progress, status, totalAmount || b.total_amount, bookingError, t, bookingId);

  if (changed || errorChanged) {
    sendEvent('booking_status', {
      bookingId,
      status,
      progress,
      total: b.total,
      error: bookingError,
    });
    // TG live message — EK hi message per booking (edit), error line bhi usi me.
    tgProgress(bookingId, progressText(bookingId));
  }
  return { status, progress, total: b.total, totalAmount: totalAmount || b.total_amount, error: bookingError };
}

/**
 * Live checkout step — orders.step update + SSE order_step.
 * UI stepper (OrderPanel/Orders) + TG progress message isi se chalta hai.
 */
export function setOrderStep(orderId, bookingId, step) {
  getDb()
    .prepare('UPDATE orders SET step = ?, updated_at = ? WHERE id = ?')
    .run(step, now(), orderId);
  sendEvent('order_step', { orderId, bookingId, step });
  tgProgress(bookingId, progressText(bookingId));
}
