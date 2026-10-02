# Phase 2 — Multi-Account OTP Login + Session Health + Alerts

**Goal:** 100-200 real Flipkart accounts login, session persist, expiry red alerts.
**Depends on:** Phase 1 DoD approved.
**Status:** 🔄 In Progress — 19/19 tasks ✅ · DoD 4/7 (3 blocked: real accounts + Flipkart IP cooldown)

## Tasks

### 2.1 OTP Login Flow (F2)

- [x] `shared/flipkart-login.js` — text-first selectors: identifier input, Send OTP, OTP boxes, Verify; Akamai/access-block detection
- [x] Worker step 1 `otp-request` — launch headless context, fill identifier, click Send OTP, hold page in memory map (`otpRequestId`, TTL 5 min) → `202`
- [x] Worker step 2 `verify` — user OTP fill → wait logged-in marker → `storageState()` → `sessions/<id>.json` (chmod 600) → `status='active'`
- [x] API: `POST /accounts`, `POST /accounts/:id/otp-request`, `POST /accounts/:id/login`, error mapping (invalid OTP / blocked / rate-limited)
- [x] Global login rate limit (≤10/min) via queue
- [x] Accounts API: list (filter/page), create, delete, bulk create

### 2.2 Accounts UI (F4)

- [x] `/accounts` page — table (desktop) / cards (phone): checkbox, label, masked identifier, **status pill**, last checked, actions
- [x] Toolbar: search, status filter, select-all, batch actions bar (Check health, Delete)
- [x] Add Account modal (single) + **Bulk Add modal** (textarea `identifier,label`) → `{created, skipped}` summary
- [x] **OTP wizard** — 3 steps (Send OTP → 6-digit auto-advance OTP input → success); reused for Re-login
- [x] Status pills: green Active / red Expired / yellow Pending / gray Error

### 2.3 Session Security (R9)

- [x] `sessions/` gitignored + write `chmod 600`
- [x] Optional AES-256-GCM encryption when `SESSION_ENC_KEY` set (encrypt on save, decrypt on launch)
- [x] No state contents in logs/API (only path + metadata)

### 2.4 Health Checker + Alerts (F3, R4)

- [x] Worker job `health` — every `health_interval_min` (default 10): load state → `isLoggedIn(page)` marker → update `last_checked`/`status`
- [x] Expired → `status='expired'` + SSE `{type:'session_expired'}` → toast + Accounts red badge + Dashboard banner
- [x] Batch endpoint `POST /accounts/health` (select-all manual check)
- [x] Re-login path: expired row → wizard → re-save session (B1 reuse)
- [x] Dashboard stats: active count live (`/api/stats`)

## DoD (Definition of Done)

- [ ] 10 ek real accounts login → sab Active, `sessions/*.json` present, state file repo me nahi (gitignore verify) — ⛔ real accounts chahiye + IP cooldown
- [ ] Ek session file manually delete/harass → health run pe **red badge + toast** < 10 min — ⛔ active session chahiye (pending path live verified)
- [x] Bulk Add 50 lines paste → summary correct (duplicates skipped) — live: `{created:49, skipped:1, total:50}`
- [ ] Re-login expired account → wapas Active — ⛔ real session chahiye
- [x] `SESSION_ENC_KEY` on → file ciphertext (head me JSON nahi) — `tests/session-store.test.js` roundtrip + wrong-key null
- [x] Rate limit: login spam pe clear error, server block nahi hua — live: 10×410 + 11th 429
- [x] Lint/test green — eslint clean, 20/20 tests, web build ok

## Exit

→ Phase 3 (Scan Engine + Qty Logic)
