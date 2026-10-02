# Phase 3 — Import + Sections + Address Book + CashKaro/EarnKaro Fetch

**Goal:** JSON import, section grouping, saved address book, multi-platform fetch (Flipkart/CashKaro/EarnKaro).
**Depends on:** Phase 2 DoD approved.
**Status:** ✅ Complete (2026-10-02) — scope changed: scan engine hataya (per-account price quote ab booking wizard andar hai, Phase 4).

## Tasks

### 3.1 JSON Import (accounts)

- [x] Client parser `src/web/src/lib/import.js` — flexible fields (`identifier|phone|mobile|phone_number|number|email`, `label|username|name`), `+91`/leading-0 normalize, array-of-strings OK, duplicates skip
- [x] Bulk route `POST /accounts/bulk` — same flexible keys server-side
- [x] Accounts UI — **⬆ Import JSON** (file upload + paste, preview `N ready · M skip`, reuse bulk → `Created X, skipped Y`)
- [x] `.gitignore` += `accounts_export*.json` (token wale exports kabhi commit nahi)
- [x] Verified: real `accounts_export_*.json` (6 Stan accounts) → 6/6 parsed, tokens ignored

### 3.2 Sections (account groups)

- [x] `sections` table (before accounts), accounts.`section_id` FK (ON DELETE SET NULL), guarded `ALTER` in `migrate.js`
- [x] `GET/POST/DELETE /api/sections` (409 duplicate, counts: accounts/active/booked)
- [x] `POST /api/accounts/assign-section {ids, section_id|null}`
- [x] Accounts UI — Section column, section filter dropdown, batch-bar "Assign to section…"
- [x] Settings UI — Sections card (create/delete + counts)

### 3.3 Address Book

- [x] `addresses` table (name/phone/pincode/line1/line2/city/state/is_default)
- [x] `GET/POST/PUT/DELETE /api/addresses` (validation: 6-digit pincode, 10-15 digit phone, single default)
- [x] Settings UI — Address Book card (CRUD modal)
- [x] Booking wizard uses it; checkout par sirf yehi address add/select hota hai (purane nahi)

### 3.4 CashKaro/EarnKaro Fetch

- [x] `pageFetch.js` — `detectPlatform`, `isSupportedAffiliateUrl`, `resolveAffiliateUrl` (HTTP redirect loop ≤10 hops → Playwright fallback for JS/meta redirect → must land on flipkart `/p/`), `fetchProductWithSession` (session-based personalized price, quote step ke liye)
- [x] `products` += `platform`, `affiliate_url` (guarded ALTER); row stores canonical flipkart URL + original affiliate link
- [x] `POST /products/fetch` — accepts all 3 platforms; Cuelinks convert sirf `platform='flipkart'` ke liye; CK/EK link khud native affiliate hota hai
- [x] Fetch UI — copy + platform pill + native-affiliate label

## DoD

- [x] Import JSON (file/paste) → created/skipped counts; real export file 6/6
- [x] Sections CRUD + assign + filter; counts live
- [x] Address CRUD + default; booking wizard select karta hai
- [x] CK/EK paste → resolve → product fetch (IP-block hone par honest error)
- [x] Existing DB migrate (guarded columns) + lint + 20/20 tests + web build
- [ ] Real CK/EK link se live fetch (Flipkart IP cooldown ke baad)

## Exit

→ Phase 4 (Booking Engine + Orders)
