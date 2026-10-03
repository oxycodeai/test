# Changelog — KartBulk

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) — dates in `YYYY-MM-DD`.

## [Unreleased]

### Added

- **Booking/orders retry hardening:** `POST /api/bookings/:id/requote` (failed quote se wapas), `POST /api/orders/:id/retry` ab price-null par `price_check` enqueue karta hai, order handler me login-wall detection (honest `SESSION_EXPIRED` error + SSE).

### Removed

- **Commission feature (2026-10-03):** `/api/commission` route, `/commission` page, nav entry, Dashboard "Month Earning" card + quick link, `month_earning` stats field, `listTransactions()` — sab hata diya. `commission_events` table legacy rakhi (tests). Earnings affiliate network ke dashboard pe. Docs (PRD/TRD/UI-UX/INTEGRATIONS + phases) updated.

### Added

- **Phase 0 — Documentation:** `docs/` (PRD, TRD, UI-UX, INTEGRATIONS, RISKS, SETUP, CHANGELOG) and `phases/` (index + phase-0..5 task checklists).
