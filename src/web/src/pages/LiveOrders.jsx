import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr, timeAgo, openStream } from '../lib/api.js';
import { Button, Pill, EmptyState, Skeleton } from '../components/ui.jsx';
import { ORDER_STEPS, stepIndex, stepLabel } from '../../../shared/steps.js';

const DETAIL_IDS = 6; // latest kitni bookings ka detail load karna hai

/**
 * Live Progress — saari bookings ka real-time view.
 * Active booking me full attempt table + stepper; terminal cards compact.
 * SSE se live updates (step patch + throttled refresh).
 */
export default function LiveOrders() {
  const [list, setList] = useState(null);
  const [details, setDetails] = useState({}); // bookingId -> detail
  const refreshTimer = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await api('/bookings');
      setList(r.items);
      const ids = r.items.slice(0, DETAIL_IDS).map((b) => b.id);
      const pairs = await Promise.all(
        ids.map((id) => api(`/bookings/${id}`).then((d) => [id, d]).catch(() => null))
      );
      setDetails((prev) => {
        const next = { ...prev };
        for (const p of pairs) if (p) next[p[0]] = p[1];
        return next;
      });
    } catch {
      /* list already set / network flap — next event retry */
    }
  }, []);

  // SSE — order_step seedha patch, baaki events throttled refresh (2s)
  useEffect(() => {
    load();
    const throttled = () => {
      if (refreshTimer.current) return;
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        load();
      }, 2000);
    };
    const es = openStream({
      booking_status: throttled,
      captcha_pending: throttled,
      order_placed: throttled,
      job_done: throttled,
      job_failed: throttled,
      order_step: (d) => {
        setDetails((prev) => {
          const b = prev[d.bookingId];
          if (!b) return prev;
          return {
            ...prev,
            [d.bookingId]: {
              ...b,
              orders: (b.orders || []).map((o) =>
                o.id === d.orderId ? { ...o, step: d.step } : o
              ),
            },
          };
        });
        throttled();
      },
    });
    return () => {
      es.close();
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
  }, [load]);

  if (!list) return <Skeleton h={200} />;

  const ACTIVE = ['running', 'quoting', 'quoted'];
  const active = list.filter((b) => ACTIVE.includes(b.status));
  const rest = list.filter((b) => !ACTIVE.includes(b.status));

  return (
    <div>
      <div className="page-head">
        <h1>Live Progress</h1>
        <p>
          {active.length > 0
            ? `${active.length} booking chal rahi hai — steps live update ho rahe hain.`
            : 'Koi booking active nahi — Fetch page se naya order start karo.'}
        </p>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon="▶"
          title="Abhi tak koi booking nahi"
          hint="Fetch page se product lo → Order setup me Start karo."
          action={
            <Link to="/fetch">
              <button className="btn primary sm">Go to Fetch &amp; Order</button>
            </Link>
          }
        />
      ) : (
        <>
          {active.map((b) => (
            <ActiveCard key={b.id} summary={b} detail={details[b.id]} />
          ))}
          {rest.length > 0 && (
            <>
              <h2 style={{ fontSize: 15, margin: '18px 0 8px' }}>Recent</h2>
              <div className="table-wrap">
                <table className="table responsive">
                  <thead>
                    <tr>
                      <th>Booking</th>
                      <th>Plan</th>
                      <th>Progress</th>
                      <th>Status</th>
                      <th>Updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rest.map((b) => {
                      const d = details[b.id];
                      const placed = (d?.orders || []).filter(
                        (o) => o.captcha_state === 'placed'
                      ).length;
                      return (
                        <tr key={b.id}>
                          <td data-label="Booking">
                            #{b.id} {(b.product_title || '').slice(0, 34)}
                          </td>
                          <td data-label="Plan" className="small">
                            {b.n_accounts ?? 1}×{b.attempts_per_acc ?? 1} · Q={b.qty_per_cart ?? b.qty}
                            {b.max_price ? ` · ≤${inr(b.max_price)}` : ''}
                          </td>
                          <td data-label="Progress" className="num">
                            {b.progress}/{b.total}
                            {placed > 0 ? ` · ${placed} placed` : ''}
                          </td>
                          <td data-label="Status">
                            <Pill status={b.status} />
                          </td>
                          <td data-label="Updated" className="muted small">
                            {timeAgo(b.updated_at)}
                          </td>
                          <td data-label="">
                            <Link to="/orders">
                              <Button size="sm" variant="ghost">
                                Orders →
                              </Button>
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Active booking card — plan + affiliate line + stepper + attempt rows. */
function ActiveCard({ summary, detail }) {
  const b = detail || summary;
  const rows = b.orders || [];
  const status = b.status;
  const running = status === 'running';
  const activeOrder = rows.find(
    (o) => o.captcha_state !== 'placed' && o.captcha_state !== 'failed' && !o.error
  );
  const currentStep = activeOrder?.step ?? null;
  let affHost = '';
  try {
    affHost = new URL(b.affiliate_url || '').hostname.replace(/^www\./, '');
  } catch {
    affHost = '';
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>
          #{b.id} {(b.product_title || 'Product').slice(0, 52)}
        </h3>
        <Pill status={status} />
      </div>

      <div className="small muted" style={{ marginBottom: 8 }}>
        {b.n_accounts ?? 1} account × {b.attempts_per_acc ?? 1} order · Q={b.qty_per_cart ?? b.qty}
        {b.max_price ? ` · bill ≤ ${inr(b.max_price)}` : ''} · {b.progress}/{b.total} done
        {affHost ? ` · ${affHost} link` : ''}
      </div>

      {running && currentStep && (
        <div className="stepper" role="list" aria-label="Checkout steps">
          {ORDER_STEPS.map((s, i) => {
            const cur = stepIndex(currentStep);
            const state = cur < 0 ? 'todo' : i < cur ? 'done' : i === cur ? 'now' : 'todo';
            return (
              <div key={s.key} className={`step ${state}`} role="listitem">
                <span className="dot">{state === 'done' ? '✓' : state === 'now' ? '▶' : ''}</span>
                <span className="lbl">{s.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {rows.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table className="table responsive">
            <thead>
              <tr>
                <th>#</th>
                <th>Account</th>
                <th>Attempt</th>
                <th>Qty</th>
                <th>Bill</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o, i) => (
                <tr key={o.id}>
                  <td data-label="#" className="num">
                    {i + 1}
                  </td>
                  <td data-label="Account">
                    {o.account_label || o.identifier || o.account_masked}
                  </td>
                  <td data-label="Attempt" className="num">
                    {o.attempt_no}/{b.attempts_per_acc ?? 1}
                  </td>
                  <td data-label="Qty" className="num">
                    {o.qty}
                  </td>
                  <td data-label="Bill" className="num">
                    {o.price != null ? (
                      <b>{inr(o.price)}</b>
                    ) : o.error ? (
                      <span
                        className="small"
                        style={{ color: 'var(--red, #d33)' }}
                        title={String(o.error)}
                      >
                        {String(o.error).slice(0, 80)}
                      </span>
                    ) : (
                      <span className="muted">…</span>
                    )}
                  </td>
                  <td data-label="Status">
                    {o.captcha_state === 'placed' ? (
                      <Pill status="placed">{o.order_ref || 'placed'}</Pill>
                    ) : o.captcha_state === 'pending' ? (
                      <Pill status="pending">captcha</Pill>
                    ) : o.captcha_state === 'failed' || o.error ? (
                      <Pill status="failed" />
                    ) : running ? (
                      <Pill status="quoting">
                        {o.step ? stepLabel(o.step) : 'start ho raha hai…'}
                      </Pill>
                    ) : (
                      <Pill status="ok">queued</Pill>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {b.error && <div className="error-text">{b.error}</div>}

      <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
        <Link to="/orders">
          <Button size="sm" variant="outline">
            Orders page →
          </Button>
        </Link>
      </div>
    </div>
  );
}
