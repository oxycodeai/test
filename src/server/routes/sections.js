import { Router } from 'express';
import { h } from '../middleware/error.js';
import { getDb } from '../../db/index.js';
import { now } from '../../shared/constants.js';

const r = Router();

r.get(
  '/',
  h(async (req, res) => {
    const t = now();
    const rows = getDb()
      .prepare(
        `SELECT s.id, s.name, s.created_at,
                COUNT(a.id) AS accounts,
                COALESCE(SUM(CASE WHEN a.status='active' THEN 1 ELSE 0 END),0) AS active,
                COALESCE(SUM(CASE WHEN a.booked_until IS NOT NULL AND a.booked_until > ? THEN 1 ELSE 0 END),0) AS booked
         FROM sections s
         LEFT JOIN accounts a ON a.section_id = s.id
         GROUP BY s.id
         ORDER BY s.name COLLATE NOCASE`
      )
      .all(t);
    res.json({ items: rows });
  })
);

r.post(
  '/',
  h(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) {
      return res.status(400).json({ error: { code: 'invalid', message: 'Section name required' } });
    }
    if (name.length > 60) {
      return res.status(400).json({ error: { code: 'invalid', message: 'Max 60 characters' } });
    }
    try {
      const info = getDb()
        .prepare('INSERT INTO sections (name, created_at) VALUES (?, ?)')
        .run(name, now());
      res.status(201).json({ id: Number(info.lastInsertRowid), name });
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) {
        return res
          .status(409)
          .json({ error: { code: 'duplicate', message: 'Section pehle se hai' } });
      }
      throw e;
    }
  })
);

r.delete(
  '/:id',
  h(async (req, res) => {
    const info = getDb().prepare('DELETE FROM sections WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such section' } });
    }
    res.json({ ok: true });
  })
);

export default r;
