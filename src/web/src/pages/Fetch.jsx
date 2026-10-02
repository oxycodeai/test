import { useEffect, useState } from 'react';
import { api, inr, timeAgo } from '../lib/api.js';
import { Button, Pill, EmptyState } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';

export default function FetchPage() {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [product, setProduct] = useState(null);
  const [recent, setRecent] = useState([]);

  const loadRecent = () =>
    api('/products')
      .then((r) => setRecent(r.items))
      .catch(() => {});

  useEffect(() => {
    loadRecent();
  }, []);

  const fetchNow = async (e) => {
    e?.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setErr('');
    try {
      const p = await api('/products/fetch', { method: 'POST', body: { url: url.trim() } });
      setProduct(p);
      toast('Product fetched — real data', 'success');
      loadRecent();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  const copyAffid = async () => {
    if (!product?.affiliate?.url) return;
    await navigator.clipboard.writeText(product.affiliate.url);
    toast('Affiliate link copied', 'success');
  };

  return (
    <div>
      <div className="page-head">
        <h1>Fetch Product</h1>
        <p>Flipkart / CashKaro / EarnKaro link paste karo — real price, offers, COD status milega.</p>
      </div>

      <form className="card" onSubmit={fetchNow}>
        <div className="field">
          <label htmlFor="url">Product URL (Flipkart ya CashKaro/EarnKaro affiliate link)</label>
          <div className="row" style={{ gap: 8 }}>
            <input
              id="url"
              className="input"
              type="url"
              inputMode="url"
              placeholder="flipkart.com/.../p/... ya cashkaro.com/... ya earnkaro.com/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <Button variant="primary" type="submit" disabled={busy || !url.trim()}>
              {busy ? 'Fetching…' : 'Fetch'}
            </Button>
          </div>
          {busy && <div className="hint">Page load + parse ho raha hai… (max ~30s)</div>}
          {err && <div className="error-text">{err}</div>}
        </div>
      </form>

      {product && (
        <div className="card">
          <div className="row between" style={{ marginBottom: 10 }}>
            <span className="meta-chip">
              Updated {timeAgo(product.fetched_at)}
              {product.cached ? ' · cached' : ''}
              {product.method ? ` · via ${product.method}` : ''}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <Pill status="ok">{product.platform || 'flipkart'}</Pill>
              <Pill status={product.in_stock ? 'active' : 'expired'}>
                {product.in_stock ? 'In stock' : 'Out of stock'}
              </Pill>
              <Pill status={product.cod_product ? 'active' : 'expired'}>
                {product.cod_product ? 'COD available' : 'COD nahi'}
              </Pill>
            </span>
          </div>

          <div className="product-card">
            {product.image && <img className="thumb" src={product.image} alt="" loading="lazy" />}
            <div style={{ minWidth: 0 }}>
              <p className="title">{product.title}</p>
              <div className="price-row">
                <span className="price num">{inr(product.price)}</span>
                {product.mrp && <span className="mrp num">{inr(product.mrp)}</span>}
                {product.discount_pct ? (
                  <span className="disc-chip">{product.discount_pct}% off</span>
                ) : null}
              </div>
              {product.offers?.length > 0 && (
                <ul className="offers">
                  {product.offers.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="row" style={{ marginTop: 14, gap: 8 }}>
            <Button variant="blue" onClick={copyAffid} disabled={!product.affiliate?.url}>
              Copy affiliate link
            </Button>
            {product.affiliate && (
              <span className="small muted">
                {product.affiliate.native
                  ? `${product.affiliate.mode} link ✔ (wahi affiliate link use hoga)`
                  : product.affiliate.converted
                    ? `via Cuelinks ✔`
                    : `mode: ${product.affiliate.mode}${product.affiliate.note ? ` (${product.affiliate.note})` : ''}`}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="card-title">Recent fetches</h2>
        {recent.length === 0 ? (
          <EmptyState icon="🔍" title="Abhi tak kuch fetch nahi hua" />
        ) : (
          recent.map((p) => (
            <button
              key={p.id}
              className="row between"
              style={{
                width: '100%',
                background: 'none',
                border: 0,
                borderBottom: '1px solid #f0f0f0',
                padding: '10px 0',
                cursor: 'pointer',
                textAlign: 'left',
                font: 'inherit',
              }}
              onClick={() => setProduct(p)}
            >
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    fontWeight: 600,
                    display: 'block',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '55vw',
                  }}
                >
                  {p.title || p.url}
                </span>
                <span className="small muted num">
                  {inr(p.price)} · {timeAgo(p.fetched_at)}
                </span>
              </span>
              <Pill status={p.cod_product ? 'active' : 'gray'}>{p.cod_product ? 'COD' : '—'}</Pill>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
