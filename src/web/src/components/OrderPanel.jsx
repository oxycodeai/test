import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr, openStream } from '../lib/api.js';
import { Button, Pill } from './ui.jsx';
import { useToast } from './Toasts.jsx';
import { ORDER_STEPS, stepIndex, stepLabel } from '../../../shared/steps.js';

/** affiliate_url se host nikal — "Ye order <host> link se chal raha hai" line ke liye. */
function hostOf(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const intOr = (v, def) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 1 ? n : def;
};

/**
 * Order panel — N accounts × A attempts, har cart me Q qty, bill ≤ max_price,
 * address select. Start karte hi booking running + live attempt rows.
 * props: { product } (legacy fetch mode) ya { url } (fetch-page hata diya —
 * link paste → Start, product andar resolve hota hai).
 */
export default function OrderPanel({ product = null, url = '' }) {
  const toast = useToast();
  const [sections, setSections] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [sectionId, setSectionId] = useState(''); // '' = sabhi sections
  const [addressId, setAddressId] = useState('');
  const [nAcc, setNAcc] = useState('1');
  const [qtyCart, setQtyCart] = useState('1');
  const [attempts, setAttempts] = useState('1');
  const [maxPrice, setMaxPrice] = useState('');
  const [booking, setBooking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [codCheck, setCodCheck] = useState(null); // url mode: {ok,title} | null (unknown/checking)

  useEffect(() => {
    Promise.all([api('/sections'), api('/addresses')])
      .then(([s, a]) => {
        setSections(s.items);
        setAddresses(a.items);
        const withActive = s.items.filter((x) => x.active > 0);
        const defSec = withActive[0] || s.items[0];
        if (defSec) setSectionId(String(defSec.id));
        const defAddr = a.items.find((x) => x.is_default) || a.items[0];
        if (defAddr) setAddressId(String(defAddr.id));
      })
      .catch(() => {});
  }, []);

  // url mode: link paste karte hi pehle se COD check (server cached resolve —
  // 15 min). COD nahi hai to Start SE PEHLE warning + Start block. Fail pe
  // unknown — server ka 409 gate Start pe phir bhi protect karega.
  useEffect(() => {
    const u = url.trim();
    setCodCheck(product || !u ? null : 'checking');
    if (product || !u) return undefined;
    let alive = true;
    const t = setTimeout(() => {
      api('/products/fetch', { method: 'POST', body: { url: u } })
        .then((p) => {
          if (alive) setCodCheck({ ok: !!p.cod_product, title: p.title });
        })
        .catch(() => {
          if (alive) setCodCheck('fail');
        });
    }, 800);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [url, product]);

  // live updates (SSE) — har event pe pura booking refresh
  useEffect(() => {
    if (!booking?.id) return;
    const refresh = () => refreshBooking().catch(() => {});
    const es = openStream({
      booking_status: (d) => {
        if (d.bookingId === booking.id) refresh();
      },
      order_step: (d) => {
        if (d.bookingId !== booking.id) return;
        setBooking((b) =>
          b
            ? { ...b, orders: (b.orders || []).map((o) => (o.id === d.orderId ? { ...o, step: d.step } : o)) }
            : b
        );
      },
      captcha_pending: (d) => {
        if (d.bookingId === booking.id) refresh();
      },
      order_placed: (d) => {
        if (d.bookingId === booking.id) refresh();
      },
      order_failed: (d) => {
        if (d.bookingId === booking.id) refresh();
      },
      job_done: refresh,
      job_failed: refresh,
    });
    return () => es.close();
  }, [booking?.id]);

  const refreshBooking = async () => {
    if (!booking?.id) return;
    const b = await api(`/bookings/${booking.id}`);
    setBooking(b);
  };

  const N = intOr(nAcc, 1);
  const Q = intOr(qtyCart, 1);
  const A = intOr(attempts, 1);
  const secObj = sections.find((s) => String(s.id) === sectionId);
  const freeActive = secObj ? Math.max(0, secObj.active - secObj.booked) : null;
  const noRefs = sections.length === 0 || addresses.length === 0;
  const hasTarget = !!product?.id || !!url.trim();
  // COD gate hata diya — COD dynamic hai (kisi account pe aata hai, kisi nahi):
  // Start ALLOWED; attempt ke time payment page pe check hota hai (COD_MISSING
  // → sirf wo attempt skip, baaki attempts chalte rahenge).
  const canStart =
    hasTarget && !!addressId && !busy && !noRefs && (!secObj || freeActive >= N);

  const startBooking = async () => {
    if (!canStart) return;
    setBusy(true);
    setErr('');
    try {
      const b = await api('/bookings', {
        method: 'POST',
        body: {
          ...(product?.id ? { product_id: product.id } : { url: url.trim() }),
          section_id: sectionId === '' ? null : Number(sectionId),
          address_id: Number(addressId),
          n_accounts: N,
          qty_per_cart: Q,
          attempts_per_acc: A,
          max_price: maxPrice === '' ? null : Number(String(maxPrice).replace(/[^\d]/g, '')),
        },
      });
      setBooking(b);
      toast(`Order chalu — ${N} account × ${A} attempt = ${N * A} row(s)`, 'success');
    } catch (e) {
      if (e.code === 'insufficient') {
        setErr(`${e.message} — N kam karo ya accounts login/assign karo.`);
      } else {
        setErr(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const cancelBooking = async () => {
    if (!window.confirm('Order cancel karein? Queued jobs fail ho jayenge.')) return;
    try {
      await api(`/bookings/${booking.id}/cancel`, { method: 'POST' });
      setBooking(null);
      toast('Booking cancel ho gayi', 'warn');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const resetBooking = () => {
    setBooking(null);
    setErr('');
  };

  if (!product?.id && !url.trim()) return null;

  if (booking) {
    return (
      <div className="card">
        <AttemptView
          booking={booking}
          busy={busy}
          onRefresh={refreshBooking}
          onCancel={cancelBooking}
          onReset={resetBooking}
        />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          Order setup
        </h2>
        <span className="small muted">N accounts × A orders, har cart me Q qty</span>
      </div>

      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0, flex: '1 1 200px' }}>
          <label htmlFor="op-section">Section (accounts ka group)</label>
          {sections.length === 0 ? (
            <div className="hint">
              Koi section nahi — <Link to="/settings">Settings → Sections</Link> me banao.
            </div>
          ) : (
            <select
              id="op-section"
              className="input"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              <option value="">Sabhi sections</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.active} active, {s.booked} booked
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="op-n">Kitne accounts (N)</label>
          <input
            id="op-n"
            className="input"
            type="number"
            min={1}
            value={nAcc}
            onChange={(e) => setNAcc(e.target.value)}
            style={{ width: 92 }}
          />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="op-q">Qty per cart (Q)</label>
          <input
            id="op-q"
            className="input"
            type="number"
            min={1}
            value={qtyCart}
            onChange={(e) => setQtyCart(e.target.value)}
            style={{ width: 92 }}
          />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="op-a">Orders per account (A)</label>
          <input
            id="op-a"
            className="input"
            type="number"
            min={1}
            value={attempts}
            onChange={(e) => setAttempts(e.target.value)}
            style={{ width: 92 }}
          />
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="op-max">Max price ₹ (cart bill)</label>
          <input
            id="op-max"
            className="input"
            type="number"
            min={1}
            placeholder="jaise 1000"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            style={{ width: 130 }}
          />
        </div>

        <div className="field" style={{ margin: 0, flex: '1 1 220px' }}>
          <label htmlFor="op-address">Delivery address</label>
          {addresses.length === 0 ? (
            <div className="hint">
              Koi address nahi — <Link to="/settings">Settings → Address Book</Link> me add karo.
            </div>
          ) : (
            <select
              id="op-address"
              className="input"
              value={addressId}
              onChange={(e) => setAddressId(e.target.value)}
            >
              {addresses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}, {a.city} {a.pincode} {a.is_default ? '· default' : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      <div className="hint" style={{ marginTop: 8 }}>
        Plan: <b>{N}</b> account × <b>{A}</b> order = <b>{N * A}</b> row(s), har cart me{' '}
        <b>{Q}</b> qty · cart ka final bill max price se kam hona chahiye · address sirf hamara ·
        affiliate link aapki.
      </div>

      {secObj && freeActive < N && (
        <div className="error-text">
          {secObj.name} me sirf {freeActive} free active account hain (chahiye {N}) — N kam karo,
          ya accounts login / assign karo.
        </div>
      )}
      {product && !product.cod_product && (
        <div className="hint" style={{ marginTop: 8 }}>
          ⚠ COD fetch me nahi dikha — COD dynamic hai: attempt ke time payment page pe check
          hoga. Agar us account pe COD nahi aaya to sirf wo attempt skip, baaki attempts chalte
          rahenge.
        </div>
      )}
      {!product && codCheck && typeof codCheck === 'object' && !codCheck.ok && (
        <div className="hint" style={{ marginTop: 8 }}>
          ⚠ Link pe COD check me nahi dikha ({codCheck.title || 'link check hua'}) — attempt ke
          time payment page pe dobara check hoga (COD dynamic hai).
        </div>
      )}
      {!product && codCheck === 'checking' && (
        <div className="hint" style={{ marginTop: 8 }}>
          Link ka COD check ho raha hai…
        </div>
      )}
      {!product && codCheck === 'fail' && (
        <div className="hint" style={{ marginTop: 8 }}>
          COD check nahi hua (network/parse) — Start pe server khud check karega.
        </div>
      )}
      {err && <div className="error-text">{err}</div>}

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <Button variant="primary" onClick={startBooking} disabled={!canStart}>
          {busy
            ? 'Starting… (product resolve ho raha hai)'
            : `Start — ${N * A} order(s) chalu →`}
        </Button>
        <span className="small muted">
          {busy
            ? 'Link resolve + COD check ho raha hai — max ~20s, error yahin dikhega.'
            : 'Start karte hi har attempt fresh browser me aapki affiliate link se chalega.'}
        </span>
      </div>
    </div>
  );
}

/** Live attempt view — N×A rows, stepper, progress, cancel/reset. */
function AttemptView({ booking, busy, onRefresh, onCancel, onReset }) {
  const rows = booking.orders || [];
  const status = booking.status;
  const running = status === 'running';
  const done = status === 'done';
  const failed = status === 'failed';
  const cancelled = status === 'cancelled';
  const terminal = done || failed || cancelled;
  const affHost = hostOf(booking.affiliate_url);
  const activeOrder = rows.find(
    (o) => o.captcha_state !== 'placed' && o.captcha_state !== 'failed' && !o.error
  );
  const currentStep = done ? 'done' : activeOrder?.step ?? null;
  const placed = rows.filter((o) => o.captcha_state === 'placed').length;
  const totalAmount = rows.reduce((s, r) => s + (r.price || 0), 0);

  return (
    <div>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>
          Live orders — {rows.length} attempt(s) · {booking.progress}/{booking.total} done
        </h3>
        <Pill status={status} />
      </div>

      {affHost && (
        <div
          className="hint"
          style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--green, #2e9e44)',
              display: 'inline-block',
              flexShrink: 0,
            }}
          />
          Ye order <b>&nbsp;{affHost}&nbsp;</b> ki affiliate link se chal raha hai — tracking
          aapki link par lagegi.
        </div>
      )}

      {running && currentStep !== null && currentStep !== undefined && (
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

      {terminal && (
        <div
          className={failed || cancelled ? 'error-text' : 'hint'}
          style={{ marginBottom: 10 }}
        >
          {failed
            ? booking.error || 'Kuch attempts fail hue — neeche row-wise detail dekho.'
            : cancelled
              ? 'Booking cancel ho gayi.'
              : `Sab done — ${placed}/${rows.length} order(s) placed.`}
        </div>
      )}

      <div className="table-wrap">
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
                  {o.attempt_no}/{booking.attempts_per_acc ?? 1}
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
          <tfoot>
            <tr>
              <td data-label="" colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>
                TOTAL bill ({placed}/{rows.length} placed)
              </td>
              <td data-label="" className="num" style={{ fontWeight: 800, fontSize: 16 }}>
                {inr(totalAmount)}
              </td>
              <td data-label=""></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        {(running || done) && (
          <Link to="/orders">
            <Button variant="primary">
              Orders page → ({booking.progress}/{booking.total})
            </Button>
          </Link>
        )}
        <Link to="/live">
          <Button variant="ghost">Live Progress →</Button>
        </Link>
        <Button variant="outline" onClick={onRefresh} disabled={busy}>
          ↻ Refresh
        </Button>
        {running && (
          <Button variant="danger" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        )}
        {terminal && (
          <Button variant="ghost" onClick={onReset}>
            ← Naya order
          </Button>
        )}
      </div>
    </div>
  );
}
