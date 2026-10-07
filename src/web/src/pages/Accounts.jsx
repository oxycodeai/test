import { useEffect, useMemo, useState } from 'react';
import { api, timeAgo, openStream } from '../lib/api.js';
import { parseAccountsJson } from '../lib/import.js';
import { Button, Pill, Modal, EmptyState, Skeleton } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';

const STATUSES = ['all', 'active', 'booked', 'expired', 'pending', 'error'];

function bookedDaysLeft(ts) {
  if (!ts || ts <= Date.now()) return null;
  return Math.max(1, Math.ceil((ts - Date.now()) / 86400000));
}

export default function Accounts() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [sectionId, setSectionId] = useState('all');
  const [sections, setSections] = useState([]);
  const [sel, setSel] = useState(new Set());
  const [modal, setModal] = useState(null); // 'single' | 'bulk' | 'import'
  const [wizard, setWizard] = useState(null); // {id, name, mode}
  const [busy, setBusy] = useState(false);

  const loadSections = () =>
    api('/sections')
      .then((r) => setSections(r.items))
      .catch(() => {});

  const load = async () => {
    const params = new URLSearchParams({ status, limit: '200' });
    if (q.trim()) params.set('q', q.trim());
    if (sectionId !== 'all') params.set('section_id', sectionId);
    const r = await api(`/accounts?${params}`);
    setItems(r.items);
    setTotal(r.total);
    setSel(new Set());
  };

  useEffect(() => {
    loadSections();
  }, []);

  useEffect(() => {
    load().catch((e) => toast(e.message, 'error'));
  }, [status, sectionId]);

  // live refresh — expired badge / login done / order placed pe turant update
  useEffect(() => {
    const es = openStream({
      session_expired: () => load().catch(() => {}),
      order_placed: () => load().catch(() => {}),
      job_done: (d) => {
        if (['otp_request', 'otp_verify', 'health', 'order'].includes(d.type))
          load().catch(() => {});
      },
    });
    return () => es.close();
  }, [status, sectionId]);

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
    if (!confirm(`Delete karein ${sel.size} account(s)? Sessions bhi delete honge.`)) return;
    setBusy(true);
    try {
      await Promise.all([...sel].map((id) => api(`/accounts/${id}`, { method: 'DELETE' })));
      toast(`${sel.size} account(s) delete ho gaye`, 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeOne = async (id) => {
    if (!confirm('Account + session delete karein?')) return;
    try {
      await api(`/accounts/${id}`, { method: 'DELETE' });
      toast('Account delete ho gaya', 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const checkHealth = async () => {
    setBusy(true);
    try {
      const r = await api('/accounts/health', { method: 'POST', body: { ids: [...sel] } });
      toast(`Health check lag gaya (${r.queued})`, 'info');
      setTimeout(() => load().catch(() => {}), 3500);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const openLogin = (a) =>
    setWizard({
      id: a.id,
      name: a.label || a.identifier,
      mode: a.status === 'expired' || a.status === 'error' ? 'relogin' : 'login',
    });

  const releaseOne = async (id) => {
    try {
      await api(`/accounts/${id}/release`, { method: 'POST' });
      toast('Booked flag hata diya — account free', 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const assignSection = async (sid) => {
    if (sel.size === 0) return;
    setBusy(true);
    try {
      const r = await api('/accounts/assign-section', {
        method: 'POST',
        body: { ids: [...sel], section_id: sid === '' ? null : Number(sid) },
      });
      toast(`${r.updated} account(s) assign ho gaye`, 'success');
      load();
      loadSections();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

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
          style={{ maxWidth: 200, height: 36 }}
          placeholder="Search label/number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
        <select
          className="input"
          style={{ maxWidth: 120, height: 36 }}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="input"
          style={{ maxWidth: 140, height: 36 }}
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
        >
          <option value="all">All sections</option>
          {sections.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name} ({s.accounts})
            </option>
          ))}
        </select>
        <span className="spacer" />
        <Button variant="outline" size="sm" onClick={() => setModal('import')}>
          ⬆ Import JSON
        </Button>
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
                <th>Invalid num</th>
                <th>Section</th>
                <th>Status</th>
                <th>Last checked</th>
                <th style={{ width: 170 }}>Actions</th>
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
                      aria-label={`Select ${a.label || a.identifier}`}
                    />
                  </td>
                  <td data-label="Label">{a.label || <span className="muted">—</span>}</td>
                  <td data-label="Number" className="num">
                    {a.identifier}
                  </td>
                  <td data-label="Invalid num" className="num">
                    {a.invalid_number || <span className="muted" title="Settings → Import Invalid Num se connect hoga">—</span>}
                  </td>
                  <td data-label="Section" className="small">
                    {a.section_name || <span className="muted">—</span>}
                  </td>
                  <td data-label="Status">
                    {bookedDaysLeft(a.booked_until) ? (
                      <span className="pill green" title={`Booked till ${new Date(a.booked_until).toLocaleString()}`}>
                        <span className="dot" />
                        Booked {bookedDaysLeft(a.booked_until)}d
                      </span>
                    ) : (
                      <Pill status={a.status} />
                    )}
                    {a.last_error && a.status !== 'active' && (
                      <div className="small muted" title={a.last_error}>
                        {String(a.last_error).slice(0, 42)}
                      </div>
                    )}
                  </td>
                  <td data-label="Checked" className="muted small">
                    {timeAgo(a.last_checked)}
                  </td>
                  <td data-label="Actions">
                    <div className="row" style={{ gap: 6 }}>
                      {a.status !== 'active' && (
                        <Button
                          size="sm"
                          variant={a.status === 'pending' ? 'blue' : 'outline'}
                          onClick={() => openLogin(a)}
                        >
                          {a.status === 'pending' ? 'Login' : 'Re-login'}
                        </Button>
                      )}
                      {bookedDaysLeft(a.booked_until) && (
                        <Button size="sm" variant="outline" onClick={() => releaseOne(a.id)}>
                          Release
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => removeOne(a.id)}>
                        ✕
                      </Button>
                    </div>
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
          <select
            className="input"
            style={{ maxWidth: 170, height: 34 }}
            defaultValue=""
            disabled={busy}
            onChange={(e) => e.target.value !== '' && assignSection(e.target.value)}
            aria-label="Assign to section"
          >
            <option value="">Assign to section…</option>
            {sections.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="spacer" style={{ flex: 1 }} />
          <Button size="sm" variant="outline" onClick={checkHealth} disabled={busy}>
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
            toast('Account login ho gaya — session save ho gaya', 'success');
            load();
          }}
        />
      )}
      {modal === 'bulk' && (
        <AddBulk
          onClose={() => setModal(null)}
          onSaved={(r) => {
            setModal(null);
            toast(
              `${r.created} import${r.activated ? ` (${r.activated} active, OTP nahi lagega)` : ''}, ${r.skipped} skip`,
              r.skipped ? 'warn' : 'success'
            );
            load();
          }}
        />
      )}
      {modal === 'import' && (
        <ImportJson
          onClose={() => setModal(null)}
          onSaved={(r) => {
            setModal(null);
            toast(`${r.created} import, ${r.skipped} skip`, r.skipped ? 'warn' : 'success');
            load();
          }}
        />
      )}
      {wizard && (
        <OtpWizard
          account={wizard}
          onClose={() => setWizard(null)}
          onDone={() => {
            setWizard(null);
            toast(
              wizard.mode === 'relogin' ? 'Re-login successful — session saved' : 'Login successful',
              'success'
            );
            load();
          }}
        />
      )}
    </div>
  );
}

/** 6-box OTP input — auto-advance, backspace, paste (UI-UX §3.4). */
function OtpBoxes({ value, onChange, disabled }) {
  const refs = useState(() => Array(6).fill(null).map(() => ({ current: null })))[0];
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');

  const setAt = (i, ch) => {
    const arr = value.padEnd(6, ' ').split('');
    arr[i] = ch;
    onChange(arr.join('').replace(/\s+$/, '').trimEnd());
  };

  const onKey = (i) => (e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      setAt(i, ' ');
      if (i > 0) refs[i - 1].current?.focus();
    } else if (e.key === 'ArrowLeft' && i > 0) {
      refs[i - 1].current?.focus();
    } else if (e.key === 'ArrowRight' && i < 5) {
      refs[i + 1].current?.focus();
    }
  };

  const onInput = (i) => (e) => {
    const ch = e.target.value.replace(/\D/g, '').slice(-1);
    if (!ch) return;
    setAt(i, ch);
    if (i < 5) refs[i + 1].current?.focus();
  };

  const onPaste = (e) => {
    const text = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
    if (text) {
      e.preventDefault();
      onChange(text);
      refs[Math.min(text.length, 5)].current?.focus();
    }
  };

  return (
    <div className="row" style={{ gap: 8, justifyContent: 'center' }} onPaste={onPaste}>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs[i].current = el;
          }}
          className="input"
          style={{
            width: 44,
            height: 52,
            textAlign: 'center',
            fontSize: 22,
            fontWeight: 700,
            padding: 0,
          }}
          inputMode="numeric"
          maxLength={1}
          value={d.trim()}
          disabled={disabled}
          aria-label={`OTP digit ${i + 1}`}
          onChange={onInput(i)}
          onKeyDown={onKey(i)}
          onFocus={(e) => e.target.select()}
        />
      ))}
    </div>
  );
}

/** Step 2 — OTP enter + Verify (AddSingle aur Wizard dono use karte hain).
 *  Firebase inbox configured ho toh auto-poll → auto-fill → auto-verify. */
function OtpStep({ accountId, onSuccess, onBack, since = 0 }) {
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [autoPoll, setAutoPoll] = useState(false);

  const verify = async (code) => {
    const v = String(code ?? otp).replace(/\D/g, '');
    if (v.length !== 6) {
      setErr('6 digit OTP bharo');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api(`/accounts/${accountId}/login`, { method: 'POST', body: { otp: v } });
      onSuccess();
    } catch (e) {
      setErr(e.message);
      if (e.code === 'otp_expired') setOtp('');
    } finally {
      setBusy(false);
    }
  };

  // Firebase OTP inbox — poll har 4s (max ~90s); not_configured par band
  useEffect(() => {
    let stopped = false;
    let tries = 0;
    let timer;
    setAutoPoll(true);
    const poll = async () => {
      if (stopped) return;
      tries += 1;
      if (tries > 22) {
        setAutoPoll(false);
        return;
      }
      try {
        const r = await api(`/accounts/${accountId}/otp-fetch?since=${since || 0}`);
        if (stopped) return;
        if (r?.otp) {
          setAutoPoll(false);
          setOtp(r.otp);
          verify(r.otp);
          return;
        }
      } catch (e) {
        if (stopped) return;
        if (e.code === 'not_configured') {
          setAutoPoll(false);
          return;
        }
        // otp_not_found / rtdb_error → retry till timeout
      }
      timer = setTimeout(poll, 4000);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [accountId, since]);

  return (
    <div>
      <div className="hint" style={{ textAlign: 'center', marginBottom: 12 }}>
        OTP aapke phone / email pe aaya — 6 digit yahan bharo (5 min me verify karo).
      </div>
      {autoPoll && (
        <div className="hint" style={{ textAlign: 'center', marginTop: -6, marginBottom: 8 }}>
          📥 Firebase inbox se OTP dhoond rahe hain… (milte hi auto-verify)
        </div>
      )}
      <OtpBoxes value={otp} onChange={setOtp} disabled={busy} />
      {err && (
        <div className="error-text" style={{ textAlign: 'center' }}>
          {err}
        </div>
      )}
      <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: 'center' }}>
        {onBack && (
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            ← Back
          </Button>
        )}
        <Button variant="primary" onClick={() => verify()} disabled={busy}>
          {busy ? 'Verifying…' : 'Verify & Save'}
        </Button>
      </div>
    </div>
  );
}

/** OTP wizard — Send OTP → enter OTP → success (row Login/Re-login). */
function OtpWizard({ account, onClose, onDone }) {
  const [step, setStep] = useState(1); // 1 send · 2 otp · 3 done
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [since, setSince] = useState(0);

  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      setSince(Date.now()); // Firebase poll: isi time ke baad ke SMS
      await api(`/accounts/${account.id}/otp-request`, { method: 'POST' });
      setStep(2);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const success = () => {
    setStep(3);
    setTimeout(onDone, 900);
  };

  const title =
    account.mode === 'relogin'
      ? `Re-login — ${account.name}`
      : `Login OTP — ${account.name}`;

  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        step !== 3 && (
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        )
      }
    >
      {step === 1 && (
        <div>
          <div className="hint" style={{ textAlign: 'center', marginBottom: 12 }}>
            Flipkart pe OTP bhejenge — phir wahi number / email OTP dega.
          </div>
          {err && <div className="error-text">{err}</div>}
          <div className="row" style={{ justifyContent: 'center' }}>
            <Button variant="blue" onClick={send} disabled={busy}>
              {busy ? 'OTP bheja…' : 'Send OTP'}
            </Button>
          </div>
        </div>
      )}
      {step === 2 && (
        <OtpStep
          accountId={account.id}
          onSuccess={success}
          onBack={() => setStep(1)}
          since={since}
        />
      )}
      {step === 3 && (
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ fontWeight: 600 }}>Session saved — account Active</div>
        </div>
      )}
    </Modal>
  );
}

/** Add Account — create → auto Send OTP → verify (spec §3.4 combined). */
function AddSingle({ onClose, onSaved }) {
  const [label, setLabel] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [created, setCreated] = useState(null); // {id}
  const [step, setStep] = useState(1); // 1 form · 2 otp · 3 done
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [since, setSince] = useState(0);

  const start = async () => {
    setBusy(true);
    setErr('');
    try {
      let id = created?.id;
      if (!id) {
        try {
          const a = await api('/accounts', {
            method: 'POST',
            body: { label: label.trim() || null, identifier: identifier.trim() },
          });
          id = a.id;
        } catch (e) {
          if (e.code === 'duplicate' && e.details?.accountId) {
            id = e.details.accountId; // pehle se hai → usi pe OTP
          } else {
            setErr(e.message);
            return;
          }
        }
        setCreated({ id });
      }
      setSince(Date.now()); // Firebase poll: isi time ke baad ke SMS
      await api(`/accounts/${id}/otp-request`, { method: 'POST' });
      setStep(2);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const success = () => {
    setStep(3);
    setTimeout(onSaved, 900);
  };

  if (step === 2) {
    return (
      <Modal title={`Verify OTP — ${label || identifier}`} onClose={onClose}>
        <OtpStep accountId={created.id} onSuccess={success} onBack={() => setStep(1)} since={since} />
      </Modal>
    );
  }
  if (step === 3) {
    return (
      <Modal title="Account ready" onClose={onClose}>
        <div style={{ textAlign: 'center', padding: '10px 0' }}>
          <div style={{ fontSize: 40 }}>✅</div>
          <div style={{ fontWeight: 600 }}>Session saved — account Active</div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Add Account"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={start} disabled={busy || !identifier.trim()}>
            {busy ? 'Sending OTP…' : 'Send OTP'}
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
          OTP aapke number / email pe aayega — wahi 6 digit next step me bharoge.
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

/** Import JSON — export file paste/upload → parse → /accounts/bulk (Phase 3.1). */
function ImportJson({ onClose, onSaved }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => {
    if (!text.trim()) return { items: [], skipped: 0, total: 0 };
    try {
      return parseAccountsJson(text);
    } catch (e) {
      return { error: e.message, items: [], skipped: 0, total: 0 };
    }
  }, [text]);

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(f);
  };

  const save = async () => {
    if (parsed.error || parsed.items.length === 0) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api('/accounts/bulk', { method: 'POST', body: { items: parsed.items } });
      onSaved({ ...r, skipped: r.skipped + parsed.skipped });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const preview = parsed.items.slice(0, 5);

  return (
    <Modal
      title="Import Accounts (JSON)"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={busy || !!parsed.error || parsed.items.length === 0}
          >
            {busy ? 'Importing…' : `Import ${parsed.items.length}`}
          </Button>
        </>
      }
    >
      <div className="field">
        <label>JSON file</label>
        <input className="input" type="file" accept=".json,application/json" onChange={onFile} />
        <div className="hint">
          Flexible fields — phone/mobile/phone_number/number/email (identifier), label/username/name
          (label). Token wale exports (access_token ke saath) seedha <b>active</b> import honge —
          OTP nahi lagega.
        </div>
      </div>
      <div className="field">
        <label>…ya JSON paste karo</label>
        <textarea
          className="input"
          rows={6}
          placeholder='[{"phone":"+91 98123 45678","label":"Shop-1"}, "9876543210"]'
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
      {parsed.error && <div className="error-text">{parsed.error}</div>}
      {!parsed.error && text.trim() && (
        <div className="hint">
          {parsed.items.length} ready · {parsed.skipped} skip
          {preview.length > 0 && (
            <div className="small muted" style={{ marginTop: 4 }}>
              e.g. {preview.map((p) => `${p.identifier}${p.label ? ` (${p.label})` : ''}`).join(' · ')}
            </div>
          )}
        </div>
      )}
      {err && <div className="error-text">{err}</div>}
    </Modal>
  );
}
