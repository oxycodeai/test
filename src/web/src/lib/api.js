const TOKEN_KEY = 'kb_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, code, message, details = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { 'X-Auth-Token': getToken() } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(
      res.status,
      data.error?.code || 'error',
      data.error?.message || res.statusText,
      data.error || {}
    );
    if (res.status === 401) window.dispatchEvent(new Event('kb:unauthorized'));
    throw err;
  }
  return data;
}

/** SSE — cookie auth (login pe set hota hai); token query fallback. */
export function openStream(handlers) {
  const qs = getToken() ? `?token=${encodeURIComponent(getToken())}` : '';
  const es = new EventSource(`/api/stream${qs}`);
  for (const [name, fn] of Object.entries(handlers)) {
    es.addEventListener(name, (e) => {
      try {
        fn(JSON.parse(e.data));
      } catch {
        fn(e.data);
      }
    });
  }
  es.onerror = () => {
    /* EventSource auto-reconnects */
  };
  return es;
}

// ── formatters ──────────────────────────────────────────────
export const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

export const timeAgo = (ts) => {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
