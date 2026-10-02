-- KartBulk SQLite schema (idempotent — migrate.js har run pe safe)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sections (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT,
  identifier    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','active','expired','error')),
  section_id    INTEGER REFERENCES sections(id) ON DELETE SET NULL,
  booked_until  INTEGER,
  last_checked  INTEGER,
  last_error    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_identifier ON accounts(identifier);
CREATE INDEX IF NOT EXISTS idx_accounts_section ON accounts(section_id);

CREATE TABLE IF NOT EXISTS sessions (
  account_id    INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  state_path    TEXT NOT NULL,
  encrypted     INTEGER NOT NULL DEFAULT 0,
  login_at      INTEGER,
  expires_at    INTEGER
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL,
  platform      TEXT NOT NULL DEFAULT 'flipkart',
  affiliate_url TEXT,
  pid           TEXT,
  title         TEXT,
  image         TEXT,
  mrp           INTEGER,
  price         INTEGER,
  special_price INTEGER,
  discount_pct  REAL,
  in_stock      INTEGER,
  cod_product   INTEGER,
  offers_json   TEXT,
  fetched_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_url ON products(url);

CREATE TABLE IF NOT EXISTS scan_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER REFERENCES products(id),
  qty           INTEGER NOT NULL,
  qty_mode      TEXT NOT NULL DEFAULT 'total'
                CHECK (qty_mode IN ('total','per_account')),
  per_acc_qty   INTEGER DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','done','failed','cancelled')),
  progress      INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER REFERENCES scan_jobs(id) ON DELETE CASCADE,
  account_id    INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  price         INTEGER,
  special_price INTEGER,
  offers_json   TEXT,
  cod_available INTEGER,
  eligible      INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'ok',
  error         TEXT,
  scanned_at    INTEGER NOT NULL,
  UNIQUE (job_id, account_id)
);

CREATE TABLE IF NOT EXISTS addresses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  pincode       TEXT NOT NULL,
  line1         TEXT NOT NULL,
  line2         TEXT,
  city          TEXT NOT NULL,
  state         TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER REFERENCES products(id),
  platform      TEXT,
  affiliate_url TEXT,
  section_id    INTEGER REFERENCES sections(id),
  address_id    INTEGER REFERENCES addresses(id),
  qty           INTEGER NOT NULL,
  qty_mode      TEXT NOT NULL DEFAULT 'total'
                CHECK (qty_mode IN ('total','per_account')),
  per_acc_qty   INTEGER DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'quoting'
                CHECK (status IN ('quoting','quoted','running','done','failed','cancelled')),
  progress      INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  total_amount  INTEGER,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id    INTEGER REFERENCES bookings(id),
  job_id        INTEGER REFERENCES scan_jobs(id),
  account_id    INTEGER REFERENCES accounts(id),
  product_id    INTEGER REFERENCES products(id),
  address_id    INTEGER REFERENCES addresses(id),
  qty           INTEGER NOT NULL DEFAULT 1,
  price         INTEGER,
  captcha_state TEXT NOT NULL DEFAULT 'auto'
                CHECK (captcha_state IN ('auto','pending','solved','placed','failed')),
  captcha_png   TEXT,
  order_ref     TEXT,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_booking ON orders(booking_id);

CREATE TABLE IF NOT EXISTS commission_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL DEFAULT 'cuelinks',
  external_id   TEXT,
  amount        INTEGER NOT NULL,
  status        TEXT NOT NULL,
  product_title TEXT,
  order_date    INTEGER,
  synced_at     INTEGER NOT NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,
  ref_id     INTEGER,
  status     TEXT NOT NULL DEFAULT 'queued'
             CHECK (status IN ('queued','running','done','failed')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_queue ON jobs(status, created_at);
