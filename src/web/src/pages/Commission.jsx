import { useEffect, useState } from 'react';
import { api, inr } from '../lib/api.js';
import { Button, StatCard, EmptyState, Skeleton } from '../components/ui.jsx';
import { useToast } from '../components/Toasts.jsx';

export default function Commission() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api('/commission')
      .then(setData)
      .catch((e) => toast(e.message, 'error'));

  useEffect(() => {
    load();
  }, []);

  const sync = async () => {
    setBusy(true);
    toast('Real sync Phase 4 me aayega (Cuelinks transactions API)', 'warn');
    setBusy(false);
  };

  if (!data) return <Skeleton h={120} />;

  return (
    <div>
      <div className="page-head">
        <div className="row between">
          <div>
            <h1>Commission</h1>
            <p>Real affiliate earnings — Cuelinks API.</p>
          </div>
          <Button variant="primary" size="sm" onClick={sync} disabled={busy}>
            Sync
          </Button>
        </div>
      </div>

      <div className="grid stats">
        <StatCard label="Total" value={inr(data.total)} accent />
        <StatCard label="Pending" value={inr(data.pending)} />
        <StatCard label="Approved" value={inr(data.approved)} />
        <StatCard label="Mode" value={data.mode} />
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        {!data.available ? (
          <EmptyState icon="₹" title="Sync not active yet" hint={data.reason} />
        ) : (
          <EmptyState
            icon="₹"
            title="No commission events"
            hint="Orders place hote hi yahan aayenge."
          />
        )}
      </div>
    </div>
  );
}
