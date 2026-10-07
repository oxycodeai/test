// Firebase RTDB OTP inbox — SMS-forwarder panel se Flipkart OTP khud lao (auto-login).
// Structure (read-only GET, kuch likhte nahi):
//   automation/numbers/{phone} → { deviceId }        (phone → device mapping)
//   messages/{deviceId}/{epochMs} → { message, sender, dateTime, type }
// Config (.env): FIREBASE_DB_URL (comma-separated panels; entry = "url" ya "url|||auth"
//                — har forwarder panel alag RTDB ho sakta hai) · FIREBASE_DB_AUTH (default auth)
//                FIREBASE_MAP_NODE · FIREBASE_MSG_NODE (defaults upar wale)

/**
 * FIREBASE_DB_URL: comma-separated panel list. Entry "url" ya "url|||auth"
 * (per-panel token); FIREBASE_DB_AUTH sab entries ka default auth.
 */
function panels() {
  const fallbackAuth = (process.env.FIREBASE_DB_AUTH || '').trim();
  return (process.env.FIREBASE_DB_URL || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [url, auth] = entry.split('|||');
      return { url: url.replace(/\/+$/, ''), auth: (auth || '').trim() || fallbackAuth };
    });
}
const mapNode = () =>
  (process.env.FIREBASE_MAP_NODE || 'automation/numbers').replace(/^\/+|\/+$/g, '');
const msgNode = () => (process.env.FIREBASE_MSG_NODE || 'messages').replace(/^\/+|\/+$/g, '');

/** Cuelinks isConfigured pattern — panel list empty ho toh feature off. */
export function isConfigured() {
  return panels().length > 0;
}

/**
 * Path GET — sab panels PARALLEL (pehla non-null result panel-order me jeeta).
 * Serial chalne pe 9 panels × 8s = har OTP poll 30-40s kha jaata tha.
 */
async function rtdbGet(path, params = {}) {
  const ps = panels();
  if (!ps.length) {
    throw Object.assign(new Error('FIREBASE_DB_URL empty'), { status: 501 });
  }
  const settled = await Promise.allSettled(
    ps.map(async (p) => {
      const u = new URL(`${p.url}/${path}.json`);
      if (p.auth) u.searchParams.set('auth', p.auth);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw Object.assign(new Error(`Firebase RTDB ${res.status} (${path})`), { status: 502 });
      return await res.json();
    })
  );
  let sawOk = false;
  for (const r of settled) {
    if (r.status === 'fulfilled') {
      sawOk = true;
      if (r.value != null) return r.value;
    }
  }
  if (sawOk) return null;
  const bad = settled.find((r) => r.status === 'rejected');
  throw (
    (bad && bad.reason) ||
    Object.assign(new Error(`Firebase RTDB timeout (${path})`), { status: 502 })
  );
}

/** Shallow keys — sab panels se merge (parallel). */
async function rtdbShallowKeys(path) {
  const ps = panels();
  const settled = await Promise.allSettled(
    ps.map(async (p) => {
      const u = new URL(`${p.url}/${path}.json`);
      if (p.auth) u.searchParams.set('auth', p.auth);
      u.searchParams.set('shallow', 'true');
      const res = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`shallow ${res.status}`);
      return await res.json().catch(() => null);
    })
  );
  const keys = new Set();
  let sawOk = false;
  for (const r of settled) {
    if (r.status !== 'fulfilled') continue;
    sawOk = true;
    for (const k of Object.keys(r.value || {})) keys.add(k);
  }
  if (!sawOk && ps.length === 0) {
    throw Object.assign(new Error('FIREBASE_DB_URL empty'), { status: 501 });
  }
  return [...keys];
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
const devMiss = new Map(); // core10 → exp — mapping miss pe har poll re-scan mat karo

/** automation/numbers/{phone} → deviceId (cache + 60s miss-cache). Miss par null. */
export async function findDeviceId(phone) {
  const core = core10(phone);
  const hit = devCache.get(core);
  if (hit && hit.exp > Date.now()) return hit.deviceId;
  const miss = devMiss.get(core);
  if (miss && miss > Date.now()) return null;
  for (const v of phoneVariants(phone)) {
    let node = null;
    try {
      node = await rtdbGet(`${mapNode()}/${v}`);
    } catch {
      continue; // RTDB down/timeout → last variant ka error bahar dikhega
    }
    // value shapes: {deviceId} | deviceId-string | true (present flag — device unknown)
    const dev =
      typeof node === 'string'
        ? node
        : node && typeof node === 'object'
          ? node.deviceId || node.device || node.device_id
          : null;
    if (dev) {
      const deviceId = String(dev);
      devCache.set(core, { deviceId, exp: Date.now() + 10 * 60_000 });
      devMiss.delete(core);
      return deviceId;
    }
  }
  devMiss.set(core, Date.now() + 60_000);
  return null;
}

const OTP6 = /(?<!\d)(\d{6})(?!\d)/;
const FLIP_RE = /flipkart|fkrt|flipkart\.com/i;

function pickOtp(rows) {
  const withOtp = rows.filter((m) => OTP6.test(String(m.message || '')));
  // Strict: Flipkart wala message (text ya sender) — random 6-digit (bank/other
  // SMS) se galat OTP submit hota hai. Naya resend purane ko invalidate karta
  // hai — isliye NEWEST Flipkart match lo (rows ascending hain, last = latest).
  const flip = withOtp.filter((m) =>
    FLIP_RE.test(`${m.message || ''} ${m.sender || ''}`)
  );
  const otpWord = withOtp.filter((m) =>
    /\botp\b|verification code|one[- ]?time/i.test(String(m.message || ''))
  );
  const pick = flip.length ? flip[flip.length - 1] : otpWord.length ? otpWord[otpWord.length - 1] : null;
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
  const keys = await rtdbShallowKeys(msgNode());
  const ids = keys;
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
