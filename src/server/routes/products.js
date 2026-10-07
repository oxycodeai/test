import { Router } from 'express';
import { h } from '../middleware/error.js';
import { getDb } from '../../db/index.js';
import { resolveProduct, productShape as shape } from '../services/productResolve.js';

const r = Router();

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
    try {
      const out = await resolveProduct(req.body?.url);
      res.status(out.cached ? 200 : 201).json({
        ...shape(out.row),
        cached: out.cached,
        affiliate: out.affiliate,
        method: out.method,
      });
    } catch (e) {
      res.status(e.status || 502).json({
        error: { code: e.code || 'fetch_failed', message: e.message || 'Fetch fail ho gaya' },
      });
    }
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
