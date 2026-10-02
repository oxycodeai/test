import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { openStream } from '../lib/api.js';

const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

let idSeq = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const push = useCallback((message, kind = 'info', ttl = 4000) => {
    const id = idSeq++;
    setToasts((t) => [...t, { id, message, kind }]);
    const timer = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
      timers.current.delete(id);
    }, ttl);
    timers.current.set(id, timer);
  }, []);

  useEffect(() => {
    const es = openStream({
      product_fetched: (d) => push(`Product fetched: ${d.title || ''}`.trim(), 'success'),
      job_done: (d) => push(`Job finished (${d.type})`, 'success'),
      job_failed: (d) => push(`Job failed (${d.type}): ${d.error || ''}`.trim(), 'error', 7000),
      session_expired: () => push('Session expired — re-login needed', 'error', 8000),
      order_placed: (d) => push(`Order placed #${d.orderRef || d.id || ''}`.trim(), 'success'),
    });
    return () => es.close();
  }, [push]);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
