// Proxied HTTP helper — Flipkart IP-block fix (settings.proxy_url / .env PROXY_URL).
// Proxy set ho to saari plain fetches undici ProxyAgent se jayengi, warna direct.
import { ProxyAgent } from 'undici';
import { getSetting } from '../../db/index.js';

/** Active proxy URL — setting > .env > null (direct). */
export function getProxyUrl() {
  try {
    const s = getSetting('proxy_url');
    if (s && String(s).trim()) return String(s).trim();
  } catch {
    /* settings table pre-migrate — env fallback */
  }
  return (process.env.PROXY_URL || '').trim() || null;
}

let agent = null;
let agentUrl = null;

function agentFor(url) {
  if (agent && agentUrl === url) return agent;
  agent = new ProxyAgent(url);
  agentUrl = url;
  return agent;
}

/** PUT /api/settings ke baad — naye proxy se fresh agent banega. */
export function resetProxyAgent() {
  agent = null;
  agentUrl = null;
}

/** fetch() jaisa hi — sirf proxy set ho to dispatcher lag jaata hai. */
export async function ffFetch(url, opts = {}) {
  const proxy = getProxyUrl();
  if (!proxy) return fetch(url, opts);
  return fetch(url, { ...opts, dispatcher: agentFor(proxy) });
}
