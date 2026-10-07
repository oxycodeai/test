import { useState } from 'react';
import OrderPanel from '../components/OrderPanel.jsx';

/**
 * Fetch & Order — PURANA flow (fetch button → product card/image → order form)
 * hata diya. Ab: link paste → Start. Product/COD/stock andar hi
 * (POST /bookings url mode) resolve hota hai — error Seedha Start ke neeche.
 */
export default function FetchPage() {
  const [url, setUrl] = useState('');

  const urlOk = /^https?:\/\//i.test(url.trim());

  return (
    <div>
      <div className="page-head">
        <h1>Order Start</h1>
        <p>
          Sirf link daalo — section, qty, price limit bharo aur <b>Start</b> dabao. Product ka data
          Start karte hi khud resolve hoga (COD wala hi order chalega).
        </p>
      </div>

      <form className="card" onSubmit={(e) => e.preventDefault()}>
        <div className="field">
          <label htmlFor="url">Product URL (Flipkart seedha ya koi bhi affiliate link)</label>
          <input
            id="url"
            className="input"
            type="url"
            inputMode="url"
            placeholder="flipkart.com/.../p/... ya cashkaro / earnkaro / cuelinks / … koi bhi link"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <div className="hint" style={{ marginTop: 8 }}>
            Network (EarnKaro/CashKaro) link login-wala nahi hona chahiye — seedha Flipkart{' '}
            <code>/p/</code> link hamesha chalta hai.
          </div>
          {url.trim() && !urlOk && (
            <div className="error-text">Link http/https se shuru hona chahiye</div>
          )}
        </div>
      </form>

      {url.trim() && (
        <OrderPanel url={urlOk ? url.trim() : ''} />
      )}
    </div>
  );
}
