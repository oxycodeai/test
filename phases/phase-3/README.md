# Phase 3 — Scan Engine (COD + Per-Account Price) + Qty Logic

**Goal:** Start Scan → har account ka real personalized price/offer/COD comparison table + qty validation.
**Depends on:** Phase 2 DoD approved.
**Status:** ⬜ Not Started

## Tasks

### 3.1 Product Deep-Fetch (F5 base)

- [ ] `shared/selectors.js` — `#__NEXT_DATA__` path config + JSON-LD fallback + content-pattern regex (INTEGRATIONS B3); **verify actual JSON paths** on live Flipkart product page while implementing
- [ ] Extractor: page → price, MRP, special price, offers[], stock, product-level COD text
- [ ] pid parse from URL; product row update with `fetched_at`

### 3.2 Scan Job Pipeline (F5)

- [ ] `POST /api/scan` — `{product_id, qty, qty_mode, per_acc_qty}` → `scan_jobs` row + per-account `jobs` queue entries; **409** if qty > active accs (with `{available}`)
- [ ] Worker `scan` runner — per account: load session → goto product → extract → write `scan_results`; expired mid-scan → row `status='expired'`, account flagged
- [ ] Rate limiting: `scan_concurrency` (≤2) + `REQ_DELAY_*` jitter enforced
- [ ] Progress: update `scan_jobs.progress/total` + SSE `progress` + `result` events (rows stream)
- [ ] Cancel endpoint (stop remaining queue entries)

### 3.3 Qty Logic (F6, F7)

- [ ] Qty guard pre-scan — total mode: `qty > active` → 409; UI warning strip `⚠ Sirf N active hain`
- [ ] `qty_mode='total'`: overall qty distribute karna allocation stage me (Phase 4); scan sab active accounts pe
- [ ] `qty_mode='per_account'`: `per_acc_qty` × accounts = effective demand; warning agar `per_acc_qty` > stock
- [ ] Validation both modes in UI live (input change pe check)

### 3.4 Scan UI (F5, F8, F9)

- [ ] `/scan` config card — product picker (last fetched) ya link paste, qty input, mode toggle (Total | Per account), per-acc qty field, yellow **Start Scan**
- [ ] Qty warning strip (red-tinted, non-blocking) — UI-UX §3.5
- [ ] Progress bar (yellow) + `progress/total` + ETA + cancel
- [ ] **Comparison table** (real data): Account | Price ₹ | Special ₹ | Offers | COD pill | Eligible | Status
  - BEST price row highlight (yellow border + chip)
  - non-COD muted + Eligible ✗ (auto-exclude visual)
  - sortable columns; mobile card-list conversion
- [ ] Summary strip `12/12 · 9 COD · best ₹1,299 (Shop-03) · 3 excluded`
- [ ] Export CSV (`scan_results`)

## DoD (Definition of Done)

- [ ] 10 active accounts + 1 product → Start Scan → **real per-account prices/offers/COD** table (session data, not product-level copy)
- [ ] Ek account expired → row expired + red badge, scan baaki complete
- [ ] qty 5, active 4 → clear warning/409, scan nahi chala (mode: total)
- [ ] per-account mode: `per_acc_qty` validation working
- [ ] Non-COD accounts auto-excluded (eligible ✗) + best price highlighted
- [ ] Live progress (SSE) — rows stream hoti hain, page refresh nahi
- [ ] Scan 10 acc < ~1 min (throttle ke andar) — no rate-limit block
- [ ] CSV export correct; lint/test green

## Exit

→ Phase 4 (Orders Hybrid + Commission)
