# Phase 5 — Bulk/Performance Polish + PWA

**Goal:** 200-account scale pe fast bulk operations, PWA, notifications, export, hardening.
**Depends on:** Phase 4 DoD approved.
**Status:** ⬜ Not Started

## Tasks

### 5.1 Bulk Operations (F12)

- [ ] Select-all + batch toolbar on every list (accounts, scan results, orders) — sticky bottom bar mobile / top desktop
- [ ] Batch actions: health check, scan select, delete, CSV export — with confirm on destructive
- [ ] Optimistic UI: instant row removal, restore on error
- [ ] Bulk endpoints batch-size safe (chunked 50)

### 5.2 Performance at 200 Accs (F8 NFR)

- [ ] Table pagination 50/page + server-side filter/sort (indexed queries)
- [ ] Virtualized long tables if needed (react-window) — 200 rows < 100ms render
- [ ] Scan throughput verify: 50 acc < 10 min at concurrency 2 (measured, logged)
- [ ] Health check verify: 200 acc < 15 min background; batch trigger < 5 min at safe concurrency (settings note)
- [ ] DB: query plan check (`EXPLAIN`), indexes added where hot; WAL + backup cron (`db:backup` daily)
- [ ] SSE reconnection (drop/refresh pe progress re-attach via job id)

### 5.3 Dashboard + Stats (F16)

- [ ] Stats cards live: Active Accounts, Today's Orders, Pending Jobs, Month Earning (yellow accent)
- [ ] Health banner (red) for expired sessions; recent activity list
- [ ] Quick actions: Fetch / Scan / Add / Sync

### 5.4 PWA + Notifications (F14, F15)

- [ ] `manifest.json` + icons + service worker (app shell cache) — installable on phone
- [ ] Web Push ya `termux-notification` fallback: order placed/failed, session expired, job done (setting toggle)
- [ ] Offline shell: cached UI + clear "offline" state (data nahi chalega offline)

### 5.5 Export & Data (F13)

- [ ] CSV export: accounts, scan results, orders, commission (`/api/export/:entity`)
- [ ] Settings → Data: wipe (confirm), backup download

### 5.6 Hardening

- [ ] `npm audit` + dependency review; `.env.example` complete
- [ ] Session encryption default-on guidance; PIN rate limit (brute force)
- [ ] README: quick start, screenshots, architecture summary, scope/compliance statement (RISKS §2)
- [ ] `docs/CHANGELOG.md` — v1.0 entry; PRD TRD status → Final

## DoD (Definition of Done)

- [ ] 200 accounts seeded → health check background me complete, UI responsive (no jank)
- [ ] Scan 50 acc < 10 min, live progress smooth, pagination fast
- [ ] Bulk select 200 → batch health → single progress, one toast summary
- [ ] Phone pe PWA install + open works; notification aati hai (order/session)
- [ ] CSV exports open correctly in Excel
- [ ] Security pass: no secrets in repo, PIN enforced, audit clean
- [ ] Full E2E demo: fetch → login 10 → scan → order dry-run → commission
- [ ] v1.0 tagged + changelog written

## Exit

🎉 **v1.0 done** — production use. Backlog candidates: Telegram bot (F19), dark mode (F17), direct Flipkart Affiliate swap (F20), multi-product batch (F18).
