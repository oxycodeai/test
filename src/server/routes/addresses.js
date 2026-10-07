import { Router } from 'express';
import { h } from '../middleware/error.js';
import { getDb } from '../../db/index.js';
import { now } from '../../shared/constants.js';

const r = Router();

function shape(row) {
  return { ...row, is_default: !!row.is_default };
}

function validate(body) {
  const v = {
    name: String(body?.name || '').trim(),
    phone: String(body?.phone || '').replace(/\D/g, '') || '',
    pincode: String(body?.pincode || '').replace(/\D/g, ''),
    line1: String(body?.line1 || '').trim(),
    line2: String(body?.line2 || '').trim() || null,
    city: String(body?.city || '').trim(),
    state: String(body?.state || '').trim() || null,
    is_default: body?.is_default ? 1 : 0,
  };
  if (!v.name || !v.pincode || !v.line1 || !v.city) {
    return { error: 'Name, pincode, address line aur city required hain' };
  }
  if (!/^\d{6}$/.test(v.pincode)) return { error: 'Pincode 6 digit hona chahiye' };
  if (v.phone && !/^\d{10,15}$/.test(v.phone)) return { error: 'Phone 10-15 digit hona chahiye' };
  return { value: v };
}

r.get(
  '/',
  h(async (req, res) => {
    const rows = getDb()
      .prepare('SELECT * FROM addresses ORDER BY is_default DESC, id DESC')
      .all()
      .map(shape);
    res.json({ items: rows });
  })
);

function insertAddress(res, v) {
  const db = getDb();
  const run = db.transaction(() => {
    if (v.is_default) db.prepare('UPDATE addresses SET is_default = 0').run();
    const info = db
      .prepare(
        `INSERT INTO addresses (name, phone, pincode, line1, line2, city, state, is_default, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(v.name, v.phone, v.pincode, v.line1, v.line2, v.city, v.state, v.is_default, now());
    return Number(info.lastInsertRowid);
  });
  const id = run();
  res.status(201).json(shape(db.prepare('SELECT * FROM addresses WHERE id = ?').get(id)));
}

r.post(
  '/',
  h(async (req, res) => {
    const { error, value } = validate(req.body);
    if (error) return res.status(400).json({ error: { code: 'invalid', message: error } });
    insertAddress(res, value);
  })
);

r.put(
  '/:id',
  h(async (req, res) => {
    const id = Number(req.params.id);
    const db = getDb();
    const existing = db.prepare('SELECT * FROM addresses WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such address' } });
    }
    const { error, value } = validate({ ...existing, ...req.body });
    if (error) return res.status(400).json({ error: { code: 'invalid', message: error } });
    const run = db.transaction(() => {
      if (value.is_default) db.prepare('UPDATE addresses SET is_default = 0 WHERE id != ?').run(id);
      db.prepare(
        `UPDATE addresses SET name=?, phone=?, pincode=?, line1=?, line2=?, city=?, state=?, is_default=? WHERE id=?`
      ).run(
        value.name,
        value.phone,
        value.pincode,
        value.line1,
        value.line2,
        value.city,
        value.state,
        value.is_default,
        id
      );
    });
    run();
    res.json(shape(db.prepare('SELECT * FROM addresses WHERE id = ?').get(id)));
  })
);

r.delete(
  '/:id',
  h(async (req, res) => {
    const info = getDb().prepare('DELETE FROM addresses WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such address' } });
    }
    res.json({ ok: true });
  })
);

export default r;
