import { useEffect, useMemo, useState } from 'react';
import { api, timeAgo } from '../lib/api.js';
import { Button, Pill, Modal, EmptyState, Skeleton } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';

const STATUSES = ['all', 'active', 'expired', 'pending', 'error'];

export default function Accounts() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(new Set());
  const [modal, setModal] = useState(null); // 'single' | 'bulk'
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const params = new URLSearchParams({ status, limit: '200' });
    if (q.trim()) params.set('q', q.trim());
    const r = await api(`/accounts?${params}`);
    setItems(r.items);
    setTotal(r.total);
    setSel(new Set());
  };

  useEffect(() => {
    load().catch((e) => toast(e.message, 'error'));
  }, [status]);

  const allSelected = items && items.length > 0 && sel.size === items.length;

  const toggleAll = () => setSel(allSelected ? new Set() : new Set(items.map((i) => i.id)));

  const toggle = (id) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const removeMany = async () => {
    if (!confirm(`Delete ${sel.size} account(s)? Sessions bhi delete honge.`)) return;
    setBusy(true);
    try {
      await Promise.all([...sel].map((id) => api(`/accounts/${id}`, { method: 'DELETE' })));
      toast(`Deleted ${sel.size} account(s)`, 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const checkHealth = () =>
    toast('Health check Phase 2 me aayega (session login ke saath)', 'warn');

  return (
    <div>
      <div className="page-head">
        <h1>Accounts</h1>
        <p>
          {items
            ? `${total} total · ${items.filter((i) => i.status === 'active').length} active`
            : 'Loading…'}
        </p>
      </div>

      <div className="toolbar">
        <input
          className="input"
          style={{ maxWidth: 220, height: 36 }}
          placeholder="Search label/number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <select
          className="input"
          style={{ maxWidth: 130, height: 36 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <Button variant="outline" size="sm" onClick={() => setModal('bulk')}>
          + Bulk Add
        </Button>
        <Button variant="primary" size="sm" onClick={() => setModal('single')}>
          + Add Account
        </Button>
      </div>

      {!items ? (
        <Skeleton h={180} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="👤"
          title="No accounts yet"
          hint="OTP se real Flipkart accounts add karo (unlimited)."
          action={
            <button className="btn primary sm" onClick={() => setModal('single')}>
              Add first account
            </button>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table responsive">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={!!allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th>Label</th>
                <th>Identifier</th>
                <th>Status</th>
                <th>Last checked</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id}>
                  <td data-label="">
                    <input
                      type="checkbox"
                      checked={sel.has(a.id)}
                      onChange={() => toggle(a.id)}
                      aria-label={`Select ${a.label || a.identifier_masked}`}
                    />
                  </td>
                  <td data-label="Label">{a.label || <span className="muted">—</span>}</td>
                  <td data-label="Number" className="num">
                    {a.identifier_masked}
                  </td>
                  <td data-label="Status">
                    <Pill status={a.status} />
                  </td>
                  <td data-label="Checked" className="muted small">
                    {timeAgo(a.last_checked)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sel.size > 0 && (
        <div className="batch-bar">
          <span className="count">{sel.size} selected</span>
          <span className="spacer" style={{ flex: 1 }} />
          <Button size="sm" variant="outline" onClick={checkHealth}>
            Check health
          </Button>
          <Button size="sm" variant="danger" onClick={removeMany} disabled={busy}>
            Delete
          </Button>
        </div>
      )}

      {modal === 'single' && (
        <AddSingle
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            toast('Account added', 'success');
            load();
          }}
        />
      )}
      {modal === 'bulk' && (
        <AddBulk
          onClose={() => setModal(null)}
          onSaved={(r) => {
            setModal(null);
            toast(`Created ${r.created}, skipped ${r.skipped}`, r.skipped ? 'warn' : 'success');
            load();
          }}
        />
      )}
    </div>
  );
}

function AddSingle({ onClose, onSaved }) {
  const [label, setLabel] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api('/accounts', {
        method: 'POST',
        body: { label: label.trim() || null, identifier: identifier.trim() },
      });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add Account"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !identifier.trim()}>
            {busy ? 'Saving…' : 'Add'}
          </Button>
        </>
      }
    >
      <div className="field">
        <label>Phone or Email</label>
        <input
          className="input"
          placeholder="9812345678 ya name@mail.com"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoFocus
        />
        <div className="hint">
          OTP aapke number/email pe aayega — login wizard Phase 2 me aayega.
        </div>
      </div>
      <div className="field">
        <label>Label (optional)</label>
        <input
          className="input"
          placeholder="Shop-05"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>
      {err && <div className="error-text">{err}</div>}
    </Modal>
  );
}

function AddBulk({ onClose, onSaved }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(
    () =>
      text
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [identifier, label] = l.split(/[,\t;]/).map((s) => s.trim());
          return { identifier, label: label || null };
        }),
    [text]
  );

  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await api('/accounts/bulk', { method: 'POST', body: { items: parsed } });
      onSaved(r);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Bulk Add Accounts"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || parsed.length === 0}>
            {busy ? 'Adding…' : `Add ${parsed.length}`}
          </Button>
        </>
      }
    >
      <div className="field">
        <label>
          One per line — <code>identifier,label</code>
        </label>
        <textarea
          className="input"
          rows={8}
          placeholder={'9812345678,Shop-01\n9876543210,Shop-02\nname@mail.com'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
        />
        <div className="hint">{parsed.length} line(s) parsed · duplicates apne aap skip honge</div>
      </div>
      {err && <div className="error-text">{err}</div>}
    </Modal>
  );
}
