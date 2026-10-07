import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Dashboard', short: 'Home', ico: '▦' },
  { to: '/fetch', label: 'Fetch & Order', short: 'Fetch', ico: '🔍' },
  { to: '/accounts', label: 'Accounts', short: 'Accounts', ico: '👤' },
  { to: '/orders', label: 'Orders', short: 'Orders', ico: '🛒' },
  { to: '/live', label: 'Live Progress', short: 'Live', ico: '▶' },
  { to: '/settings', label: 'Settings', short: 'Settings', ico: '⚙' },
];

// phone: poori 5 tabs (short labels) — Settings bhi accessible
const BOTTOM = NAV;

export default function Layout({ onLogout }) {
  return (
    <div>
      <header className="app-header">
        <NavLink to="/" className="logo">
          <span className="bag">🛍</span> KartBulk
        </NavLink>
        <button className="btn ghost sm" onClick={onLogout} title="Logout">
          Logout
        </button>
      </header>

      <div className="app-body">
        <nav className="sidebar" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              <span>{n.ico}</span> {n.label}
            </NavLink>
          ))}
        </nav>

        <main className="main">
          <Outlet />
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary mobile">
        {BOTTOM.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <span className="ico">{n.ico}</span>
            {n.short}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
