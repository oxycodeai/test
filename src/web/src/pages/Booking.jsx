import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr, openStream } from '../lib/api.js';
import { Button, Pill, EmptyState, Skeleton } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';

const STEPS = ['Product', 'Section', 'Address', 'Quote & Book'];

/** Booking wizard â€” fetch â†’ allocate â†’ per-account real price table + TOTAL â†’ confirm. */
export default function Booking() {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [products, setProducts] = useState([]);
  const [sections, setSections] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);

  const [productId, setProductId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [addressId, setAddressId] = useState('');
  const [qty, setQty] = useState(1);
  const [qtyMode, setQtyMode] = useState('total');
  const [perAcc, setPerAcc] = useState(1);

  const [booking, setBooking] = useState(null); // quote response (orders[] live)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([api('/products'), api('/sections'), api('/addresses')])
      .then(([p, s, a]) => {
        setProducts(p.items);
        setSections(s.items.filter((x) => x.active > 0 || x.accounts > 0));
        setAddresses(a.items);
        if (p.items[0]) setProductId(String(p.items[0].id));
        if (s.items[0]) setSectionId(String(s.items[0].id));
        const def = a.items.find((x) => x.is_default) || a.items[0];
        if (def) setAddressId(String(def.id));
        setLoading(false);
      })
      .catch((e) => {
        toast(e.message, 'error');
        setLoading(false);
      });
  }, []);

  // quote ke baad live order rows (SSE se)
  useEffect(() => {
    if (!booking?.id) return;
    const es = openStream({
      captcha_pending: (d) => {
        if (d.bookingId === booking.id) refreshBooking().catch(() => {});
      },
      order_placed: (d) => {
        if (d.bookingId === booking.id) refreshBooking().catch(() => {});
      },
      job_done: () => refreshBooking().catch(() => {}),
    });
    return () => es.close();
  }, [booking?.id]);

  const refreshBooking = async () => {
    if (!booking?.id) return;
    const b = await api(`/bookings/${booking.id}`);
    setBooking(b);
  };

  const product = useMemo(
    () => products.find((p) => String(p.id) === productId),
    [products, productId]
  );

  const startQuote = async () => {
    setBusy(true);
    setErr('');
    try {
      const b = await api('/bookings', {
        method: 'POST',
        body: {
          product_id: Number(productId),
          section_id: Number(sectionId),
          address_id: Number(addressId),
          qty: Number(qty),
          qty_mode: qtyMode,
          per_acc_qty: Number(perAcc),
        },
      });
      setBooking(b);
      setStep(3);
    } catch (e) {
      if (e.code === 'insufficient') {
        setErr(`${e.message} â€” ya qty kam karo, ya section me active accounts badhao.`);
      } else {
        setErr(e.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setErr('');
    try {
      const b = await api(`/bookings/${booking.id}/confirm`, { method: 'POST' });
      setBooking(b);
      toast('Orders chalu â€” checkout flow chal raha hai', 'success');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const cancelBooking = async () => {
    if (!confirm('Booking cancel karein? Queued jobs fail ho jayenge.')) return;
    try {
      const b = await api(`/bookings/${booking.id}/cancel`, { method: 'POST' });
      setBooking(b);
      toast('Booking cancelled', 'warn');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  if (loading) return <Skeleton h={220} />;

  return (
    <div>
      <div className="page-head">
        <h1>Book</h1>
        <p>
          Product â†’ section â†’ address â†’ <b>real per-account price quote</b> â†’ TOTAL dekh ke Book.
        </p>
      </div>

      {/* steps indicator */}
      <div className="tabs" role="tablist" style={{ marginBottom: 16 }}>
        {STEPS.map((s, i) => (
          <button
            key={s}
            role="tab"
            className={step === i ? 'on' : ''}
            disabled={i > step || booking?.status === 'quoting'}
            onClick={() => i <= step && setStep(i)}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {products.length === 0 && (
        <EmptyState
          icon="ðŸ”"
          title="Pehle product fetch karo"
          hint="Flipkart / CashKaro / EarnKaro link se product load karo."
          action={
            <Link to="/fetch">
              <button className="btn primary sm">Go to Fetch</button>
            </Link>
          }
        />
      )}

      {step === 0 && products.length > 0 && (
        <div className="card">
          <div className="field">
            <label>Product</label>
            <select className="input" value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.title || p.url).slice(0, 70)} â€” {inr(p.price)} ({p.platform})
                </option>
              ))}
            </select>
            {product && (
              <div className="hint">
                Listed price {inr(product.price)} Â· COD {product.cod_product ? 'milta hai' : 'nahi dikha'}{' '}
                Â· stock {product.in_stock ? 'haan' : 'nahi'} â€” ye sab checkout par phir se check
                hoga.
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <Button variant="primary" onClick={() => setStep(1)} disabled={!productId}>
              Next â†’ Section
            </Button>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <div className="field">
            <label>Section (account group)</label>
            {sections.length === 0 ? (
              <div className="hint">
                Koi section nahi â€” <Link to="/settings">Settings â†’ Sections</Link> me banao, phir
                Accounts ko assign karo.
              </div>
            ) : (
              <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} â€” {s.active} active, {s.booked} booked
                  </option>
                ))}
              </select>
            )}
            <div className="hint">Sirf free (non-booked) active accounts allocate honge.</div>
          </div>

          <div className="row wrap" style={{ gap: 12, marginTop: 4 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Qty mode</label>
              <select
                className="input"
                value={qtyMode}
                onChange={(e) => setQtyMode(e.target.value)}
              >
                <option value="total">Total orders (N accounts Ã— 1)</option>
                <option value="per_account">Per account (har account Ã— qty)</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>{qtyMode === 'total' ? 'Total orders' : 'Accounts'}</label>
              <input
                className="input"
                type="number"
                min={1}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                style={{ width: 110 }}
              />
            </div>
            {qtyMode === 'per_account' && (
              <div className="field" style={{ margin: 0 }}>
                <label>Qty per account</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={perAcc}
                  onChange={(e) => setPerAcc(e.target.value)}
                  style={{ width: 110 }}
                />
              </div>
            )}
          </div>

          <div className="row" style={{ marginTop: 14 }}>
            <Button variant="ghost" onClick={() => setStep(0)}>
              â† Back
            </Button>
            <Button variant="primary" onClick={() => setStep(2)} disabled={!sectionId}>
              Next â†’ Address
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <div className="field">
            <label>Delivery address (sirf hamara)</label>
            {addresses.length === 0 ? (
              <div className="hint">
                Koi address nahi â€” <Link to="/settings">Settings â†’ Address Book</Link> me add karo.
              </div>
            ) : (
              <select
                className="input"
                value={addressId}
                onChange={(e) => setAddressId(e.target.value)}
              >
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}, {a.city} {a.pincode} {a.is_default ? 'Â· default' : ''}
                  </option>
                ))}
              </select>
            )}
            <div className="hint">
              Checkout par yehi address account me add/select hoga â€” account ke purane addresses
              kabhi choose nahi honge.
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <Button variant="ghost" onClick={() => setStep(1)}>
              â† Back
            </Button>
            <Button variant="primary" onClick={startQuote} disabled={!addressId || busy}>
              {busy ? 'Allocatingâ€¦' : 'Get Price Quote â†’'}
            </Button>
          </div>
          {err && <div className="error-text">{err}</div>}
        </div>
      )}

      {step === 3 && booking && (
        <QuoteStep
          booking={booking}
          busy={busy}
          err={err}
          onBack={() => setStep(2)}
          onRefresh={refreshBooking}
          onConfirm={confirm}
          onCancel={cancelBooking}
        />
      )}
    </div>
  );
}

/** Quote table â€” per-account real price + TOTAL, phir Book. */
function QuoteStep({ booking, busy, err, onBack, onRefresh, onConfirm, onCancel }) {
  const rows = booking.orders || [];
  const priced = rows.filter((r) => r.price != null);
  const totalAmount = priced.reduce((s, r) => s + (r.price || 0) * r.qty, 0);
  const quoted = booking.status === 'quoted';
  const running = booking.status === 'running';
  const done = booking.status === 'done' || booking.status === 'failed';

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <h2 className="card-title" style={{ margin: 0 }}>
          Quote â€” {rows.length} order(s)
        </h2>
        <Pill status={booking.status} />
      </div>

      {booking.status === 'quoting' && (
        <div className="hint" style={{ marginBottom: 10 }}>
          Har account ke session se real price aa raha haiâ€¦ ({booking.progress}/{booking.total}{' '}
          done) <button className="btn ghost sm" onClick={onRefresh}>â†» refresh</button>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
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
                <td className="num">{i + 1}</td>
                <td>
                  {o.account_label || o.account_masked}
                  {o.account_label && (
                    <span className="muted small"> Â· {o.account_masked}</span>
                  )}
                </td>
                <td className="num">{o.qty}</td>
                <td className="num">
                  {o.price != null ? (
                    <b>{inr(o.price * o.qty)}</b>
                  ) : o.error ? (
                    <span className="small" style={{ color: 'var(--red, #d33)' }}>
                      {String(o.error).slice(0, 40)}
                    </span>
                  ) : (
                    <span className="muted">â€¦</span>
                  )}
                </td>
                <td>
                  {o.captcha_state === 'placed' ? (
                    <Pill status="placed">{o.order_ref || 'placed'}</Pill>
                  ) : o.captcha_state === 'pending' ? (
                    <Pill status="pending">captcha</Pill>
                  ) : o.captcha_state === 'failed' || o.error ? (
                    <Pill status="failed" />
                  ) : o.price != null ? (
                    <Pill status="ok">quoted</Pill>
                  ) : (
                    <Pill status="running">quoting</Pill>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} style={{ textAlign: 'right', fontWeight: 700 }}>
                TOTAL ({priced.length}/{rows.length} quoted)
              </td>
              <td className="num" style={{ fontWeight: 800, fontSize: 16 }}>
                {inr(booking.total_amount ?? totalAmount)}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {err && <div className="error-text">{err}</div>}

      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        {booking.status === 'quoting' && (
          <>
            <Button variant="ghost" onClick={onBack}>
              â† Back
            </Button>
            <Button variant="outline" onClick={onRefresh} disabled={busy}>
              â†» Refresh quotes
            </Button>
            <Button variant="primary" disabled>
              Quotingâ€¦ {booking.progress}/{booking.total}
            </Button>
            <Button variant="danger" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </>
        )}
        {quoted && (
          <>
            <Button variant="primary" onClick={onConfirm} disabled={busy}>
              {busy ? 'Startingâ€¦' : `Book ${rows.length} order(s) â€” ${inr(booking.total_amount ?? totalAmount)}`}
            </Button>
            <Button variant="outline" onClick={onRefresh} disabled={busy}>
              â†» Refresh
            </Button>
            <Button variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
          </>
        )}
        {(running || done) && (
          <Link to="/orders">
            <Button variant="primary">Orders page â†’ ({booking.progress}/{booking.total})</Button>
          </Link>
        )}
      </div>
    </div>
  );
}
