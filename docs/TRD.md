# TRD — KartBulk Technical Design

**Version:** 1.0
**Status:** Draft
**Date:** 2026-10-02

## 1. Stack (Locked)

| Layer      | Choice                             | Notes                                                                                                |
| ---------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Runtime    | Node.js 22.5+ (24 LTS recommended) | Single language across server/worker/web                                                             |
| API        | Express 4                          | REST + SSE                                                                                           |
| Automation | Playwright                         | PC: `playwright` + bundled Chromium; Termux: `playwright-core` + system Chromium                     |
| DB         | SQLite via built-in `node:sqlite`  | WAL mode; zero native deps (Termux pe bina compile ke chalta hai); better-sqlite3-compatible wrapper |
| Frontend   | React 18 + Vite                    | Mobile-first; no heavy UI lib (custom Flipkart theme)                                                |
| Tunnel     | cloudflared                        | Free public HTTPS URL                                                                                |
| OCR        | tesseract.js                       | COD CAPTCHA solve (WASM, no native install)                                                          |

## 2. Architecture

```
                    ┌──────────────────────────────────────┐
                    │  Browser (Phone / PC)                │
                    │  React SPA  ←── SSE progress         │
                    └──────────────┬───────────────────────┘
                                   │ HTTPS (cloudflared tunnel)
                    ┌──────────────▼───────────────────────┐
                    │  Express Server (port 3000)          │
                    │  ├─ REST API /api/*                  │
                    │  ├─ SSE /api/stream                  │
                    │  ├─ Static /  (React build)          │
                    │  └─ Auth gate (PIN/session)          │
                    └──────┬───────────────────┬───────────┘
                           │                   │
              ┌────────────▼─────┐   ┌─────────▼──────────┐
              │ SQLite (WAL)     │   │ Job Queue (SQLite) │
              │ accounts,        │   │ scan/health/order  │
              │ sessions(meta),  │   │ rows + status      │
              │ products, prices,│   └─────────┬──────────┘
              │ orders,佣金       │             │ poll
              └──────────────────┘   ┌─────────▼──────────┐
                                     │ Worker (in-process │
                                     │ or child process)  │
                                     │ Playwright engine  │
                                     │ concurrency ≤ 2    │
                                     └─────────┬──────────┘
                                               │
                                     ┌─────────▼──────────┐
                                     │ Flipkart.com       │
                                     │ + Cuelinks API     │
                                     └────────────────────┘
```

**Decision:** Worker server ke andar hi `setInterval` poll loop se chalega (alag process nahi) — Termux pe simple rakha hai. Server restart = worker restart. Queue SQLite me hai to kuch bhi lost nahi hoga.

## 3. Platform Detection (Termux vs PC)

```js
// src/worker/platform.js
const isTermux =
  process.env.TERMUX_VERSION !== undefined ||
  process.platform === 'android' ||
  fs.existsSync('/data/data/com.termux');

function launchOptions() {
  if (isTermux) {
    return {
      executablePath:
        process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        '--single-process',
        '--js-flags=--jitless',
      ],
      env: { PLAYWRIGHT_BROWSERS_PATH: '0' },
    };
  }
  return { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
}
```

Rules:

- Termux: `playwright-core` only (no browser download), system Chromium, jitless (Android 10+ W^X), single-process (Android 14 phantom killer)
- PC: normal `playwright`, `chromium` channel
- Both: `headless: true` default (OTP flow hamare UI me aata hai, browser window ki zaroorat nahi)

## 4. DB Schema

```sql
PRAGMA journal_mode = WAL;

CREATE TABLE accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  label         TEXT,                       -- user ka naam (e.g. "Shop-05")
  identifier    TEXT NOT NULL,              -- phone ya email (unique login key)
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','active','expired','error')),
  last_checked  INTEGER,                    -- epoch ms
  last_error    TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_accounts_identifier ON accounts(identifier);

CREATE TABLE sessions (                     -- cookie files ka metadata
  account_id    INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  state_path    TEXT NOT NULL,              -- sessions/<id>.json
  encrypted     INTEGER NOT NULL DEFAULT 0, -- AES-256-GCM if 1
  login_at      INTEGER,
  expires_at    INTEGER
);

CREATE TABLE products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL,
  pid           TEXT,                       -- Flipkart product id (pid=)
  title         TEXT, image TEXT,
  mrp           INTEGER, price INTEGER, special_price INTEGER,
  discount_pct  REAL,
  in_stock      INTEGER,
  cod_product   INTEGER,                    -- product-level COD (API/page)
  offers_json   TEXT,                       -- [{title, desc}]
  fetched_at    INTEGER NOT NULL
);

CREATE TABLE scan_jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER REFERENCES products(id),
  qty           INTEGER NOT NULL,
  qty_mode      TEXT NOT NULL CHECK (qty_mode IN ('total','per_account')),
  per_acc_qty   INTEGER DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','running','done','failed','cancelled')),
  progress      INTEGER NOT NULL DEFAULT 0, -- accounts processed
  total         INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE scan_results (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER REFERENCES scan_jobs(id) ON DELETE CASCADE,
  account_id    INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  price         INTEGER,
  special_price INTEGER,
  offers_json   TEXT,
  cod_available INTEGER,
  eligible      INTEGER NOT NULL DEFAULT 1, -- COD filter ke baad
  status        TEXT NOT NULL DEFAULT 'ok', -- ok | expired | error
  error         TEXT,
  scanned_at    INTEGER NOT NULL,
  UNIQUE (job_id, account_id)
);

CREATE TABLE orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id        INTEGER REFERENCES scan_jobs(id),
  account_id    INTEGER REFERENCES accounts(id),
  product_id    INTEGER REFERENCES products(id),
  qty           INTEGER NOT NULL DEFAULT 1,
  price         INTEGER,
  captcha_state TEXT NOT NULL DEFAULT 'auto'
                CHECK (captcha_state IN ('auto','pending','solved','placed','failed')),
  captcha_png   TEXT,                       -- pending ke liye screenshot path
  order_ref     TEXT,                       -- Flipkart order id (placed hone pe)
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE commission_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL DEFAULT 'cuelinks',
  external_id   TEXT,                       -- transaction id
  amount        INTEGER NOT NULL,           -- paise me
  status        TEXT NOT NULL,              -- pending | approved | paid | reversed
  product_title TEXT,
  order_date    INTEGER,
  synced_at     INTEGER NOT NULL,
  UNIQUE (source, external_id)
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE jobs (                         -- generic queue: health | scan | order
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type       TEXT NOT NULL,                 -- 'health' | 'scan' | 'order'
  ref_id     INTEGER,                       -- scan_jobs.id / orders.id / account_id
  status     TEXT NOT NULL DEFAULT 'queued'
             CHECK (status IN ('queued','running','done','failed')),
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_jobs_queue ON jobs(status, created_at);
```

## 5. API Contracts

Base: `/api` — sab JSON. Auth: `X-Auth-Token` header (PIN login ke baad cookie bhi).

### Health

| Method | Path      | Body/Query | Response                     |
| ------ | --------- | ---------- | ---------------------------- |
| GET    | `/health` | —          | `{ok:true, platform:'termux' | 'pc', version}` |

### Accounts

| Method | Path                             | Body                           | Response                                                     |
| ------ | -------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| GET    | `/accounts?status=&page=&limit=` | —                              | `{items:[{id,label,identifier,status,last_checked}], total}` |
| POST   | `/accounts`                      | `{label, identifier}`          | account row                                                  |
| POST   | `/accounts/bulk`                 | `{items:[{label,identifier}]}` | `{created, skipped}`                                         |
| DELETE | `/accounts/:id`                  | —                              | `{ok}`                                                       |
| POST   | `/accounts/:id/login`            | `{otp}` (step 2)               | `{ok, status:'active'}`                                      |
| POST   | `/accounts/:id/otp-request`      | —                              | `{ok, sessionToken, debugOtp?}`                              |
| POST   | `/accounts/health`               | `{ids?}`                       | `{queued}` (batch health job)                                |

**OTP flow (F2):**

```
1. POST /accounts  → {identifier}          → server worker: flipkart login page kholta,
                                             phone number bharta, "Send OTP" dabata
                                             → 202 {accountId, otpRequestId}
2. (Flipkart OTP user ke phone/Gmail pe aaya)
3. POST /accounts/:id/login {otp}          → worker OTP bharta, session save
                                             → 200 {status:'active'}
Dev mode: step 1 response me debugOtp field (Flipkart page se intercept kiya hua).
```

### Products / Fetch

| Method | Path              | Body    | Response                                                                                 |
| ------ | ----------------- | ------- | ---------------------------------------------------------------------------------------- |
| POST   | `/products/fetch` | `{url}` | `{id, title, image, mrp, price, discount_pct, cod_product, offers[], productUrl(affid)}` |
| GET    | `/products/:id`   | —       | product row                                                                              |

### Scan

| Method | Path                  | Body                                        | Response                                                     |
| ------ | --------------------- | ------------------------------------------- | ------------------------------------------------------------ |
| POST   | `/scan`               | `{product_id, qty, qty_mode, per_acc_qty?}` | `{job_id}` — 409 agar qty > active accs (with `{available}`) |
| GET    | `/scan/:jobId`        | —                                           | `{status, progress, total, results[]}`                       |
| GET    | `/scan/:jobId/stream` | SSE                                         | `event: progress {progress,total}` + `event: result {row}`   |
| POST   | `/scan/:jobId/cancel` | —                                           | `{ok}`                                                       |

### Orders

| Method | Path                  | Body                    | Response                                          |
| ------ | --------------------- | ----------------------- | ------------------------------------------------- |
| POST   | `/orders/allocate`    | `{job_id}`              | `{allocations:[{account_id, qty}]}` (dry preview) |
| POST   | `/orders/run`         | `{job_id, allocations}` | `{queued:n}`                                      |
| GET    | `/orders?status=`     | —                       | order list                                        |
| GET    | `/orders/:id/captcha` | —                       | `image/png`                                       |
| POST   | `/orders/:id/captcha` | `{text}`                | `{status:'placed' \| 'failed'}`                   |
| POST   | `/orders/:id/retry`   | —                       | `{ok}`                                            |

### Commission

| Method | Path                              | Response                              |
| ------ | --------------------------------- | ------------------------------------- |
| POST   | `/commission/sync`                | `{synced:n}`                          |
| GET    | `/commission?period=today\|month` | `{total, pending, approved, items[]}` |

### Stream / System

| Method | Path      | Response                                                   |
| ------ | --------- | ---------------------------------------------------------- |
| GET    | `/stream` | SSE — toasts: session_expired, order_placed, job_done      |
| GET    | `/stats`  | `{active_accs, pending_jobs, today_orders, month_earning}` |

## 6. Job Queue & Concurrency

```js
// Worker loop — har 1.5s
// 1. queued job uthao (LIMIT 1, type priority: order > scan > health)
// 2. running mark karo
// 3. execute (switch by type)
// 4. done/failed mark; attempts < 3 → retry
//
// Concurrency safety:
// - Global browser semaphore: max 2 contexts concurrently
// - Per-host delay: 2000–5000ms jitter between Flipkart requests
// - Single worker loop (no parallel job pickup) → rate-limit safe by design
// - Bulk = queue me daalo, loop sequentially process karega
```

Throughput estimate: 200 acc health @ ~4s/acc = ~13 min (background). Scan 50 acc @ ~5s = ~4 min. UI pe live progress SSE se.

## 7. Price Extraction (per-account)

```js
// Flipkart product page → __NEXT_DATA__ (SSR JSON) — HTML selectors SEEDHA mat pakdo
async function extractProduct(page) {
  const data = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    return el ? JSON.parse(el.textContent) : null;
  });
  // path: props.pageProps.initialState.product... — central selector config me (shared/selectors.js)
  // Fallback: JSON-LD <script type="application/ld+json"> (price, availability)
  // Fallback 2: content-pattern (₹ regex + line-through CSS) — sirf tab jab JSON na mile
}
```

- `shared/selectors.js` me sab path ek jagah — Flipkart path badle to ek file update
- JSON parse fail → job `failed` with error, UI pe red row (silent failure nahi)

## 8. Checkout Flow (Hybrid — F10)

```
per allocated account:
  1. load product (session) → Buy Now / Add to Cart
  2. cart → checkout → address select (saved address default)
  3. payment: COD select
  4. CAPTCHA step:
     a. screenshot nikalo → tesseract.js OCR → text
     b. fill + verify → agar accept hua → Place Order (AUTO)
     c. agar OCR galat/rejected (max 2 try) → captcha_png save
        → order.captcha_state = 'pending' → SSE event → UI queue
  5. user UI pe image dekh ke text type → POST /orders/:id/captcha → place
  6. success → order_ref save, order_placed toast
```

Safety: order amount cap (setting, default ₹50,000 COD limit se kam), 5-min dry-run freshness.

## 9. Session Health (F3)

```js
// har 10 min (setting: health_interval_min)
// for each account (semaphore 2):
//   context = storageState load → goto flipkart.com → check login marker
//   marker: header pe account menu visible / my-orders redirect nahi hua
//   ok → status='active', last_checked=now
//   fail → status='expired' → session row delete? (nahi — re-login option)
//        → SSE event session_expired {accountId} → UI red badge + toast
```

Re-login: expired account pe "Re-login" button → OTP wizard again (Phase 2 flow reuse).

## 10. Security

| Item            | Rule                                                                                |
| --------------- | ----------------------------------------------------------------------------------- |
| sessions/*.json | `.gitignore`; chmod 600; optional AES-256-GCM (key in .env `SESSION_ENC_KEY`)       |
| .env            | CUELINKS_API_KEY, AUTH_PIN, SESSION_ENC_KEY — kabhi repo me nahi                    |
| Tunnel          | cloudflared quick tunnel (random URL) default; named tunnel + domain optional       |
| Auth gate       | First visit pe PIN set (settings table); `/api` 401 without token — public URL safe |
| Cuelinks        | Server-side only call; key browser me kabhi nahi                                    |

## 11. Error Handling Principles

1. **No silent failures** — har error DB job row + UI toast + SSE
2. Retry: jobs max 3 attempts with exponential backoff (5s, 15s, 45s)
3. Flipkart HTML/JSON structure change → selectors.js update, not code rewrite
4. Worker crash → server restart loop (`scripts/start-*.sh` me `while true` + pm2 optional)

## 12. Config (settings table + .env)

| Key                   | Default               | Where    |
| --------------------- | --------------------- | -------- |
| `health_interval_min` | 10                    | settings |
| `scan_concurrency`    | 2                     | .env     |
| `req_delay_min_ms`    | 2000                  | .env     |
| `req_delay_max_ms`    | 5000                  | .env     |
| `order_amount_cap`    | 49000                 | settings |
| `auth_pin`            | unset (first-run set) | settings |
| `CUELINKS_API_KEY`    | —                     | .env     |
| `CUELINKS_CHANNEL_ID` | —                     | .env     |
| `SESSION_ENC_KEY`     | —                     | .env     |
