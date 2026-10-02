import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// isolated DB — import se pehle set hona zaroori hai
const TMP = path.resolve('.tmp-test/db');
fs.rmSync(TMP, { recursive: true, force: true });
process.env.KARTBULK_DATA_DIR = TMP;

const { migrate } = await import('../src/db/migrate.js');
const dbMod = await import('../src/db/index.js');

before(() => {
  migrate();
});

after(() => {
  dbMod.closeDb();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test('migrate creates all tables', () => {
  const db = dbMod.getDb();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
    .all()
    .map((r) => r.name);
  for (const t of [
    'accounts',
    'sessions',
    'products',
    'scan_jobs',
    'scan_results',
    'orders',
    'commission_events',
    'settings',
    'jobs',
  ]) {
    assert.ok(tables.includes(t), `missing table: ${t}`);
  }
});

test('migrate is idempotent', () => {
  migrate();
  migrate();
  assert.ok(true);
});

test('settings roundtrip', () => {
  dbMod.setSetting('k', 'v');
  assert.equal(dbMod.getSetting('k'), 'v');
  dbMod.setSetting('k', 'v2');
  assert.equal(dbMod.getSetting('k'), 'v2');
  assert.equal(dbMod.getSetting('nope', 'def'), 'def');
});

test('transaction commit + rollback', () => {
  const db = dbMod.getDb();
  db.exec('CREATE TABLE IF NOT EXISTS t_tx (a INTEGER)');
  db.exec('DELETE FROM t_tx');
  db.transaction(() => db.prepare('INSERT INTO t_tx VALUES (?)').run(1))();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM t_tx').get().n, 1);
  assert.throws(() =>
    db.transaction(() => {
      db.prepare('INSERT INTO t_tx VALUES (?)').run(2);
      throw new Error('boom');
    })()
  );
  assert.equal(db.prepare('SELECT COUNT(*) n FROM t_tx').get().n, 1, 'rollback works');
});
