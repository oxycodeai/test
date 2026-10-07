// Telegram — multi-chat fan-out + per-booking LIVE progress message.
// Rule: ek booking = EK message (pehli baar send, baaki editMessageText se
// update; error bhi usi me). Alag-alag spam messages NAHI.
// Silent-fail: TG down/missing config ho to order flow KABHI affect nahi hona chahiye.
// Env LAZY read (dotenv.config ke baad bhi sahi kaam kare — import order independent).

const cooldown = new Map(); // key → last-sent ts (alert spam guard)
const prog = new Map(); // bid → { ids: Map(chatId→msgId), last, lastAt, pending, timer }

const token = () => process.env.TELEGRAM_BOT_TOKEN || '';
const chatIds = () =>
  (process.env.TELEGRAM_CHAT_ID || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function tgEnabled() {
  return Boolean(token()) && chatIds().length > 0;
}

/** Telegram API call — JSON parse, kabhi throw nahi (null = fail). */
async function api(method, payload) {
  if (!token()) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

/**
 * Alert message — SABHI chat IDs pe bhejo. cooldownSec optional — same key pe
 * pehle itne seconds me ek hi message jaayega. Hamesha boolean, kabhi throw nahi.
 */
export async function tgSend(text, cooldownSec = 0, key = '') {
  if (!tgEnabled()) return false;
  if (cooldownSec > 0 && key) {
    const last = cooldown.get(key) || 0;
    if (Date.now() - last < cooldownSec * 1000) return false;
    cooldown.set(key, Date.now());
  }
  const t = String(text).slice(0, 3800);
  const rs = await Promise.all(chatIds().map((c) => api('sendMessage', { chat_id: c, text: t })));
  return rs.some((r) => r?.ok);
}

/** Internal: message bhejo (pehli baar) ya edit karo — per chat. */
async function flush(bid, text) {
  let st = prog.get(bid);
  if (!st) {
    st = { ids: new Map(), last: '', lastAt: 0, pending: null, timer: null };
    prog.set(bid, st);
  }
  st.last = text;
  st.lastAt = Date.now();
  for (const chatId of chatIds()) {
    let ok = false;
    const msgId = st.ids.get(chatId);
    if (msgId != null) {
      const r = await api('editMessageText', { chat_id: chatId, message_id: msgId, text });
      ok = Boolean(r?.ok);
      if (!ok) st.ids.delete(chatId); // message delete/old → neeche dobara send
    }
    if (!ok) {
      const r = await api('sendMessage', { chat_id: chatId, text });
      if (r?.ok && r.result?.message_id) st.ids.set(chatId, r.result.message_id);
    }
  }
}

/**
 * Booking LIVE progress — EK hi message per booking.
 * - pehli call: naya message send (msgIds cache)
 * - text same: skip
 * - 1.2s throttle + trailing flush (burst steps me ek hi edit jaye)
 * Hamesha void/silent — kabhi throw nahi.
 */
export function tgProgress(bookingId, text) {
  if (!tgEnabled()) return;
  const t = String(text).slice(0, 3800);
  const st = prog.get(bookingId);
  if (st && st.last === t) return;
  if (!st || Date.now() - st.lastAt >= 1200) {
    void flush(bookingId, t);
    return;
  }
  st.pending = t;
  if (!st.timer) {
    st.timer = setTimeout(() => {
      const sx = prog.get(bookingId);
      if (!sx) return;
      sx.timer = null;
      const p = sx.pending;
      sx.pending = null;
      if (p) void flush(bookingId, p);
    }, 1250);
  }
}
