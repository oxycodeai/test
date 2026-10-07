import { Router } from 'express';
import { h } from '../middleware/error.js';
import { getDb } from '../../db/index.js';
import { maskIdentifier } from '../../shared/constants.js';
import {
  importNumbers,
  listNumbers,
  claimForAccount,
  releaseNumber,
} from '../services/numberPool.js';

const r = Router();

r.get(
  '/',
  h(async (req, res) => {
    const raw = listNumbers(req.query.limit);
    const items = raw.map((n) => ({
      ...n,
      account_identifier: undefined,
      account_masked: n.account_identifier ? maskIdentifier(n.account_identifier) : null,
    }));
    const c = getDb()
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status = 'free' THEN 1 ELSE 0 END) AS free,
                SUM(CASE WHEN status = 'busy' THEN 1 ELSE 0 END) AS busy,
                SUM(CASE WHEN account_id IS NOT NULL THEN 1 ELSE 0 END) AS paired
         FROM number_pool`
      )
      .get();
    res.json({
      items,
      free: c.free || 0,
      busy: c.busy || 0,
      total: c.total || 0,
      paired: c.paired || 0,
    });
  })
);

/** Import invalid num — text body (file client se padh ke bhejta hai). */
r.post(
  '/import',
  h(async (req, res) => {
    const text = String(req.body?.text || '');
    if (!text.trim()) {
      return res.status(400).json({ error: { code: 'invalid', message: 'File khali hai' } });
    }
    const result = importNumbers(text);
    if (result.imported === 0) {
      return res.status(400).json({
        error: {
          code: 'invalid',
          message: result.invalid_lines
            ? `File me koi valid number nahi (sab galat lines: ${result.invalid_lines})`
            : 'File me koi valid number nahi mila (10-15 digit chahiye)',
        },
      });
    }
    res.status(201).json(result);
  })
);

/** Manual/ops claim — account ka FIX number (worker bhi isi ko call karta hai). */
r.post(
  '/claim',
  h(async (req, res) => {
    const orderId = Number(req.body?.order_id);
    const accountId = Number(req.body?.account_id);
    if (!orderId || !accountId) {
      return res
        .status(400)
        .json({ error: { code: 'invalid', message: 'order_id + account_id chahiye' } });
    }
    const out = claimForAccount(orderId, accountId);
    if (!out.ok) {
      return res.status(409).json({
        error: {
          code: out.reason === 'unpaired' ? 'no_invalid_number' : 'number_busy',
          message:
            out.reason === 'unpaired'
              ? 'Is account se invalid number connect nahi — Settings me Import Invalid Num karo'
              : 'Account ka fix number abhi kisi order me hai',
        },
      });
    }
    res.json({ number: out.number });
  })
);

r.post(
  '/release',
  h(async (req, res) => {
    const orderId = Number(req.body?.order_id);
    if (!orderId) {
      return res.status(400).json({ error: { code: 'invalid', message: 'order_id chahiye' } });
    }
    res.json({ ok: true, released: releaseNumber(orderId) });
  })
);

/** Sirf FREE delete — busy (payment chal rahi hai) protect. */
r.delete(
  '/:id',
  h(async (req, res) => {
    const db = getDb();
    const row = db.prepare('SELECT * FROM number_pool WHERE id = ?').get(Number(req.params.id));
    if (!row) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such number' } });
    }
    if (row.status === 'busy') {
      return res
        .status(409)
        .json({ error: { code: 'busy', message: 'Number abhi kisi order me hai — baad me delete karo' } });
    }
    db.prepare('DELETE FROM number_pool WHERE id = ?').run(row.id);
    res.json({ ok: true });
  })
);

/** Test/ops: saare FREE clear (busy nahi chhuega). */
r.delete(
  '/',
  h(async (req, res) => {
    const info = getDb().prepare("DELETE FROM number_pool WHERE status = 'free'").run();
    res.json({ ok: true, removed: info.changes });
  })
);

export default r;
