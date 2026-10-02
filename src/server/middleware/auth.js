import crypto from 'node:crypto';
import { getSetting, setSetting } from '../../db/index.js';

const COOKIE = 'kb_token';

export function hashPin(pin) {
  return crypto.createHash('sha256').update(`kartbulk:${pin}`).digest('hex');
}

export function isPinSet() {
  return !!getSetting('auth_pin_hash');
}

export function verifyPin(pin) {
  const stored = getSetting('auth_pin_hash');
  return !!stored && stored === hashPin(String(pin));
}

export function setPin(pin) {
  if (!pin || String(pin).length < 4) {
    const e = new Error('PIN must be at least 4 characters');
    e.status = 400;
    throw e;
  }
  setSetting('auth_pin_hash', hashPin(String(pin)));
}

export function createToken() {
  const token = crypto.randomBytes(32).toString('hex');
  setSetting('auth_token', token);
  return token;
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf('=');
        return i === -1 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      })
  );
}

export function tokenValid(req) {
  if (!isPinSet()) return false; // pin set hone se pehle sab blocked (secure first-run)
  const stored = getSetting('auth_token');
  if (!stored) return false;
  const cookies = parseCookies(req);
  const given = req.headers['x-auth-token'] || cookies[COOKIE] || req.query?.token;
  if (!given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function setAuthCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${60 * 60 * 24 * 30}`
  );
}

/** Express middleware — /api/* except auth bootstrap. */
export function requireAuth(req, res, next) {
  if (tokenValid(req)) return next();
  if (!isPinSet() && req.path.startsWith('/auth')) return next();
  res.status(401).json({ error: { code: 'unauthorized', message: 'Auth required' } });
}
