// Export JSON → accounts items parser (flexible fields, Phase 3.1).
// Accepts: array of objects/strings, ya {items|accounts|data:[...]}

const ID_KEYS = ['identifier', 'phone', 'mobile', 'phone_number', 'number', 'email', 'ph_no'];
const LABEL_KEYS = ['label', 'username', 'name', 'title'];

function normPhone(v) {
  let s = String(v ?? '').trim();
  if (!s) return '';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s; // email — leave as-is
  s = s.replace(/^\+91[\s-]?/, '').replace(/^0/, '').replace(/[\s-]/g, '');
  return s;
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim()) return obj[k];
  }
  return null;
}

/** @returns {{items: {identifier: string, label: string|null}[], skipped: number, total: number}} */
export function parseAccountsJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('File valid JSON nahi hai');
  }
  const arr = Array.isArray(data) ? data : data?.items || data?.accounts || data?.data;
  if (!Array.isArray(arr)) {
    throw new Error('JSON me array nahi mila (array ya {items:[...]} chahiye)');
  }

  const items = [];
  const seen = new Set();
  let skipped = 0;
  for (const raw of arr) {
    let identifier = '';
    let label = null;
    if (typeof raw === 'string' || typeof raw === 'number') {
      identifier = normPhone(raw);
    } else if (raw && typeof raw === 'object') {
      const idv = pick(raw, ID_KEYS);
      identifier = normPhone(idv);
      const lv = pick(raw, LABEL_KEYS);
      label = lv ? String(lv).trim().slice(0, 60) : null;
    }
    const okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
    const okPhone = /^\d{6,15}$/.test(identifier);
    if ((!okEmail && !okPhone) || seen.has(identifier)) {
      skipped++;
      continue;
    }
    seen.add(identifier);
    // Flipkart app-token exports (Firebase style): access_token → session (bina OTP active)
    const item = { identifier, label };
    if (raw && typeof raw === 'object' && raw.access_token) {
      item.session = {
        auth: 'token',
        access_token: String(raw.access_token),
        refresh_token: raw.refresh_token ? String(raw.refresh_token) : null,
        user_id: raw.user_id ?? null,
        username: raw.username ? String(raw.username) : null,
        device_id: raw.device_id ? String(raw.device_id) : null,
        device_uid: raw.device_uid ? String(raw.device_uid) : null,
        user_agent: raw.user_agent ? String(raw.user_agent) : null,
      };
    }
    items.push(item);
  }
  return { items, skipped, total: arr.length };
}
