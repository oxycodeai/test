// Cuelinks publisher API client (docs/INTEGRATIONS.md Part A).
// Base URL/paths implement ke time developers.cuelinks.com se verify karo —
// yehi adapter update hoga, API contract same rahega.
import { config } from '../../shared/constants.js';

const BASE = process.env.CUELINKS_BASE || 'https://pubapi.cuelinks.com';

export function isConfigured() {
  return config.affiliateMode === 'cuelinks' && !!process.env.CUELINKS_API_KEY;
}

async function call(method, path, body) {
  const key = process.env.CUELINKS_API_KEY;
  if (!key) throw new Error('CUELINKS_API_KEY not set');
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Auth-Token': key,
      'Content-Type': 'application/json',
      ...(process.env.CUELINKS_CHANNEL_ID ? { 'Channel-Id': process.env.CUELINKS_CHANNEL_ID } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cuelinks ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** Affiliate link convert — defensive: response shape unknown-versions ke liye flexible. */
export async function convertLink(originalUrl) {
  if (!isConfigured()) return { url: originalUrl, mode: 'manual', converted: false };
  try {
    const data = await call('POST', '/pub_api/v3/links/convert', {
      original_url: originalUrl,
      ...(process.env.CUELINKS_CHANNEL_ID ? { channel_id: process.env.CUELINKS_CHANNEL_ID } : {}),
    });
    const url =
      data?.short_url || data?.url || data?.data?.short_url || data?.data?.url || data?.link;
    if (url) return { url, mode: 'cuelinks', converted: true };
    return { url: originalUrl, mode: 'cuelinks', converted: false, note: 'no url in response' };
  } catch (err) {
    console.warn('[cuelinks] convert failed:', err.message);
    return { url: originalUrl, mode: 'cuelinks', converted: false, note: err.message };
  }
}

/** Phase 4 — commission transactions sync. */
export async function listTransactions({ from, to, status } = {}) {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  if (status) q.set('status', status);
  const data = await call('GET', `/pub_api/v3/transactions?${q}`);
  return data?.data?.transactions || data?.transactions || data?.data || [];
}
