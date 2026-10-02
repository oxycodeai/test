import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// ── Platform ────────────────────────────────────────────────
export function isTermux() {
  return (
    process.env.TERMUX_VERSION !== undefined ||
    process.platform === 'android' ||
    fs.existsSync('/data/data/com.termux')
  );
}

export function platformName() {
  return isTermux() ? 'termux' : process.platform;
}

// ── Env config (defaults TRD §12) ───────────────────────────
const int = (v, d) => {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: int(process.env.PORT, 3000),
  scanConcurrency: int(process.env.SCAN_CONCURRENCY, 2),
  reqDelayMinMs: int(process.env.REQ_DELAY_MIN_MS, 2000),
  reqDelayMaxMs: int(process.env.REQ_DELAY_MAX_MS, 5000),
  affiliateMode: process.env.AFFILIATE_MODE || 'cuelinks',
  checkoutDryRun: String(process.env.CHECKOUT_DRY_RUN || 'false') === 'true',
  tunnel: String(process.env.TUNNEL || '1') !== '0',
  nodeEnv: process.env.NODE_ENV || 'production',
};

// ── Paths ───────────────────────────────────────────────────
export const paths = {
  root: path.resolve(import.meta.dirname, '../..'),
  sessions: process.env.KARTBULK_SESSIONS_DIR
    ? path.resolve(process.env.KARTBULK_SESSIONS_DIR)
    : path.resolve(import.meta.dirname, '../../sessions'),
  captchas: path.resolve(import.meta.dirname, '../../data/captchas'),
  logs: path.resolve(import.meta.dirname, '../../logs'),
  webDist: path.resolve(import.meta.dirname, '../web/dist'),
};

// ── Small utils ─────────────────────────────────────────────
export const now = () => Date.now();

export function jitter(minMs = config.reqDelayMinMs, maxMs = config.reqDelayMaxMs) {
  return Math.floor(minMs + Math.random() * Math.max(0, maxMs - minMs));
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function maskIdentifier(id) {
  const s = String(id);
  if (s.length <= 6) return '***';
  return s.slice(0, 3) + 'x'.repeat(Math.max(3, s.length - 6)) + s.slice(-2);
}

export function hostname() {
  return os.hostname();
}
