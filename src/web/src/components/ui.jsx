export function Button({
  variant = 'outline',
  size,
  as: As = 'button',
  className = '',
  children,
  ...rest
}) {
  return (
    <As className={`btn ${variant} ${size === 'sm' ? 'sm' : ''} ${className}`} {...rest}>
      {children}
    </As>
  );
}

const PILL_TONES = {
  active: 'green',
  placed: 'green',
  approved: 'green',
  paid: 'blue',
  expired: 'red',
  failed: 'red',
  error: 'red',
  reversed: 'red',
  pending: 'yellow',
  running: 'yellow',
  queued: 'yellow',
  auto: 'gray',
  solved: 'yellow',
  ok: 'green',
  cancelled: 'gray',
};

export function Pill({ status, children }) {
  const tone = PILL_TONES[status] || 'gray';
  return (
    <span className={`pill ${tone}`}>
      <span className="dot" />
      {children || status}
    </span>
  );
}

export function StatCard({ label, value, accent }) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
    </div>
  );
}

export function EmptyState({ icon = '📦', title, hint, action }) {
  return (
    <div className="empty">
      <span className="ico">{icon}</span>
      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      {hint && (
        <div className="small" style={{ marginTop: 4 }}>
          {hint}
        </div>
      )}
      {action}
    </div>
  );
}

export function Skeleton({ w = '100%', h = 14, style }) {
  return <div className="skeleton" style={{ width: w, height: h, ...style }} />;
}

export function Modal({ title, onClose, children, actions }) {
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}
