import { getDb } from '../db/index.js';
import { now } from '../shared/constants.js';

// ── Handler registry ────────────────────────────────────────
const handlers = new Map();

export function registerHandler(type, fn) {
  handlers.set(type, fn);
}

export function enqueue(type, refId = null) {
  const t = now();
  const info = getDb()
    .prepare(
      `INSERT INTO jobs (type, ref_id, status, attempts, created_at, updated_at)
       VALUES (?, ?, 'queued', 0, ?, ?)`
    )
    .run(type, refId, t, t);
  return info.lastInsertRowid;
}

export function getJob(id) {
  return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

/**
 * Job ke done/failed hone ka wait (API synchronous OTP response ke liye).
 * Timeout par `{...job, status:'timeout'}` — job background me chalta rehta hai.
 */
export function waitForJob(id, { timeoutMs = 90000, pollMs = 250 } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const job = getJob(id);
      if (job && (job.status === 'done' || job.status === 'failed')) return resolve(job);
      if (Date.now() - start >= timeoutMs) return resolve({ ...(job || {}), status: 'timeout' });
      setTimeout(check, pollMs);
    };
    check();
  });
}

function claimNext() {
  const db = getDb();
  // OTP jobs interactive hain — health/scan batch ke aage priority (UX)
  const row = db
    .prepare(
      `SELECT * FROM jobs WHERE status = 'queued'
       ORDER BY CASE WHEN type IN ('otp_request','otp_verify') THEN 0 ELSE 1 END,
                created_at ASC, id ASC
       LIMIT 1`
    )
    .get();
  if (!row) return null;
  db.prepare(
    `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`
  ).run(now(), row.id);
  return { ...row, attempts: row.attempts + 1 };
}

const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = [5000, 15000, 45000];
const parkedUntil = new Map(); // jobId -> epoch ms (backoff)

/**
 * Single-flight poll loop — ek time pe ek hi job (rate-limit safe, TRD §6).
 * Chalta hai har 1.5s; `startWorker()` se on karo.
 */
export function startWorker({ intervalMs = 1500, onEvent = () => {} } = {}) {
  let timer = null;
  let busy = false;

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const t = now();
      for (const [jobId, until] of parkedUntil) {
        if (until <= t) parkedUntil.delete(jobId);
      }
      const job = claimNext();
      if (job && !parkedUntil.has(job.id)) {
        const handler = handlers.get(job.type);
        if (!handler) {
          fail(job, `no handler for type "${job.type}"`, false);
        } else {
          try {
            await handler(job);
            const db = getDb();
            db.prepare(`UPDATE jobs SET status = 'done', updated_at = ? WHERE id = ?`).run(
              now(),
              job.id
            );
            onEvent({ type: 'job_done', job });
          } catch (err) {
            // err.noRetry (user errors: invalid OTP, rate limit) → turant fail
            fail(job, err.message || String(err), !err.noRetry, onEvent);
          }
        }
      }
    } catch (err) {
      console.error('[worker] tick error:', err);
    } finally {
      busy = false;
    }
  }

  function fail(job, message, retryable, emit = onEvent) {
    const db = getDb();
    const attempts = job.attempts;
    if (retryable && attempts < MAX_ATTEMPTS) {
      const backoff = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
      parkedUntil.set(job.id, now() + backoff);
      db.prepare(
        `UPDATE jobs SET status = 'queued', last_error = ?, updated_at = ? WHERE id = ?`
      ).run(message, now(), job.id);
    } else {
      db.prepare(
        `UPDATE jobs SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`
      ).run(message, now(), job.id);
      emit({ type: 'job_failed', job, error: message });
    }
  }

  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  console.log(`[worker] queue loop started (every ${intervalMs}ms, single-flight)`);

  return {
    stop: () => clearInterval(timer),
    tickNow: tick,
  };
}
