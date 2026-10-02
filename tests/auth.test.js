import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const TMP = path.resolve('.tmp-test/auth');
fs.rmSync(TMP, { recursive: true, force: true });
process.env.KARTBULK_DATA_DIR = TMP;

const { hashPin, verifyPin, setPin, isPinSet, tokenValid } =
  await import('../src/server/middleware/auth.js');
const { migrate } = await import('../src/db/migrate.js');
const { setSetting, closeDb } = await import('../src/db/index.js');
migrate();

test('pin hash + verify', () => {
  const h = hashPin('1234');
  assert.equal(h, hashPin('1234'));
  assert.notEqual(h, hashPin('1235'));
  assert.equal(h.length, 64); // sha256 hex
});

test('setPin validates length', () => {
  assert.throws(() => setPin('12'), /at least 4/);
});

test('auth flow: setup → token → valid', () => {
  assert.equal(isPinSet(), false, 'fresh DB pe pin nahi');
  assert.equal(tokenValid({ headers: {}, query: {} }), false, 'no pin → no auth');

  setPin('9999');
  assert.ok(isPinSet());
  assert.ok(verifyPin('9999'));
  assert.ok(!verifyPin('0000'));

  setSetting('auth_token', 'abc123');
  assert.equal(tokenValid({ headers: { 'x-auth-token': 'abc123' }, query: {} }), true);
  assert.equal(tokenValid({ headers: {}, query: { token: 'abc123' } }), true);
  assert.equal(tokenValid({ headers: { cookie: 'kb_token=abc123' }, query: {} }), true);
  assert.equal(tokenValid({ headers: { 'x-auth-token': 'wrong' }, query: {} }), false);

  closeDb();
  fs.rmSync(TMP, { recursive: true, force: true });
});
