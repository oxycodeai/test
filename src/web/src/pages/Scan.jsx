import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr } from '../lib/api.js';
import { Button, EmptyState } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';

export default function Scan() {
  const toast = useToast();
  const [products, setProducts] = useState([]);
  const [stats, setStats] = useState(null);
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState(1);
  const [mode, setMode] = useState('total');
  const [perAcc, setPerAcc] = useState(1);

  useEffect(() => {
    Promise.all([api('/products'), api('/stats')])
      .then(([p, s]) => {
        setProducts(p.items);
        setStats(s);
        if (p.items[0]) setProductId(String(p.items[0].id));
      })
      .catch((e) => toast(e.message, 'error'));
  }, []);

  const active = stats?.active_accs ?? 0;
  const need = mode === 'total' ? qty : qty * perAcc;
  const insufficient = active > 0 && need > active;

  return (
    <div>
      <div className="page-head">
        <h1>Start Scan</h1>
        <p>Har account ka real price / offers / COD check hoga (comparison table).</p>
      </div>

      <div className="card">
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}
        >
          <div className="field" style={{ margin: 0 }}>
            <label>Product</label>
            {products.length === 0 ? (
              <div className="hint">
                Pehle <Link to="/fetch">Fetch</Link> se product load karo.
              </div>
            ) : (
              <select
                className="input"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {(p.title || p.url).slice(0, 60)} — {inr(p.price)}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label>Quantity</label>
            <input
              className="input"
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </div>

          <div className="field" style={{ margin: 0 }}>
            <label>Mode</label>
            <div className="seg" role="group">
              <button
                type="button"
                className={mode === 'total' ? 'on' : ''}
                onClick={() => setMode('total')}
              >
                Total
              </button>
              <button
                type="button"
                className={mode === 'per_account' ? 'on' : ''}
                onClick={() => setMode('per_account')}
              >
                Per account
              </button>
            </div>
          </div>

          {mode === 'per_account' && (
            <div className="field" style={{ margin: 0 }}>
              <label>Per-account qty</label>
              <input
                className="input"
                type="number"
                min={1}
                value={perAcc}
                onChange={(e) => setPerAcc(Math.max(1, parseInt(e.target.value, 10) || 1))}
              />
            </div>
          )}
        </div>

        {stats && active === 0 && (
          <div className="warn-strip">
            ⚠{' '}
            <span>
              Koi active account nahi — pehle <Link to="/accounts">Accounts</Link> me login karo
              (Phase 2).
            </span>
          </div>
        )}
        {insufficient && (
          <div className="warn-strip">
            ⚠{' '}
            <span>
              <b>Sirf {active} active accounts hain</b> — {need} chahiye (mode:{' '}
              {mode === 'total' ? 'Total' : 'Per account'}). Qty kam karo ya aur accounts add karo.
            </span>
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <Button
            variant="primary"
            disabled={!productId || active === 0 || insufficient}
            onClick={() => toast('Scan engine Phase 3 me aayega — abhi sirf config saved', 'warn')}
          >
            Start Scan
          </Button>
          <span className="small muted">
            {stats ? `${active} active accs · need ${need}` : 'loading stats…'}
          </span>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Comparison table</h2>
        <EmptyState
          icon="📡"
          title="Scan results yahan aayenge"
          hint="Columns: Account · Price · Special · Offers · COD · Eligible — sab real session data."
        />
      </div>
    </div>
  );
}
