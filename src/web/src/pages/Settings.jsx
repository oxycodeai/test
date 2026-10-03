import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Pill, Skeleton, Modal, EmptyState } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';

export default function Settings() {
  const toast = useToast();
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api('/health')
      .then(setHealth)
      .catch((e) => toast(e.message, 'error'));
  }, []);

  if (!health) return <Skeleton h={140} />;

  const rows = [
    ['Platform', health.platform],
    ['Version', health.version],
    ['Uptime', `${health.uptimeSec}s`],
    ['Browser', health.browser?.executable || '—'],
    ['Session dir', health.browser?.userDataDir || '—'],
    ['Termux mode', health.browser?.termux ? 'yes' : 'no'],
  ];

  return (
    <div>
      <div className="page-head">
        <h1>Settings</h1>
        <p>Sections, address book, system info aur data.</p>
      </div>

      <SectionsCard toast={toast} />
      <AddressBook toast={toast} />
      <ProxyCard toast={toast} />

      <div className="card">
        <h2 className="card-title">System</h2>
        <table className="table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td style={{ fontWeight: 600, width: 160 }}>{k}</td>
                <td className="num" style={{ wordBreak: 'break-all' }}>
                  {String(v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <Pill status="ok">server ok</Pill>
          <a href="/api/health" target="_blank" rel="noreferrer" className="small">
            raw JSON →
          </a>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Data & Security</h2>
        <div className="row wrap" style={{ gap: 8 }}>
          <Button size="sm" onClick={() => toast('PIN change Phase 2 me aayega', 'warn')}>
            Change PIN
          </Button>
          <Button size="sm" onClick={() => toast('CSV export Phase 5 me aayega', 'warn')}>
            Export CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => toast('Run: npm run db:backup (terminal)', 'info')}
          >
            Backup DB
          </Button>
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          Secrets <code>.env</code> me hain (Cuelinks key, PIN hash, session key) — repo me kabhi
          nahi. Session files <code>sessions/</code> me (gitignored).
        </p>
      </div>
    </div>
  );
}

/** Sections — create/delete, counts. Booking engine isi ko allocation unit banata hai. */
function SectionsCard({ toast }) {
  const [items, setItems] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api('/sections')
      .then((r) => setItems(r.items))
      .catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api('/sections', { method: 'POST', body: { name: name.trim() } });
      setName('');
      toast('Section ban gaya', 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const del = async (s) => {
    if (!confirm(`Section "${s.name}" delete? Accounts free ho jayenge (section NULL).`)) return;
    try {
      await api(`/sections/${s.id}`, { method: 'DELETE' });
      toast('Section deleted', 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  return (
    <div className="card">
      <h2 className="card-title">Sections</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        Accounts ko groups me baanto — order flow isi section se accounts allocate karta hai.
      </p>
      {!items ? (
        <Skeleton h={60} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🗂"
          title="Koi section nahi"
          hint="Neeche naam daal ke pehla section banao (jaise: Store-A, Flipkart-1)."
        />
      ) : (
        <table className="table responsive">
          <thead>
            <tr>
              <th>Name</th>
              <th>Accounts</th>
              <th>Active</th>
              <th>Booked</th>
              <th style={{ width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td data-label="Name">{s.name}</td>
                <td data-label="Accounts" className="num">
                  {s.accounts}
                </td>
                <td data-label="Active" className="num">
                  {s.active}
                </td>
                <td data-label="Booked" className="num">
                  {s.booked}
                </td>
                <td data-label="">
                  <Button size="sm" variant="ghost" onClick={() => del(s)}>
                    ✕
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <input
          className="input"
          style={{ maxWidth: 240, height: 36 }}
          placeholder="New section name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Button variant="primary" size="sm" onClick={add} disabled={busy || !name.trim()}>
          + Add
        </Button>
      </div>
    </div>
  );
}

/** Proxy — Flipkart IP-block fix. PUT /api/settings { proxy_url } → fetch + browser dono proxy pe. */
function ProxyCard({ toast }) {
  const [cfg, setCfg] = useState(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/settings')
      .then((r) => {
        setCfg(r);
        setUrl(r.proxy_url || '');
      })
      .catch((e) => toast(e.message, 'error'));
  }, []);

  const save = async (val) => {
    setBusy(true);
    try {
      const r = await api('/settings', { method: 'PUT', body: { proxy_url: val } });
      setCfg(r);
      setUrl(r.proxy_url || '');
      toast(
        val.trim()
          ? 'Proxy set — browser restart hua, ab sab Flipkart traffic proxy se'
          : 'Proxy hataya — direct mode',
        'success'
      );
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="row between">
        <h2 className="card-title">Proxy (Flipkart block fix)</h2>
        {cfg && (
          <Pill status={cfg.proxy_active ? 'ok' : 'gray'}>
            {cfg.proxy_active ? `proxy on · ${cfg.proxy_source}` : 'direct'}
          </Pill>
        )}
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Flipkart aapka IP throttle kare to yahan proxy daalo — fetching, quote aur orders sab proxy se
        jayenge. Residential IP best, datacenter IP kabhi kabhi bhi banned. Khali = direct.
      </p>
      {!cfg ? (
        <Skeleton h={60} />
      ) : (
        <div className="row wrap" style={{ gap: 8 }}>
          <input
            className="input"
            style={{ flex: '1 1 240px', width: 'auto' }}
            placeholder="http://user:pass@host:port"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <Button
            variant="primary"
            size="sm"
            onClick={() => save(url)}
            disabled={busy || !url.trim()}
          >
            Save proxy
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => save('')}
            disabled={busy || !cfg.proxy_url}
          >
            Clear
          </Button>
        </div>
      )}
      {cfg?.proxy_source === 'env' && (
        <div className="hint">
          Abhi <code>.env PROXY_URL</code> se chal raha hai — upar save karoge to wahi override
          karega.
        </div>
      )}
    </div>
  );
}

const EMPTY_ADDR = {
  name: '',
  phone: '',
  pincode: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  is_default: true,
};

/** Address Book — booking engine isi ko account pe add/select karta hai (purane address nahi). */
function AddressBook({ toast }) {
  const [items, setItems] = useState(null);
  const [edit, setEdit] = useState(null); // EMPTY_ADDR copy | existing row | null
  const [busy, setBusy] = useState(false);

  const load = () =>
    api('/addresses')
      .then((r) => setItems(r.items))
      .catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setBusy(true);
    try {
      if (edit.id) await api(`/addresses/${edit.id}`, { method: 'PUT', body: edit });
      else await api('/addresses', { method: 'POST', body: edit });
      setEdit(null);
      toast('Address saved', 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const del = async (a) => {
    if (!confirm(`Delete address "${a.name}, ${a.city}"?`)) return;
    try {
      await api(`/addresses/${a.id}`, { method: 'DELETE' });
      toast('Address deleted', 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const field = (key, label, props = {}) => (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        value={edit[key] || ''}
        onChange={(e) => setEdit({ ...edit, [key]: e.target.value })}
        {...props}
      />
    </div>
  );

  return (
    <div className="card">
      <div className="row between">
        <h2 className="card-title">Address Book</h2>
        <Button size="sm" variant="primary" onClick={() => setEdit({ ...EMPTY_ADDR })}>
          + Add Address
        </Button>
      </div>
      <p className="hint" style={{ marginTop: 0 }}>
        Checkout par sirf yeh address accounts me add/select hota hai — saved purane addresses
        kabhi choose nahi hote.
      </p>
      {!items ? (
        <Skeleton h={60} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="📍"
          title="Koi address nahi"
          hint="Booking se pehle apna delivery address add karo."
        />
      ) : (
        <table className="table responsive">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Address</th>
              <th>Default</th>
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td data-label="Name">{a.name}</td>
                <td data-label="Phone" className="num">
                  {a.phone}
                </td>
                <td data-label="Address" className="small">
                  {a.line1}
                  {a.line2 ? `, ${a.line2}` : ''}, {a.city} {a.pincode}
                </td>
                <td data-label="Default">{a.is_default ? <Pill status="ok">default</Pill> : '—'}</td>
                <td data-label="">
                  <div className="row" style={{ gap: 6 }}>
                    <Button size="sm" variant="outline" onClick={() => setEdit({ ...a })}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => del(a)}>
                      ✕
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {edit && (
        <Modal
          title={edit.id ? 'Edit Address' : 'Add Address'}
          onClose={() => setEdit(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="row" style={{ gap: 10 }}>
            {field('name', 'Full name', { placeholder: 'Ramesh Kumar', autoFocus: true })}
            {field('phone', 'Phone', { placeholder: '9812345678', inputMode: 'numeric' })}
          </div>
          {field('line1', 'Address (Area & Street)', { placeholder: '12, MG Road, Opposite Bank' })}
          {field('line2', 'Landmark (optional)', { placeholder: 'Near Bus Stand' })}
          <div className="row" style={{ gap: 10 }}>
            {field('city', 'City', { placeholder: 'Pune' })}
            {field('pincode', 'Pincode', { placeholder: '411001', inputMode: 'numeric' })}
            {field('state', 'State', { placeholder: 'Maharashtra' })}
          </div>
          <label className="row" style={{ gap: 8, marginTop: 4 }}>
            <input
              type="checkbox"
              checked={!!edit.is_default}
              onChange={(e) => setEdit({ ...edit, is_default: e.target.checked })}
            />
            <span className="small">Default (naye accounts pe pehle yahi)</span>
          </label>
        </Modal>
      )}
    </div>
  );
}
