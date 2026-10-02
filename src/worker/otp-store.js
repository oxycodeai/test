// In-memory OTP state — server + worker same process (TRD §2).
// OTP values kabhi DB/log me nahi jaate; TTL 5 min (INTEGRATIONS B1).
import crypto from 'node:crypto';

const TTL_MS = 5 * 60 * 1000;
const RATE_MAX = 10;
const RATE_WINDOW_MS = 60_000;

/** otpRequestId -> { accountId, context, page, expiresAt } */
const requests = new Map();
/** accountId -> otpRequestId (latest) */
const latest = new Map();
/** accountId -> 6-digit OTP (verify step ke liye, memory only) */
const pendingOtp = new Map();
/** sliding window — global login rate limit (≤10/min, INTEGRATIONS) */
const rateStamps = [];

/** 60s window me 10 se zyada login attempts → throw (status 429, noRetry). */
export function assertLoginRate() {
  const t = Date.now();
  while (rateStamps.length && t - rateStamps[0] > RATE_WINDOW_MS) rateStamps.shift();
  if (rateStamps.length >= RATE_MAX) {
    const e = new Error('Login rate limit (10/min) — minute baad retry karo');
    e.status = 429;
    e.noRetry = true;
    throw e;
  }
  rateStamps.push(t);
}

function closeRequest(id) {
  const r = requests.get(id);
  if (!r) return;
  requests.delete(id);
  if (latest.get(r.accountId) === id) latest.delete(r.accountId);
  r.context.close().catch(() => {});
}

/** Purana request (agar ho) close → naya store karo → otpRequestId return. */
export function putRequest(accountId, context, page) {
  sweep();
  const old = latest.get(accountId);
  if (old) closeRequest(old);
  const id = crypto.randomUUID();
  requests.set(id, { accountId, context, page, expiresAt: Date.now() + TTL_MS });
  latest.set(accountId, id);
  pendingOtp.delete(accountId); // naya OTP → purana pending hatao
  return id;
}

export function getRequest(id) {
  const r = requests.get(id);
  if (!r) return null;
  if (r.expiresAt < Date.now()) {
    closeRequest(id);
    return null;
  }
  return r;
}

export function getRequestForAccount(accountId) {
  const id = latest.get(accountId);
  return id ? getRequest(id) : null;
}

export function latestRequestId(accountId) {
  const id = latest.get(accountId);
  return id && getRequest(id) ? id : null;
}

export function closeRequestForAccount(accountId) {
  const id = latest.get(accountId);
  if (id) closeRequest(id);
}

/** Expired (5 min) requests band karo — OTP screen page memory me nahi rehni chahiye. */
export function sweep() {
  for (const id of [...requests.keys()]) {
    const r = requests.get(id);
    if (r && r.expiresAt < Date.now()) closeRequest(id);
  }
}

export function setPendingOtp(accountId, otp) {
  pendingOtp.set(accountId, String(otp));
}

/** Verify handler ek hi baar lega (consume-once). */
export function takePendingOtp(accountId) {
  const v = pendingOtp.get(accountId);
  pendingOtp.delete(accountId);
  return v || null;
}

/** orderId -> manual captcha text (memory only, consume-once). */
const pendingCaptcha = new Map();

export function setPendingCaptcha(orderId, text) {
  pendingCaptcha.set(orderId, String(text));
}

export function takePendingCaptcha(orderId) {
  const v = pendingCaptcha.get(orderId);
  pendingCaptcha.delete(orderId);
  return v || null;
}
