// Firebase RTDB OTP inbox — SMS-forwarder panel se Flipkart OTP khud lao (auto-login).
// Structure (read-only GET, kuch likhte nahi):
//   automation/numbers/{phone} → { deviceId }        (phone → device mapping)
//   messages/{deviceId}/{epochMs} → { message, sender, dateTime, type }
// Config (.env): FIREBASE_DB_URL (required) · FIREBASE_DB_AUTH (optional)
//                FIREBASE_MAP_NODE · FIREBASE_MSG_NODE (defaults upar wale)

const dbUrl = () => (process.env.FIREBASE_DB_URL || '').trim().replace(/\/+$/, '');
const dbAuth = () => (process.env.FIREBASE_DB_AUTH || '').trim();
const mapNode = () =>
  (process.env.FIREBASE_MAP_NODE || 'automation/numbers').replace(/^\/+|\/+$/g, '');
const msgNode = () => (process.env.FIREBASE_MSG_NODE || 'messages').replace(/^\/+|\/+$/g, '');

/** Cuelinks isConfigured pattern — key na ho toh feature off. */
export function isConfigured() {
  return !!dbUrl();
}

async function rtdbGet(path, params = {}) {
  const u = new URL(`${dbUrl()}/${path}.json`);
  if (dbAuth()) u.searchParams.set('auth', dbAuth());
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    const e = new Error(`Firebase RTDB ${res.status} (${path})`);
    e.status = 502;
    throw e;
  }
  return res.json();
}

/** "9812345678" / "+91…" / "91…" → try dono forms (mapping keys mixed hain). */
function phoneVariants(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  const core = d.length === 12 && d.startsWith('91') ? d.slice(2) : d;
  const out = [];
  if (core) out.push(core, `91${core}`);
  if (d && d !== core) out.push(d);
  return [...new Set(out)];
}

const core10 = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length === 12 && d.startsWith('91') ? d.slice(2) : d;
};

const devCache = new Map(); // core10 → { deviceId, exp } (TTL 10 min)

/** automation/numbers/{phone} → deviceId (cache). Miss par null. */
export async function findDeviceId(phone) {
  const core = core10(phone);
  const hit = devCache.get(core);
  if (hit && hit.exp > Date.now()) return hit.deviceId;
  for (const v of phoneVariants(phone)) {
    let node = null;
    try {
      node = await rtdbGet(`${mapNode()}/${v}`);
    } catch {
      continue; // RTDB down/timeout → last variant ka error bahar dikhega
    }
    const dev = node && (node.deviceId || node.device || node.device_id);
    if (dev) {
      const deviceId = String(dev);
      devCache.set(core, { deviceId, exp: Date.now() + 10 * 60_000 });
      return deviceId;
    }
  }
  return null;
}

const OTP6 = /(?<!\d)(\d{6})(?!\d)/;
const FLIP_RE = /flipkart|fkrt|flipkart\.com/i;

function pickOtp(rows) {
  const withOtp = rows.filter((m) => OTP6.test(String(m.message || '')));
  const pick = withOtp.find((m) => FLIP_RE.test(String(m.message || ''))) || withOtp[0];
  if (!pick) return { found: false, reason: 'no_otp' };
  const code = String(pick.message || '').match(OTP6);
  if (!code) return { found: false, reason: 'no_otp' };
  return {
    found: true,
    otp: code[1],
    at: Number(pick.id || pick.key) || null,
    sender: pick.sender || null,
  };
}

function inWindow(m, since) {
  const ts = Number(m.id || m.key) || 0;
  if (ts < since) return false;
  if (m.type && m.type !== 'incoming') return false; // sirf received SMS
  return true;
}

async function deviceRows(deviceId, since) {
  const msgs = await rtdbGet(`${msgNode()}/${deviceId}`, {
    orderBy: '"$key"',
    limitToLast: '8',
  });
  return Object.entries(msgs || {})
    .map(([k, v]) => ({ key: Number(k), device: deviceId, ...(v || {}) }))
    .filter((m) => inWindow(m, since));
}

let lastHitDevice = null; // fallback scan ka last winner — agli poll pe pehle wahi

/**
 * since (epoch ms) ke baad ka newest OTP message.
 * Pehle mapping (automation/numbers) se device; miss ho toh SAB devices scan
 * (serial login safe — rate limit 10/min ke saath ek time pe ek hi OTP hota hai).
 * Priority: Flipkart-text wala message > koi bhi 6-digit incoming.
 * Returns { found, otp?, at?, sender?, reason? } — kuch likhta nahi.
 */
export async function fetchLatestOtp(phone, since = 0) {
  const deviceId = await findDeviceId(phone);
  if (deviceId) {
    const rows = await deviceRows(deviceId, since);
    return pickOtp(rows);
  }

  // Fallback: mapping miss → sab devices scan (batches of 12), pehle last-hit device
  if (lastHitDevice) {
    try {
      const rows = await deviceRows(lastHitDevice, since);
      const hit = pickOtp(rows);
      if (hit.found) return hit;
    } catch {
      /* full scan karenge */
    }
  }
  const keys = await rtdbGet(msgNode(), { shallow: 'true' });
  const ids = Object.keys(keys || {});
  if (ids.length === 0) return { found: false, reason: 'no_device' };
  const all = [];
  for (let i = 0; i < ids.length; i += 12) {
    const batch = await Promise.all(
      ids.slice(i, i + 12).map(async (id) => {
        try {
          return await deviceRows(id, since);
        } catch {
          return []; // device read fail → skip
        }
      })
    );
    all.push(...batch.flat());
  }
  if (all.length === 0) return { found: false, reason: 'no_otp' };
  all.sort((a, b) => (Number(b.id || b.key) || 0) - (Number(a.id || a.key) || 0));
  const out = pickOtp(all);
  if (out.found && out.at) {
    const winner = all.find((m) => (Number(m.id || m.key) || 0) === out.at);
    if (winner?.device) lastHitDevice = winner.device;
  }
  return out;
}
