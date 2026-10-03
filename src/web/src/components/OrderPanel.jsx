import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr, openStream } from '../lib/api.js';
import { Button, Pill } from './ui.jsx';
import { useToast } from './Toasts.jsx';

/**
 * Order panel — product fetch hone ke baad wahin se:
 * section → address → qty → price check (per-account real quote + TOTAL) → Book → live progress.
 * props: { product } — fetched product row (id, price, …).
 */
export default function OrderPanel({ product }) {
  const toast = useToast();
  const [sections, setSections] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [sectionId, setSectionId] = useState('');
  const [addressId, setAddressId] = useState('');
  const [qty, setQty] = useState('1');
  const [qtyMode, setQtyMode] = useState('total');
  const [perAcc, setPerAcc] = useState('1');
  const [booking, setBooking] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([api('/sections'), api('/addresses')])
      .then(([s, a]) => {
        setSections(s.items);
        setAddresses(a.items);
        // default: pehla section jisme active accounts hon (0-active kabhi default nahi)
        const withActive = s.items.filter((x) => x.active > 0);
        const defSec = withActive[0] || s.items[0];
        if (defSec) setSectionId(String(defSec.id));
        const defAddr = a.items.find((x) => x.is_default) || a.items[0];
        if (defAddr) setAddressId(String(defAddr.id));
      })
      .catch(() => {});
  }, []);

  // live quote/order updates (SSE)
  useEffect(() => {
    if (!booking?.id) return;
    const refresh = () => refreshBooking().catch(() => {});
    const es = openStream({
      booking_status: (d) => {
        if (d.bookingId === booking.id) refresh();
      },
      captcha_pending: (d) => {
        if (d.bookingId === booking.id) refresh();
      },
      order_placed: (d) => {
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

  const secObj = sections.find((s) => String(s.id) === sectionId);
  const freeActive = secObj ? Math.max(0, secObj.active - secObj.booked) : 0;
  const needAccounts = Math.max(1, Number(qty) || 1);
  const shortBy = needAccounts - freeActive;
  const noRefs = sections.length === 0 || addresses.length === 0;
  const canQuote =
    !!product?.id && !!sectionId && !!addressId && shortBy <= 0 && !busy && !noRefs;

  const startQuote = async () => {
    if (!canQuote) return;
    setBusy(true);
    setErr('');
    try {
      // purana active quote ho to cancel (zombie jobs bachao)
      if (booking && ['quoting', 'quoted'].includes(booking.status)) {
        await api(`/bookings/${booking.id}/cancel`, { method: 'POST' }).catch(() => {});
        setBooking(null);
      }
      const b = await api('/bookings', {
        method: 'POST',
        body: {
          product_id: product.id,
          section_id: Number(sectionId),
          address_id: Number(addressId),
          qty: Number(qty),
          qty_mode: qtyMode,
          per_acc_qty: Number(perAcc),
        },
      });
      setBooking(b);
    } catch (e) {
      if (e.code === 'insufficient') {
        setErr(`${e.message} — ya qty kam karo, ya section me active accounts badhao.`);
      } else {
        setErr(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const doConfirm = async () => {
    setBusy(true);
    setErr('');
    try {
      const b = await api(`/bookings/${booking.id}/confirm`, { method: 'POST' });
      setBooking(b);
      toast('Orders chalu — checkout flow chal raha hai', 'success');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const requoteBooking = async () => {
    setBusy(true);
    setErr('');
    try {
      const b = await api(`/bookings/${booking.id}/requote`, { method: 'POST' });
      setBooking(b);
      toast('Re-quote chalu — price checks dobara chal rahe hain', 'success');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelBooking = async () => {
    if (!window.confirm('Booking cancel karein? Queued jobs fail ho jayenge.')) return;
    try {
      await api(`/bookings/${booking.id}/cancel`, { method: 'POST' });
      setBooking(null);
      toast('Booking cancel ho gayi', 'warn');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const resetQuote = () => {
    setBooking(null);
    setErr('');
  };

  if (!product?.id) return null;

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          Order setup
        </h2>
        <span className="small muted">is product par yahi se quote &amp; book karo</span>
      </div>

      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0, flex: '1 1 220px' }}>
          <label htmlFor="op-section">Section (accounts ka group)</label>
          {sections.length === 0 ? (
            <div className="hint">
              Koi section nahi — <Link to="/settings">Settings → Sections</Link> me banao, phir
              accounts ko assign karo.
            </div>
          ) : (
            <select
              id="op-section"
              className="input"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
            >
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — {s.active} active, {s.booked} booked
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="field" style={{ margin: 0, flex: '1 1 220px' }}>
          <label htmlFor="op-address">Delivery address (sirf hamara)</label>
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

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="op-mode">Qty mode</label>
          <select
            id="op-mode"
            className="input"
            value={qtyMode}
            onChange={(e) => setQtyMode(e.target.value)}
          >
            <option value="total">Total orders (N × 1)</option>
            <option value="per_account">Per account (har account × qty)</option>
          </select>
        </div>

        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="op-qty">{qtyMode === 'total' ? 'Total orders' : 'Accounts'}</label>
          <input
            id="op-qty"
            className="input"
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            style={{ width: 100 }}
          />
        </div>

        {qtyMode === 'per_account' && (
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="op-per">Qty per account</label>
            <input
              id="op-per"
              className="input"
              type="number"
              min={1}
              value={perAcc}
              onChange={(e) => setPerAcc(e.target.value)}
              style={{ width: 100 }}
            />
          </div>
        )}
      </div>

      <div className="hint" style={{ marginTop: 8 }}>
        Sirf free (non-booked) active accounts allocate honge · checkout par price, COD aur stock
        phir se check hoga · address sirf hamara use hoga.
      </div>

      {secObj && shortBy > 0 && (
        <div className="error-text">
          {secObj.name} me sirf {freeActive} free active account hain (chahiye {needAccounts}) — ya
          qty kam karo, ya accounts login / assign karo.
        </div>
      )}
      {err && <div className="error-text">{err}</div>}

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <Button variant="primary" onClick={startQuote} disabled={!canQuote}>
          {busy ? 'Allocating…' : 'Price check & quote →'}
        </Button>
        {!booking && (
          <span className="small muted">
            Step: har account ka real price aayega → TOTAL dekh ke Book karoge.
          </span>
        )}
      </div>

      {booking && (
        <QuoteTable
          booking={booking}
          busy={busy}
          onRefresh={refreshBooking}
          onConfirm={doConfirm}
          onRequote={requoteBooking}
          onCancel={cancelBooking}
          onReset={resetQuote}
        />
      )}
    </div>
  );
}

/** Per-account real price table + TOTAL → Book / progress / failure recovery. */
function QuoteTable({ booking, busy, onRefresh, onConfirm, onRequote, onCancel, onReset }) {
  const rows = booking.orders || [];
  const priced = rows.filter((r) => r.price != null);
  const missing = rows.filter((r) => r.price == null).length;
  const totalAmount = priced.reduce((s, r) => s + (r.price || 0) * r.qty, 0);
  const status = booking.status;
  const quoting = status === 'quoting';
  const quoted = status === 'quoted';
  const running = status === 'running';
  const done = status === 'done';
  const failed = status === 'failed' || status === 'cancelled';
  const canRequote = ['quoting', 'quoted', 'failed'].includes(status);

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #eee', paddingTop: 14 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>
          Quote — {rows.length} order(s)
        </h3>
        <Pill status={status} />
      </div>

      {quoting && (
        <div className="hint" style={{ marginBottom: 10 }}>
          Har account ke session se real price check ho raha hai… ({booking.progress}/
          {booking.total} done)
        </div>
      )}
      {failed && (
        <div className="error-text" style={{ marginBottom: 10 }}>
          {booking.error ||
            'Quote / order fail ho gaya — Accounts me OTP login / session check karo, phir se quote karo.'}
        </div>
      )}

      <div className="table-wrap">
        <table className="table responsive">
          <thead>
            <tr>
              <th>#</th>
              <th>Account</th>
              <th>Qty</th>
              <th>Real price</th>
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
                  {o.account_label && (
                    <span className="muted small"> · {o.identifier || o.account_masked}</span>
                  )}
                </td>
                <td data-label="Qty" className="num">
                  {o.qty}
                </td>
                <td data-label="Real price" className="num">
                  {o.price != null ? (
                    <b>{inr(o.price * o.qty)}</b>
                  ) : o.error ? (
                    <span className="small" style={{ color: 'var(--red, #d33)' }}>
                      {String(o.error).slice(0, 40)}
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
                  ) : o.price != null ? (
                    <Pill status="ok">quoted</Pill>
                  ) : (
                    <Pill status="quoting" />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td data-label="" colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>
                TOTAL ({priced.length}/{rows.length} quoted)
              </td>
              <td data-label="" className="num" style={{ fontWeight: 800, fontSize: 16 }}>
                {inr(booking.total_amount ?? totalAmount)}
              </td>
              <td data-label=""></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        {quoting && (
          <>
            <Button variant="outline" onClick={onRefresh} disabled={busy}>
              ↻ Refresh quotes
            </Button>
            <Button variant="primary" disabled>
              Quoting… {booking.progress}/{booking.total}
            </Button>
            <Button variant="danger" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </>
        )}
        {quoted && (
          <>
            <Button variant="primary" onClick={onConfirm} disabled={busy}>
              {busy
                ? 'Starting…'
                : `Book ${rows.length} order(s) — ${inr(booking.total_amount ?? totalAmount)}`}
            </Button>
            {missing > 0 && canRequote && (
              <Button variant="outline" onClick={onRequote} disabled={busy}>
                ↻ Re-quote pending ({missing})
              </Button>
            )}
            <Button variant="outline" onClick={onRefresh} disabled={busy}>
              ↻ Refresh
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </>
        )}
        {(running || done) && (
          <>
            <Link to="/orders">
              <Button variant="primary">
                Orders page → ({booking.progress}/{booking.total})
              </Button>
            </Link>
            <Button variant="outline" onClick={onRefresh} disabled={busy}>
              ↻ Refresh
            </Button>
          </>
        )}
        {failed && (
          <>
            {status === 'failed' && canRequote && (
              <Button variant="primary" onClick={onRequote} disabled={busy}>
                {busy ? 'Re-quoting…' : '↻ Re-quote (same accounts)'}
              </Button>
            )}
            <Button variant={status === 'failed' ? 'outline' : 'primary'} onClick={onReset}>
              ← Wapas quote karo
            </Button>
            <Link to="/orders">
              <Button variant="ghost">Orders page →</Button>
            </Link>
          </>
        )}
        {(running || done) && (
          <Button variant="ghost" onClick={onReset}>
            Naya quote
          </Button>
        )}
      </div>
    </div>
  );
}
