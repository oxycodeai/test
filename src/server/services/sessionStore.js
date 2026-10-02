// Session file security (R9, TRD §10): sessions/<accountId>.json,
// chmod 600, optional AES-256-GCM jab SESSION_ENC_KEY set ho.
// state_path me sirf filename store hoti hai (dir move/portability safe).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { paths } from '../../shared/constants.js';
import { getDb } from '../../db/index.js';

function encKey() {
  const hex = process.env.SESSION_ENC_KEY;
  if (!hex) return null;
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('SESSION_ENC_KEY must be 64 hex chars (32 bytes) — see .env.example');
  }
  return Buffer.from(hex, 'hex');
}

const fileFor = (accountId) => path.join(paths.sessions, `${accountId}.json`);

/** storageState save karo (+ sessions row upsert). Encrypted ya plain. */
export function saveSession(accountId, state) {
  const k = encKey();
  let payload = JSON.stringify(state);
  let encrypted = 0;
  if (k) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
    const ct = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    payload = JSON.stringify({
      v: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ct: ct.toString('base64'),
    });
    encrypted = 1;
  }
  fs.mkdirSync(paths.sessions, { recursive: true });
  const file = fileFor(accountId);
  fs.writeFileSync(file, payload);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* windows pe best-effort */
  }

  const t = Date.now();
  getDb()
    .prepare(
      `INSERT INTO sessions (account_id, state_path, encrypted, login_at, expires_at)
       VALUES (?, ?, ?, ?, NULL)
       ON CONFLICT(account_id) DO UPDATE SET
         state_path = excluded.state_path,
         encrypted = excluded.encrypted,
         login_at = excluded.login_at`
    )
    .run(accountId, path.basename(file), encrypted, t);
  return file;
}

/** Load + decrypt (key set ho to). Missing/corrupt → null. */
export function loadSession(accountId) {
  const file = fileFor(accountId);
  if (!fs.existsSync(file)) return null;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }

  let payload = raw;
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (obj && obj.v && obj.ct) {
    const k = encKey();
    if (!k) return null; // encrypted hai par key nahi — safe fail
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(obj.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(obj.tag, 'base64'));
      payload = Buffer.concat([
        decipher.update(Buffer.from(obj.ct, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      return null; // wrong key / tampered
    }
  }

  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

export function hasSession(accountId) {
  return fs.existsSync(fileFor(accountId));
}

/** File + DB row dono hatao (account delete par). */
export function deleteSession(accountId) {
  try {
    fs.rmSync(fileFor(accountId), { force: true });
  } catch {
    /* ignore */
  }
  getDb().prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
}
