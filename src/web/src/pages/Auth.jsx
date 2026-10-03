import { useState } from 'react';
import { api, setToken } from '../lib/api.js';
import { Button } from '../components/ui.jsx';

/** First-run PIN setup + login (App.jsx gate se render). */
export default function AuthPage({ setup, onDone }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (setup && pin !== pin2) return setErr('PINs match nahi kar rahe');
    if (pin.length < 4) return setErr('PIN kam se kam 4 characters ka hona chahiye');
    setBusy(true);
    try {
      const r = await api(setup ? '/auth/setup' : '/auth/login', {
        method: 'POST',
        body: { pin },
      });
      setToken(r.token);
      onDone();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="logo">
          <span className="bag">🛍</span> KartBulk
        </div>
        <h2 style={{ textAlign: 'center' }}>{setup ? 'Set your PIN' : 'Enter your PIN'}</h2>
        <p className="muted small" style={{ textAlign: 'center', marginTop: 0 }}>
          {setup
            ? 'First run — dashboard ke liye ek PIN banao (4+ chars).'
            : 'Dashboard unlock karo.'}
        </p>

        <div className="field">
          <label htmlFor="pin">PIN</label>
          <input
            id="pin"
            className="input"
            type="password"
            inputMode="numeric"
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••"
            autoFocus
          />
        </div>
        {setup && (
          <div className="field">
            <label htmlFor="pin2">Confirm PIN</label>
            <input
              id="pin2"
              className="input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin2}
              onChange={(e) => setPin2(e.target.value)}
              placeholder="••••"
            />
          </div>
        )}
        {err && <div className="error-text">{err}</div>}
        <Button
          variant="primary"
          type="submit"
          disabled={busy}
          className="block-mobile"
          style={{ width: '100%', marginTop: 6 }}
        >
          {busy ? 'Please wait…' : setup ? 'Create PIN' : 'Unlock'}
        </Button>
      </form>
    </div>
  );
}
