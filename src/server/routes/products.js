import { Router } from 'express';
import { h } from '../middleware/error.js';
import { getDb } from '../../db/index.js';
import { now } from '../../shared/constants.js';
import { fetchProductPage, isSupportedAffiliateUrl, resolveAffiliateUrl } from '../services/pageFetch.js';
import { convertLink, isConfigured } from '../integrations/cuelinks.js';
import { sendEvent } from './stream.js';

const r = Router();
const CACHE_MS = 15 * 60 * 1000;

function shape(row) {
  return {
    ...row,
    offers: row.offers_json ? JSON.parse(row.offers_json) : [],
    offers_json: undefined,
    age_min: Math.max(0, Math.round((now() - row.fetched_at) / 60000)),
  };
}

r.get(
  '/',
  h(async (req, res) => {
    const rows = getDb()
      .prepare('SELECT * FROM products ORDER BY fetched_at DESC LIMIT 20')
      .all()
      .map(shape);
    res.json({ items: rows });
  })
);

r.post(
  '/fetch',
  h(async (req, res) => {
    const { url } = req.body || {};
    if (!url || !isSupportedAffiliateUrl(url)) {
      return res.status(400).json({
        error: {
          code: 'invalid_url',
          message: 'Valid Flipkart / CashKaro / EarnKaro product link required',
        },
      });
    }
    const db = getDb();

    // CashKaro/EarnKaro hop → final Flipkart product URL (flipkart pe no-op)
    const resolved = await resolveAffiliateUrl(url);
    const canonical = resolved.url;

    // cache: same canonical URL, <15 min → return fresh
    const cached = db
      .prepare('SELECT * FROM products WHERE url = ? ORDER BY fetched_at DESC LIMIT 1')
      .get(canonical);
    if (cached && now() - cached.fetched_at < CACHE_MS) {
      return res.json({ ...shape(cached), cached: true, affiliate: { mode: 'cache' } });
    }

    // affiliate convert — sirf direct flipkart links (CK/EK already affiliate)
    const aff =
      resolved.platform === 'flipkart'
        ? await convertLink(canonical)
        : { url: resolved.affiliateUrl, mode: resolved.platform, converted: false, native: true };

    // real product data
    const data = await fetchProductPage(canonical);
    if (!data.title && !data.price) {
      return res.status(502).json({
        error: {
          code: 'fetch_failed',
          message: 'Could not extract product data (page changed or blocked)',
        },
      });
    }

    const t = now();
    const info = db
      .prepare(
        `INSERT INTO products (url, platform, affiliate_url, pid, title, image, mrp, price, special_price, discount_pct,
                               in_stock, cod_product, offers_json, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        canonical,
        resolved.platform,
        resolved.affiliateUrl,
        new URL(canonical).searchParams.get('pid'),
        data.title,
        data.image,
        data.mrp,
        data.price,
        data.special_price,
        data.discount_pct,
        data.in_stock,
        data.cod_product,
        JSON.stringify(data.offers || []),
        t
      );
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
    sendEvent('product_fetched', { id: row.id, title: row.title });
    res.status(201).json({
      ...shape(row),
      cached: false,
      affiliate: { ...aff, configured: isConfigured() },
      method: data.method,
    });
  })
);

r.get(
  '/:id',
  h(async (req, res) => {
    const row = getDb().prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: { code: 'not_found', message: 'No product' } });
    res.json(shape(row));
  })
);

export default r;
