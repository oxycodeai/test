import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr, timeAgo, openStream } from '../lib/api.js';
import { Button, Pill, EmptyState, Skeleton, Modal } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';

const TABS = [
  { key: 'pending', label: 'Pending CAPTCHA' },
  { key: 'placed', label: 'Placed' },
  { key: 'failed', label: 'Failed' },
  { key: 'all', label: 'All' },
];

export default function Orders() {
  const toast = useToast();
  const [tab, setTab] = useState('pending');
  const [items, setItems] = useState(null);
  const [busy, setBusy] = useState(false);
  const [captcha, setCaptcha] = useState(null); // order row with captcha_png

  const load = () =>
    api(`/orders?state=${tab}`)
      .then((r) => setItems(r.items))
      .catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    setItems(null);
    load();
  }, [tab]);

  useEffect(() => {
    const es = openStream({
      captcha_pending: () => {
        toast('CAPTCHA solve karo — order pending hai', 'warn');
        load().catch(() => {});
      },
      order_placed: () => load().catch(() => {}),
      job_done: (d) => {
        if (['order', 'price_check'].includes(d.type)) load().catch(() => {});
      },
    });
    return () => es.close();
  }, [tab]);

  const solveCaptcha = async (orderId, text) => {
    setBusy(true);
    try {
      await api(`/orders/${orderId}/captcha`, { method: 'POST', body: { text } });
      toast('Captcha bheja — order flow dobara chalega', 'success');
      setCaptcha(null);
      setTab('pending');
      setTimeout(() => load().catch(() => {}), 2500);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const retry = async (orderId) => {
    setBusy(true);
    try {
      const r = await api(`/orders/${orderId}/retry`, { method: 'POST' });
      toast(r?.step === 'price_check' ? 'Re-quote queued (price check)' : 'Retry queued', 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>Orders</h1>
        <p>Hybrid checkout — auto flow + CAPTCHA manual queue. COD only.</p>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            className={tab === t.key ? 'on' : ''}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!items ? (
        <Skeleton h={160} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🛒"
          title={`${TABS.find((t) => t.key === tab)?.label} — koi order nahi`}
          hint="Fetch page par link paste karke quote karo → Book karke orders yahan track honge."
          action={
            <Link to="/fetch">
              <button className="btn primary sm">Go to Fetch &amp; Order</button>
            </Link>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th>Account</th>
                <th>Product</th>
                <th>Price</th>
                <th>State</th>
                <th>Ref / Error</th>
                <th>Updated</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => (
                <tr key={o.id}>
                  <td data-label="Account">
                    {o.account_label || o.identifier || o.account_masked}
                    <div className="small muted">{o.identifier || o.account_masked}</div>
                  </td>
                  <td data-label="Product" className="small">
                    {(o.product_title || '—').slice(0, 48)}
                    <div className="muted">booking #{o.booking_id}</div>
                  </td>
                  <td data-label="Price" className="num">
                    {o.price != null ? inr(o.price) : '—'}
                  </td>
                  <td data-label="State">
                    <Pill status={o.captcha_state} />
                  </td>
                  <td data-label="Ref" className="small">
                    {o.order_ref ? (
                      <b>{o.order_ref}</b>
                    ) : o.error ? (
                      <span title={o.error}>{String(o.error).slice(0, 46)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td data-label="Updated" className="muted small">
                    {timeAgo(o.updated_at)}
                  </td>
                  <td data-label="Actions">
                    <div className="row" style={{ gap: 6 }}>
                      {o.captcha_state === 'pending' && o.captcha_png && (
                        <Button size="sm" variant="primary" onClick={() => setCaptcha(o)}>
                          Solve
                        </Button>
                      )}
                      {o.error &&
                        o.captcha_state !== 'pending' &&
                        o.captcha_state !== 'placed' && (
                          <Button size="sm" variant="outline" onClick={() => retry(o.id)} disabled={busy}>
                            {o.price == null ? 'Re-quote' : 'Retry'}
                          </Button>
                        )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {captcha && (
        <CaptchaModal
          order={captcha}
          busy={busy}
          onClose={() => setCaptcha(null)}
          onSolve={(text) => solveCaptcha(captcha.id, text)}
        />
      )}
    </div>
  );
}

/** CAPTCHA manual solve — image dikhao, text bharo, flow resume. */
function CaptchaModal({ order, busy, onClose, onSolve }) {
  const [text, setText] = useState('');

  return (
    <Modal
      title={`CAPTCHA — order #${order.id}`}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Later
          </Button>
          <Button
            variant="primary"
            onClick={() => onSolve(text.trim())}
            disabled={busy || text.trim().length < 3}
          >
            {busy ? 'Sending…' : 'Submit & Continue'}
          </Button>
        </>
      }
    >
      <div style={{ textAlign: 'center' }}>
        <img
          src={`data:image/png;base64,${order.captcha_png}`}
          alt="CAPTCHA"
          style={{ imageRendering: 'pixelated', border: '1px solid var(--border, #ddd)', borderRadius: 6, maxHeight: 90 }}
        />
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Text jo image me dikh raha hai</label>
        <input
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && text.trim().length >= 3 && onSolve(text.trim())}
          placeholder="e.g. X7k2P"
          autoFocus
          style={{ textAlign: 'center', fontSize: 20, letterSpacing: 4, fontWeight: 700 }}
        />
        <div className="hint">
          Submit karke order flow wahin se continue hoga (address → COD → place).
        </div>
      </div>
    </Modal>
  );
}
