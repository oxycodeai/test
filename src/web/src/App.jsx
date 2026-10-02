import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { api, getToken, setToken } from './lib/api.js';
import { ToastProvider } from './components/Toasts.jsx';
import Layout from './components/Layout.jsx';
import AuthPage from './pages/Auth.jsx';
import Dashboard from './pages/Dashboard.jsx';
import FetchPage from './pages/Fetch.jsx';
import Accounts from './pages/Accounts.jsx';
import Scan from './pages/Scan.jsx';
import Orders from './pages/Orders.jsx';
import Commission from './pages/Commission.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const [state, setState] = useState({ loading: true, authed: false, setup: false });

  const check = async () => {
    try {
      const s = await api('/auth/status');
      if (s.setup_required) return setState({ loading: false, authed: false, setup: true });
      if (!getToken()) return setState({ loading: false, authed: false, setup: false });
      await api('/stats'); // token validate
      setState({ loading: false, authed: true, setup: false });
    } catch (err) {
      if (err.status === 401) setToken('');
      setState({ loading: false, authed: false, setup: false });
    }
  };

  useEffect(() => {
    check();
    const onUnauth = () => {
      setToken('');
      setState({ loading: false, authed: false, setup: false });
    };
    window.addEventListener('kb:unauthorized', onUnauth);
    return () => window.removeEventListener('kb:unauthorized', onUnauth);
  }, []);

  if (state.loading) return <div className="center-screen">Loading…</div>;

  if (!state.authed) {
    return (
      <AuthPage
        setup={state.setup}
        onDone={() => {
          setState({ loading: false, authed: true, setup: false });
        }}
      />
    );
  }

  const logout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      /* ignore */
    }
    setToken('');
    setState({ loading: false, authed: false, setup: false });
  };

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout onLogout={logout} />}>
            <Route index element={<Dashboard />} />
            <Route path="fetch" element={<FetchPage />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="scan" element={<Scan />} />
            <Route path="orders" element={<Orders />} />
            <Route path="commission" element={<Commission />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
