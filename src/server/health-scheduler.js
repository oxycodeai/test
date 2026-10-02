// Periodic session health sweep (F3, TRD §9).
// har health_interval_min (default 10) pe active accounts ke health jobs queue.
import { getDb, getSetting, setSetting } from '../db/index.js';
import { enqueue } from '../worker/queue.js';

const LAST_KEY = 'last_health_sweep';

export function startHealthScheduler({ intervalMs = 60_000 } = {}) {
  const tick = () => {
    try {
      const ivMin = parseInt(getSetting('health_interval_min') || '', 10) || 10;
      const last = parseInt(getSetting(LAST_KEY) || '0', 10) || 0;
      if (Date.now() - last < ivMin * 60_000) return;
      setSetting(LAST_KEY, String(Date.now()));

      const db = getDb();
      const active = db.prepare(`SELECT id FROM accounts WHERE status = 'active'`).all();
      if (!active.length) return;
      const busy = db
        .prepare(
          `SELECT COUNT(*) n FROM jobs WHERE type = 'health' AND status IN ('queued','running')`
        )
        .get().n;
      if (busy > 0) return; // pichla batch abhi chal raha — agla sweep dobara try karega

      for (const a of active) enqueue('health', a.id);
      console.log(`[health] sweep queued for ${active.length} active account(s)`);
    } catch (e) {
      console.warn('[health] sweep error:', e.message);
    }
  };
  const t = setInterval(tick, intervalMs);
  t.unref?.();
  return () => clearInterval(t);
}
