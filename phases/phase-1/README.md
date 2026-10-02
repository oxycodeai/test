# Phase 1 — Foundation + Theme + Affiliate Fetch + Hosting

**Goal:** Runnable skeleton — server + DB + themed React UI + real product fetch + Termux/PC/tunnel setup.
**Depends on:** Phase 0 approved. ✅
**Status:** 🔄 In Progress — DoD pending (Flipkart throttle cooldown)

## Tasks

### 1.1 Scaffold
- [x] Root `package.json` (workspaces: `src/web`), scripts (`start:termux`, `start:pc`, `dev`, `db:migrate`, `smoke`, `test`, `lint`)
- [x] `.env.example` (all keys from TRD §12) + `.gitignore` (`.env`, `data/`, `sessions/`, `node_modules/`, `logs/`, `src/web/dist/`)
- [x] Folder skeleton: `src/server`, `src/worker`, `src/web`, `src/db`, `src/shared`, `scripts/`
- [x] Lint/format setup (ESLint 9 flat config + `eslint-plugin-react` + Prettier) + `npm test` (node:test) — **lint clean, 13/13 tests pass**

### 1.2 Database
- [x] `src/db/schema.sql` — 9 tables per TRD §4 (accounts, sessions, products, scan_jobs, scan_results, orders, commission_events, settings, jobs) — idempotent `IF NOT EXISTS`
- [x] Migrate script `npm run db:migrate` (idempotent, WAL, indexes)
- [x] `src/db/index.js` — **`node:sqlite` built-in wrapper** (better-sqlite3 dropped — Node 24 prebuilt missing + Termux zero-compile win) + transaction helper + settings helpers; `db:backup` via `VACUUM INTO`

### 1.3 Server Core
- [x] Express app: JSON body, static serve (web build), `/api/health`, `/api/stats`
- [x] **PIN auth gate** — first-run PIN set (`/api/auth/setup`), login, cookie + `X-Auth-Token` + `?token=` (SSE), timing-safe compare, 401 gate verified
- [x] Error middleware — `{error:{code,message}}`, 404 handler, async wrapper
- [x] SSE endpoint `/api/stream` (hello + ping + broadcast bus)
- [x] Accounts API: list (search/filter/page, masked identifiers), create, **bulk** (dedup + validation), delete
- [x] `validIdentifier` — phone (6-15 digits) / email pattern only

### 1.4 Worker Skeleton
- [x] `src/worker/platform.js` — Termux/PC detect + `launchOptions()` (TRD §3) + shared browser pool
- [x] Job queue poll loop (`jobs` table): single-flight, attempts ≤3, exponential backoff, handler registry
- [x] Playwright smoke test — **`npm run smoke` PASS** (Flipkart loaded 1.9s, win32 + chromium-1243)

### 1.5 React App + Flipkart Theme
- [x] Vite + React scaffold, proxy `/api` → 3000, build → `src/web/dist` (**194 kB JS / 62 kB gzip**)
- [x] Design tokens CSS vars (UI-UX §1) + components: Button, Pill, StatCard, EmptyState, Skeleton, Modal, Toasts (SSE-driven)
- [x] Layout: sticky header + **phone bottom-nav / desktop sidebar** (NavLink active states)
- [x] Router + 7 pages: Dashboard, Fetch, Accounts, Scan, Orders, Commission, Settings
- [x] PIN screen (first-run setup + login, mismatch/length validation)
- [x] Dashboard: 4 stat cards (Month Earning yellow accent) + quick actions + recent products + inactive-accounts banner

### 1.6 Affiliate Fetch (F1 — Real Data)
- [x] `src/server/integrations/cuelinks.js` — `Auth-Token` header, `links/convert` (defensive response parse), `AFFILIATE_MODE=manual` fallback, transactions stub for Phase 4
- [x] `POST /api/products/fetch` — URL validate → 15-min cache → convert → normalize → `products` row → SSE `product_fetched`
- [x] Page fetcher `pageFetch.js` — layered: raw fetch (JSON-LD/og) → browser render (`extractInPage` fn: JSON-LD + `__NEXT_DATA__` + style-based MRP + font-based price + DOM offers + bodyText) + **blocked-page detect + 3× backoff retry + clear 429 error** (R7)
- [x] Fetch UI — URL input + yellow Fetch → product card (image, title, MRP strike, price 24px, discount chip, offers list, COD/stock pills, "Updated X min ago", affiliate link Copy) + recent fetches
- [x] Commission endpoint stub `GET /api/commission` (`available:false` + reason)

### 1.7 Hosting & Scripts
- [x] `scripts/setup-termux.sh` — pkg deps, storage, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD, chromium path → .env, migrate
- [x] `scripts/setup-pc.sh` — deps, `npx playwright install chromium`, cloudflared check, migrate
- [x] `scripts/start.js` — migrate → server (crash-restart 3s loop) → cloudflared quick tunnel (URL parse + print) — cross-platform
- [x] `scripts/dev.js` — server `--watch` + Vite HMR
- [ ] `docs/SETUP.md` verify on **real Termux** (Termux available nahi hai is machine pe — user ke phone pe Phase-end demo me)

### 1.8 Verify
- [x] `npm run lint` clean · `npm test` 13/13 · `npm run web:build` ok
- [x] Server boot + API flow tested (setup→login→stats→accounts bulk)
- [x] `npm run smoke` browser+Flipkart PASS
- [x] E2E (`scripts/e2e-demo.js`): PIN login ✔ → dashboard screenshot ✔ → account add (masked row) ✔ → **fetch: Flipkart 529 throttle (datacenter IP) — blocked-detection + clear error working; real product card pending cooldown**
- [ ] **DoD:** fetch E2E green (real product card) + full DoD checklist below

## DoD (Definition of Done)

- [x] Ek command pe server up (migrate + server + tunnel URL print) — `scripts/start.js`
- [x] PIN gate kaam karta hai (wrong/missing → 401; first-run setup)
- [x] Phone/PC responsive UI — desktop sidebar + bottom-nav (screenshots: `logs/e2e-dashboard.png`, `logs/e2e-accounts.png`, `logs/e2e-failure.png`)
- [ ] **Koi bhi Flipkart product link paste → REAL product card < 3s** (blocked by Flipkart 529 throttle on this IP — retry after cooldown)
- [ ] Termux live run (user ke phone pe — SETUP.md ke according)
- [ ] Demo: fetch flow green

## Known issues / notes

- **Flipkart 529/load-shed:** is datacenter IP ko abhi throttle kar raaha hai (homepage/search/product sab). Blocked-page detect + backoff + clear error implemented; product card E2E cooldown ke baad.
- `npm approve-scripts` warning (esbuild postinstall blocked) — build phir bhi chalta hai (platform binary optionalDeps se aata hai).
- Termux `playwright` package — `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` setup script me.

## Exit

→ Phase 2 (Multi-Login + Sessions + Alerts)
