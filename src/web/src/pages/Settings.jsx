import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Pill, Skeleton } from '../components/ui.jsx';
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
        <p>System info, security aur data.</p>
      </div>

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

      <div className="card">
        <h2 className="card-title">Roadmap status</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Phase 1 live ✔ · Phase 2 (OTP login + health alerts) → Phase 3 (scan) → Phase 4 (orders +
          commission) → Phase 5 (bulk/perf + PWA). Details: <code>phases/</code> folder.
        </p>
      </div>
    </div>
  );
}
