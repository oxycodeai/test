import { Router } from 'express';
import { h } from '../middleware/error.js';
import { getDb } from '../../db/index.js';
import { now, maskIdentifier } from '../../shared/constants.js';
import { enqueue, waitForJob } from '../../worker/queue.js';
import { assertLoginRate, setPendingOtp, latestRequestId } from '../../worker/otp-store.js';
import { deleteSession } from '../services/sessionStore.js';

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
      return res.status(409).json({
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
    const id = Number(req.params.id);
    deleteSession(id); // file + sessions row (account cascade se pehle)
    const info = getDb().prepare('DELETE FROM accounts WHERE id = ?').run(id);
    if (!info.changes) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such account' } });
    }
    res.json({ ok: true });
  })
);

// ── Phase 2: OTP login + health (F2, F3) ────────────────────

/** Job failure → HTTP mapping (heuristics — job row me sirf message hai). */
function jobErrorResponse(res, job) {
  if (job.status === 'timeout') {
    return res
      .status(504)
      .json({ error: { code: 'timeout', message: 'Flipkart me bahut delay — 30s baad retry karo' } });
  }
  const msg = job.last_error || 'Job failed';
  let status = 502;
  let code = 'upstream_error';
  if (/invalid otp/i.test(msg)) {
    status = 400;
    code = 'invalid_otp';
  } else if (/window.*khatam|expired/i.test(msg)) {
    status = 410;
    code = 'otp_expired';
  } else if (/rate limit/i.test(msg)) {
    status = 429;
    code = 'rate_limited';
  } else if (/block|throttl|otp screen|fail:/i.test(msg)) {
    status = 429;
    code = 'flipkart_blocked';
  } else if (/identifier/i.test(msg)) {
    status = 400;
    code = 'invalid';
  } else if (/nahi mila/i.test(msg)) {
    status = 404;
    code = 'not_found';
  }
  res.status(status).json({ error: { code, message: msg } });
}

async function runLoginJob(res, type, accountId, timeoutMs, okPayload) {
  const jobId = enqueue(type, accountId);
  const job = await waitForJob(jobId, { timeoutMs });
  if (job.status === 'done') return res.json(okPayload);
  return jobErrorResponse(res, job);
}

// Step 1 — Send OTP (page 5 min RAM me; response tab jab OTP screen aaye)
r.post(
  '/:id/otp-request',
  h(async (req, res) => {
    const accountId = Number(req.params.id);
    const acc = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!acc) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such account' } });
    }
    try {
      assertLoginRate();
    } catch (e) {
      return res.status(e.status || 429).json({
        error: { code: 'rate_limited', message: e.message },
      });
    }
    await runLoginJob(res, 'otp_request', accountId, 90000, {
      ok: true,
      accountId,
      otpRequestId: latestRequestId(accountId),
    });
  })
);

// Step 2 — Verify OTP → session save → status active
r.post(
  '/:id/login',
  h(async (req, res) => {
    const accountId = Number(req.params.id);
    const acc = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
    if (!acc) {
      return res.status(404).json({ error: { code: 'not_found', message: 'No such account' } });
    }
    const otp = String(req.body?.otp || '').replace(/\D/g, '');
    if (!/^\d{6}$/.test(otp)) {
      return res
        .status(400)
        .json({ error: { code: 'invalid', message: 'OTP 6 digit hona chahiye' } });
    }
    try {
      assertLoginRate();
    } catch (e) {
      return res.status(e.status || 429).json({
        error: { code: 'rate_limited', message: e.message },
      });
    }
    setPendingOtp(accountId, otp); // memory only — handler consume karega
    await runLoginJob(res, 'otp_verify', accountId, 60000, {
      ok: true,
      accountId,
      status: 'active',
    });
  })
);

// Batch health check — ids diye to wahi, warna sab active
r.post(
  '/health',
  h(async (req, res) => {
    const db = getDb();
    let ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      ids = db
        .prepare(`SELECT id FROM accounts WHERE status = 'active'`)
        .all()
        .map((x) => x.id);
    } else {
      ids = ids.map(Number).filter(Number.isFinite);
    }
    if (ids.length === 0) {
      return res.json({ queued: 0 });
    }
    for (const id of ids) enqueue('health', id);
    res.json({ queued: ids.length });
  })
);

export default r;
