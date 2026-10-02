import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Dashboard', ico: '▦' },
  { to: '/fetch', label: 'Fetch', ico: '🔍' },
  { to: '/accounts', label: 'Accounts', ico: '👤' },
  { to: '/scan', label: 'Scan', ico: '📡' },
  { to: '/orders', label: 'Orders', ico: '🛒' },
  { to: '/commission', label: 'Commission', ico: '₹' },
  { to: '/settings', label: 'Settings', ico: '⚙' },
];

// phone: 5 primary tabs (dashboard, fetch, scan, orders, more→accounts)
const BOTTOM = ['/', '/fetch', '/scan', '/orders', '/accounts'];

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
        {NAV.filter((n) => BOTTOM.includes(n.to)).map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <span className="ico">{n.ico}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
