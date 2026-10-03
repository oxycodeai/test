# Phase 4 — Booking Engine (Quote → Total → Book) + Orders + Commission

**Goal:** Section se allocate → har account ka **real personalized price quote** → **TOTAL** dekh ke Book → COD-only checkout → green "Booked" status.
**Depends on:** Phase 3 Complete.
**Status:** 🟡 In Progress (2026-10-02) — engine + UI built, real-order DoD pending Flipkart IP cooldown.

## Tasks

### 4.1 Bookings (schema + quote/confirm API)

- [x] `bookings` table (status quoting/quoted/running/done/failed/cancelled, qty_mode total|per_account, total_amount) + `orders` += booking_id/address_id/price
- [x] `POST /api/bookings` — allocate free **active** accounts (section-wise, `booked_until` expired/null only) → orders rows → enqueue `price_check` per order
  - total mode: `eligible < qty` → **409 `{available, needed}`**
  - per_account mode: har eligible × per_acc_qty
- [x] `GET /api/bookings` + `GET /api/bookings/:id` (orders + account masked)
- [x] `POST /:id/confirm` — sirf `quoted` state (else 409) → `running` + order jobs
- [x] `POST /:id/cancel` — queued jobs fail + status cancelled
- [x] `POST /:id/requote` — failed/stuck quote se wapas quoting + price-NULL orders dobara quote (in-flight skip; running-stage failed par 409) — G1 fix
- [x] `bookingStore.refreshBooking` — quoting: price/error done → `quoted` (≥1 price) / `failed`; running: placed/failed → `done`/`failed` + SSE `booking_status`

### 4.2 Worker — price_check + order (checkout)

- [x] `price_check` — session load → `fetchProductWithSession` (account ka real price) → orders.price; no session → honest fail; refreshBooking
- [x] `order` — flow: product page (block check) → **price pre-flight ±5%** → amount cap (`order_amount_cap` 49000) → Buy Now → address (hamara match name+phone+pincode, warna add-address form fill; **purane addresses nahi**) → **COD only** → captcha (OCR skip → pending + SSE) → Place Order
- [x] Manual captcha: `POST /api/orders/:id/captcha {text}` → memory consume-once → flow replay with text
- [x] Success → `order_ref` + `accounts.booked_until = now + booked_days*86400` (setting, default 3 din) + SSE `order_placed`
- [x] Login-wall detection (G3) — Buy Now/address ke baad `/account/login` redirect → honest `Session expired — OTP login dobara karo` (410) + account expired + SSE
- [x] `CHECKOUT_DRY_RUN=true` → saare steps, Place Order click nahi (`DRY-RUN` ref)
- [x] `POST /api/orders/:id/retry` — price NULL → `price_check` enqueue (failed booking → quoting reset); warna `order` (G2 fix — pehle dead-end 409 tha)
- [x] `POST /api/accounts/:id/release` — green flag manual hatao

### 4.3 Orders + Booking UI

- [x] `/booking` wizard (Scan ki jagah; `/scan` → redirect) — 1 Product → 2 Section+qty mode → 3 Address → 4 **Quote table** (Account | Qty | Real price | Status) + **TOTAL row** + Book button + live SSE refresh
- [x] `/orders` — tabs Pending CAPTCHA (hero) | Placed | Failed | All; captcha modal (image + input + Enter); Failed → Retry/Re-quote (price-NULL bhi retryable)
- [x] QuoteTable — failed par **Re-quote (same accounts)** button → `POST /:id/requote`; quoted par **Re-quote pending (n)** (partial quote failures)
- [x] Accounts — green **Booked Nd** pill (expiry days) + Release button + `status=booked` filter
- [x] Nav: "Scan" → "Book"

### 4.4 Commission — ❌ REMOVED (2026-10-03)

- [x] ~~Cuelinks `transactions` sync + auto 6h + `/commission` UI~~ — **feature hata diya** (user decision): route + page + nav + `month_earning` stat + `listTransactions()` sab delete; `commission_events` table legacy rakhi (tests assert); `convertLink` intact (fetch attribution)

## DoD

- [x] Quote flow: allocate → per-account price jobs → failed/quoted transition honest
- [x] Guards: insufficient 409, confirm-before-quote 409, captcha wrong-state 409, cancel invalid-state 409
- [x] Import + sections + addresses live-verified via API (smoke)
- [x] Lint clean · 20/20 tests · web build
- [ ] `CHECKOUT_DRY_RUN=true` full flow (Flipkart IP block ke baad — session wale account chahiye)
- [ ] Real order (user consent, small amount, COD) → order_ref + booked green pill
- [ ] CAPTCHA pending → manual solve → placed
- [x] ~~Commission sync~~ — feature removed 2026-10-03

## Exit

→ Phase 5 (Bulk/Perf Polish + PWA)
