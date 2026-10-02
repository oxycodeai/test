import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const TMP = path.resolve('.tmp-test/session-store');
fs.rmSync(TMP, { recursive: true, force: true });
process.env.KARTBULK_DATA_DIR = TMP;
process.env.SESSION_ENC_KEY = 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff';

const { migrate } = await import('../src/db/migrate.js');
const { getDb, closeDb } = await import('../src/db/index.js');
const { saveSession, loadSession, hasSession, deleteSession } = await import(
  '../src/server/services/sessionStore.js'
);
migrate();
getDb()
  .prepare(
    `INSERT INTO accounts (id, identifier, label, status, created_at, updated_at)
     VALUES (7, '9811111111', 't', 'active', 1, 1)`
  )
  .run();

const STATE = { cookies: [{ name: 'fk', value: 'secret-session-token', domain: '.flipkart.com' }] };

test('saveSession → file + sessions row; ciphertext (key set)', () => {
  const file = saveSession(7, STATE);
  assert.ok(fs.existsSync(file), 'file bana');
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('secret-session-token'), 'plain state file me nahi (encrypted)');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.v, 1, 'encrypted envelope');
  const row = getDb().prepare('SELECT * FROM sessions WHERE account_id = 7').get();
  assert.equal(row.encrypted, 1);
  assert.equal(row.state_path, path.basename(file));
});

test('loadSession decrypt roundtrip', () => {
  const s = loadSession(7);
  assert.ok(s, 'load hua');
  assert.equal(s.cookies[0].value, 'secret-session-token');
  assert.equal(hasSession(7), true);
});

test('wrong key → null (safe fail)', () => {
  const saved = process.env.SESSION_ENC_KEY;
  process.env.SESSION_ENC_KEY = 'ff'.repeat(32);
  assert.equal(loadSession(7), null, 'wrong key pe null');
  process.env.SESSION_ENC_KEY = saved;
});

test('deleteSession file + row dono hatao', () => {
  deleteSession(7);
  assert.equal(hasSession(7), false);
  assert.equal(
    getDb().prepare('SELECT COUNT(*) n FROM sessions WHERE account_id = 7').get().n,
    0
  );
});

test('plain save (no key) me state readable + sessions row', () => {
  delete process.env.SESSION_ENC_KEY;
  const file = saveSession(7, STATE);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(raw.includes('secret-session-token'), 'no key → plain file');
  const s = loadSession(7);
  assert.equal(s.cookies[0].value, 'secret-session-token');
  deleteSession(7);

  closeDb();
  fs.rmSync(TMP, { recursive: true, force: true });
});
