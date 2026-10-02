# Phase 4 — Orders (Hybrid) + Commission Dashboard

**Goal:** Allocation → auto checkout (COD) → CAPTCHA auto/manual → real order + commission tracking.
**Depends on:** Phase 3 DoD approved.
**Status:** ⬜ Not Started

## Tasks

### 4.1 Allocation (F7 + F11 guard)

- [ ] `POST /api/orders/allocate` — scan_results (eligible only) → split qty:
  - `total` mode: cheapest-first ya round-robin (setting) → `[{account_id, qty}]`
  - `per_account` mode: har eligible acc pe `per_acc_qty`
- [ ] Allocation preview UI — dry table before run (account × qty × price, total ₹)
- [ ] Guards: qty insufficient → blocked with reason; amount cap (`order_amount_cap`)

### 4.2 Checkout Runner (F10 — Hybrid)

- [ ] Worker `order` job per allocation — flow INTEGRATIONS B4: Buy Now → address (default saved) → COD → captcha → Place Order
- [ ] **Pre-flight:** live price vs scan price ±5% → else `failed:'price_changed'`
- [ ] **CAPTCHA auto path:** screenshot → `tesseract.js` OCR (2 tries) → fill → submit
  - accept → order_ref (success page) → `placed` + SSE toast
  - reject → `captcha_png` save → `pending` + SSE → queue
- [ ] Failure taxonomy: `no_address` / `cod_unavailable` / `price_changed` / `blocked` / `captcha_failed` — clear error text
- [ ] `CHECKOUT_DRY_RUN=true` — all steps but no Place Order click (dev testing)
- [ ] Address pre-check before batch run (setup hint if none)

### 4.3 Orders UI (F10)

- [ ] `/orders` tabs: **Pending CAPTCHA** (hero) | Placed | Failed
- [ ] Pending card: captcha image (clean), text input, yellow **Place Order**, Enter submit; bulk "Retry auto-solve"
- [ ] Placed list: account, product, qty, price, order ref (copy), time
- [ ] Failed list: reason chip + **Retry**
- [ ] Dashboard: today's orders count live

### 4.4 Commission (F11)

- [ ] `src/server/integrations/cuelinks.js` — `transactions` + `reports/summary` sync (INTEGRATIONS A4); status map + upsert `commission_events`
- [ ] `POST /api/commission/sync` + auto every 6h (setting)
- [ ] `GET /api/commission?period=today|7d|month` → totals + items
- [ ] `/commission` UI — 3 stat cards (yellow accent on Total), period toggle, table with status pills, Sync button (`Synced n new`)

### 4.5 Notifications

- [ ] SSE events: `order_placed`, `order_failed`, `captcha_pending`, `commission_synced` → toasts
- [ ] Dashboard recent activity feed

## DoD (Definition of Done)

- [ ] Scan 10 acc (5 COD) → qty 5 total mode → allocation preview: 5 accounts × 1 (cheapest first), non-COD excluded
- [ ] `CHECKOUT_DRY_RUN=true` → full flow runs, no order placed, steps logged
- [ ] Real order (user consent, small amount): auto path ya pending queue se place → **order_ref** saved, toast
- [ ] CAPTCHA pending flow: image dikh, type karo, Enter → placed
- [ ] Failure cases show correct reason (no_address etc.)
- [ ] Commission: Sync → real Cuelinks numbers dashboard pe (ya manual mode ka clean empty state)
- [ ] Amount cap + price-change guard verified
- [ ] Lint/test green; demo end-to-end

## Exit

→ Phase 5 (Bulk/Perf Polish + PWA)
