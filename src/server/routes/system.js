import { Router } from 'express';
import { h } from '../middleware/error.js';
import { platformName } from '../../shared/constants.js';
import { browserInfo } from '../../worker/platform.js';
import { getDb } from '../../db/index.js';

const r = Router();
const started = Date.now();

export const healthHandler = h(async (req, res) => {
  res.json({
    ok: true,
    platform: platformName(),
    version: process.env.npm_package_version || '0.1.0',
    uptimeSec: Math.round((Date.now() - started) / 1000),
    browser: browserInfo(),
  });
});

r.get('/health', healthHandler);

r.get(
  '/stats',
  h(async (req, res) => {
    const db = getDb();
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
    const one = (sql, ...args) => db.prepare(sql).get(...args)?.n ?? 0;
    res.json({
      active_accs: one(`SELECT COUNT(*) n FROM accounts WHERE status = 'active'`),
      total_accs: one(`SELECT COUNT(*) n FROM accounts`),
      pending_jobs: one(`SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')`),
      today_orders: one(
        `SELECT COUNT(*) n FROM orders WHERE captcha_state = 'placed' AND created_at >= ?`,
        dayStart
      ),
      month_earning: one(
        `SELECT COALESCE(SUM(amount),0) n FROM commission_events
         WHERE status IN ('approved','paid') AND order_date >= ?`,
        monthStart
      ),
    });
  })
);

export default r;
