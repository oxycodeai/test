import { Router } from 'express';
import { h } from '../middleware/error.js';
import { platformName } from '../../shared/constants.js';
import { browserInfo, closeBrowser } from '../../worker/platform.js';
import { getDb, getSetting, setSetting } from '../../db/index.js';
import { getProxyUrl, resetProxyAgent } from '../services/net.js';

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
    const one = (sql, ...args) => db.prepare(sql).get(...args)?.n ?? 0;
    res.json({
      active_accs: one(`SELECT COUNT(*) n FROM accounts WHERE status = 'active'`),
      total_accs: one(`SELECT COUNT(*) n FROM accounts`),
      pending_jobs: one(`SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')`),
      today_orders: one(
        `SELECT COUNT(*) n FROM orders WHERE captcha_state = 'placed' AND created_at >= ?`,
        dayStart
      ),
    });
  })
);

// Whitelisted app settings (proxy, health interval) — auth ke peeche (app.js requireAuth).
const SETTING_KEYS = ['proxy_url', 'health_interval_min'];

r.get(
  '/settings',
  h(async (req, res) => {
    const out = {};
    for (const k of SETTING_KEYS) out[k] = getSetting(k) || '';
    out.proxy_active = !!getProxyUrl();
    out.proxy_source = getSetting('proxy_url') ? 'settings' : getProxyUrl() ? 'env' : 'none';
    res.json(out);
  })
);

r.put(
  '/settings',
  h(async (req, res) => {
    const body = req.body || {};
    const updated = {};
    for (const k of SETTING_KEYS) {
      if (!(k in body)) continue;
      const v = String(body[k] ?? '').trim();
      if (k === 'proxy_url') {
        if (v) {
          let u;
          try {
            u = new URL(v);
          } catch {
            return res.status(400).json({
              error: { code: 'invalid', message: 'Proxy URL valid http(s)://user:pass@host:port hona chahiye' },
            });
          }
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            return res.status(400).json({
              error: { code: 'invalid', message: 'Sirf http:// ya https:// proxy chalega (socks5 nahi)' },
            });
          }
        }
        setSetting('proxy_url', v);
        resetProxyAgent();
        await closeBrowser(); // naye proxy ke saath relaunch (lazy)
      } else if (k === 'health_interval_min') {
        const n = parseInt(v, 10);
        if (!Number.isFinite(n) || n < 1 || n > 1440) {
          return res.status(400).json({
            error: { code: 'invalid', message: 'health_interval_min 1-1440 minutes hona chahiye' },
          });
        }
        setSetting('health_interval_min', String(n));
      }
      updated[k] = String(body[k] ?? '').trim();
    }
    if (!Object.keys(updated).length) {
      return res.status(400).json({ error: { code: 'invalid', message: 'koi setting nahi di' } });
    }
    const out = {};
    for (const k of SETTING_KEYS) out[k] = getSetting(k) || '';
    out.proxy_active = !!getProxyUrl();
    out.proxy_source = getSetting('proxy_url') ? 'settings' : getProxyUrl() ? 'env' : 'none';
    res.json(out);
  })
);

export default r;
