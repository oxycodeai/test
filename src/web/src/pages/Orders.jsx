import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui.jsx';

const TABS = ['Pending CAPTCHA', 'Placed', 'Failed'];

export default function Orders() {
  const [tab, setTab] = useState(TABS[0]);

  return (
    <div>
      <div className="page-head">
        <h1>Orders</h1>
        <p>Hybrid checkout — auto flow + CAPTCHA manual queue.</p>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      <EmptyState
        icon="🛒"
        title={`${tab} — koi order nahi`}
        hint="Order engine Phase 4 me aayega: cart → address → COD → CAPTCHA auto/manual."
        action={
          <Link to="/scan">
            <button className="btn outline sm">Pehle Scan chalao</button>
          </Link>
        }
      />
    </div>
  );
}
