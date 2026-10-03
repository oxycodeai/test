import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr, timeAgo, openStream } from '../lib/api.js';
import { StatCard, Skeleton, EmptyState, Pill } from '../components/ui.jsx';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [products, setProducts] = useState([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [s, p] = await Promise.all([api('/stats'), api('/products')]);
        setStats(s);
        setProducts(p.items);
      } catch (e) {
        setErr(e.message);
      }
    })();
  }, []);

  // live: session expiry → banner/stats refresh (F3)
  useEffect(() => {
    const es = openStream({
      session_expired: () =>
        api('/stats')
          .then(setStats)
          .catch(() => {}),
      job_done: (d) => {
        if (d.type === 'health')
          api('/stats')
            .then(setStats)
            .catch(() => {});
      },
    });
    return () => es.close();
  }, []);

  if (err) return <div className="warn-strip">⚠ {err}</div>;
  if (!stats)
    return (
      <div className="grid stats">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} h={72} />
        ))}
      </div>
    );

  return (
    <div>
      <div className="page-head">
        <h1>Dashboard</h1>
        <p>Multi-account Flipkart hub — real data, bulk operations.</p>
      </div>

      {stats.total_accs > 0 && stats.active_accs < stats.total_accs && (
        <div className="warn-strip">
          ⚠{' '}
          <span>
            <b>{stats.total_accs - stats.active_accs}</b> accounts inactive/expired —{' '}
            <Link to="/accounts">Accounts pe check karo</Link>
          </span>
        </div>
      )}

      <div className="grid stats">
        <StatCard label="Active Accounts" value={`${stats.active_accs}/${stats.total_accs}`} />
        <StatCard label="Today's Orders" value={stats.today_orders} />
        <StatCard label="Pending Jobs" value={stats.pending_jobs} />
      </div>

      <div className="quick-actions">
        <Link className="quick" to="/fetch">
          <span className="q-ico">🔍</span> Fetch Product
        </Link>
        <Link className="quick" to="/orders">
          <span className="q-ico">📋</span> Orders
        </Link>
        <Link className="quick" to="/accounts">
          <span className="q-ico">👤</span> Add Accounts
        </Link>
      </div>

      <div className="card">
        <div className="row between">
          <h2 className="card-title" style={{ margin: 0 }}>
            Recent Products
          </h2>
          <Link className="small" to="/fetch">
            Fetch new →
          </Link>
        </div>
        {products.length === 0 ? (
          <EmptyState
            icon="🏷"
            title="No products yet"
            hint="Affiliate link paste karke real price / offers fetch karo."
            action={
              <Link to="/fetch">
                <button className="btn primary sm">Fetch Product</button>
              </Link>
            }
          />
        ) : (
          <div style={{ marginTop: 10 }}>
            {products.slice(0, 5).map((p) => (
              <div
                key={p.id}
                className="row between"
                style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      maxWidth: '60vw',
                    }}
                  >
                    {p.title || p.url}
                  </div>
                  <div className="small muted">
                    {inr(p.price)} {p.mrp ? `· MRP ${inr(p.mrp)}` : ''} · {timeAgo(p.fetched_at)}
                  </div>
                </div>
                <Pill status={p.in_stock ? 'active' : 'expired'}>
                  {p.in_stock ? 'In stock' : 'Out of stock'}
                </Pill>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
