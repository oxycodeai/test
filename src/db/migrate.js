import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, DB_PATH } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Existing DBs me naye columns — guarded ALTER (duplicate column → skip)
const ADD_COLUMNS = [
  ['accounts', 'section_id', 'INTEGER REFERENCES sections(id) ON DELETE SET NULL'],
  ['accounts', 'booked_until', 'INTEGER'],
  ['products', 'platform', "TEXT NOT NULL DEFAULT 'flipkart'"],
  ['products', 'affiliate_url', 'TEXT'],
  ['orders', 'booking_id', 'INTEGER REFERENCES bookings(id)'],
  ['orders', 'address_id', 'INTEGER REFERENCES addresses(id)'],
  ['orders', 'step', 'TEXT'],
  ['orders', 'attempt_no', 'INTEGER NOT NULL DEFAULT 1'],
  ['bookings', 'n_accounts', 'INTEGER NOT NULL DEFAULT 1'],
  ['bookings', 'qty_per_cart', 'INTEGER NOT NULL DEFAULT 1'],
  ['bookings', 'attempts_per_acc', 'INTEGER NOT NULL DEFAULT 1'],
  ['bookings', 'max_price', 'INTEGER'],
  ['number_pool', 'account_id', 'INTEGER REFERENCES accounts(id) ON DELETE SET NULL'],
];

function addColumns() {
  const db = getDb();
  for (const [table, column, ddl] of ADD_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (cols.length === 0) continue; // table abhi bana hi nahi (fresh DB)
    if (cols.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    console.log(`  + ${table}.${column}`);
  }
}

export function migrate() {
  const db = getDb();
  // Pehle columns add (existing DB pe index/tables ke liye), phir schema.
  // Naye table CREATEs schema.sql me hain — addColumns unhe skip karega.
  addColumns();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  return { ok: true, db: DB_PATH };
}

// Direct run: npm run db:migrate
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const r = migrate();
    console.log(`✔ schema applied → ${r.db}`);
  } catch (err) {
    console.error('✖ migrate failed:', err.message);
    process.exit(1);
  }
}
