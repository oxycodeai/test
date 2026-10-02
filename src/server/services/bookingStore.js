// Booking status bookkeeping — worker + routes dono use karte hain.
import { getDb } from '../../db/index.js';
import { now } from '../../shared/constants.js';
import { sendEvent } from '../routes/stream.js';

/**
 * Orders ke baad booking progress/status recompute karo.
 * quoting: progress = rows jahan price ya error dono set → sab done → 'quoted' (agar ≥1 price)
 * running: rows placed/failed → sab done → 'done' (≥1 placed) / 'failed'
 */
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
              COALESCE(SUM(CASE WHEN captcha_state = 'placed' THEN 1 ELSE 0 END),0) AS placed,
              COALESCE(SUM(CASE WHEN captcha_state = 'failed' THEN 1 ELSE 0 END),0) AS failed,
              COALESCE(SUM(CASE WHEN captcha_state IN ('placed','failed') OR error IS NOT NULL THEN 1 ELSE 0 END),0) AS finished,
              COALESCE(SUM(CASE WHEN captcha_state = 'pending' THEN 1 ELSE 0 END),0) AS pending
       FROM orders WHERE booking_id = ?`
    )
    .get(bookingId);

  const totalAmount = db
    .prepare(
      'SELECT COALESCE(SUM(price * qty), 0) AS amt FROM orders WHERE booking_id = ? AND price IS NOT NULL'
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

  const changed = status !== b.status;
  db.prepare(
    `UPDATE bookings SET progress = ?, status = ?, total_amount = ?, updated_at = ? WHERE id = ?`
  ).run(progress, status, totalAmount || b.total_amount, t, bookingId);

  if (changed) {
    sendEvent('booking_status', { bookingId, status, progress, total: b.total });
  }
  return { status, progress, total: b.total, totalAmount: totalAmount || b.total_amount };
}
