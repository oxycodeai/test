import { Router } from 'express';
import { h } from '../middleware/error.js';
import { getDb } from '../../db/index.js';
import { now, maskIdentifier } from '../../shared/constants.js';

const r = Router();

/** Flipkart identifier = email ya phone digits */
export function validIdentifier(v) {
  const s = String(v || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || /^\+?\d{6,15}$/.test(s);
}

function shape(row) {
  return {
    id: row.id,
    label: row.label,
    identifier_masked: maskIdentifier(row.identifier),
    status: row.status,
    last_checked: row.last_checked,
    last_error: row.last_error,
    created_at: row.created_at,
  };
}

r.get(
  '/',
  h(async (req, res) => {
    const { status, q } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const where = [];
    const args = [];
    if (status && status !== 'all') {
      where.push('status = ?');
      args.push(status);
    }
    if (q) {
      where.push('(identifier LIKE ? OR label LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const db = getDb();
    const total = db.prepare(`SELECT COUNT(*) n FROM accounts ${clause}`).get(...args).n;
    const items = db
      .prepare(`SELECT * FROM accounts ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, (page - 1) * limit)
      .map(shape);
    res.json({ items, total, page, limit });
  })
);

r.post(
  '/',
  h(async (req, res) => {
    const { label, identifier } = req.body || {};
    if (!validIdentifier(identifier)) {
      return res.status(400).json({
        error: { code: 'invalid', message: 'identifier must be phone (6-15 digits) or email' },
      });
    }
    const db = getDb();
    const id = String(identifier).trim();
    const exists = db.prepare('SELECT id FROM accounts WHERE identifier = ?').get(id);
    if (exists) {
      return res
        .status(409)
        .json({
          error: { code: 'duplicate', message: 'Account already exists', accountId: exists.id },
        });
    }
    const t = now();
    const info = db
      .prepare(
        `INSERT INTO accounts (label, identifier, status, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?)`
      )
      .run(label || null, id, t, t);
    res
      .status(201)
      .json(shape(db.prepare('SELECT * FROM accounts WHERE id = ?').get(info.lastInsertRowid)));
  })
);

r.post(
  '/bulk',
  h(async (req, res) => {
    const { items } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: { code: 'invalid', message: 'items[] required' } });
    }
    const db = getDb();
    const select = db.prepare('SELECT id FROM accounts WHERE identifier = ?');
    const insert = db.prepare(
      `INSERT INTO accounts (label, identifier, status, created_at, updated_at)
       VALUES (?, ?, 'pending', ?, ?)`
    );
    let created = 0;
    let skipped = 0;
    const run = db.transaction(() => {
      for (const it of items) {
        const id = typeof it === 'string' ? it.trim() : String(it.identifier || '').trim();
        if (!validIdentifier(id)) {
          skipped++;
          continue;
        }
        if (select.get(id)) {
          skipped++;
          continue;
        }
        const t = now();
        insert.run(typeof it === 'string' ? null : it.label || null, id, t, t);
        created++;
      }
    });
    run();
    res.json({ created, skipped, total: items.length });
  })
);

r.delete(
  '/:id',
  h(async (req, res) => {
    const info = getDb().prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
    if (!info.changes) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such account' } });
    }
    res.json({ ok: true });
  })
);

export default r;
