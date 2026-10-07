# PRD — KartBulk (Multi-Acc Flipkart Hub)

**Version:** 1.0
**Status:** Draft → Approved
**Date:** 2026-10-02

## 1. Vision

Ek self-hosted dashboard jahan ek shop owner apne 100-200 Flipkart accounts manage kare, kisi bhi product ka affiliate link se real data fetch kare, har account ka personalized price/offer/COD scan kare, aur bulk orders efficiently place kare — phone (Termux) aur PC dono pe.

## 2. Goals

| #   | Goal                                                | Metric                            |
| --- | --------------------------------------------------- | --------------------------------- |
| G1  | Unlimited Flipkart account login + session tracking | 200+ accounts, no cap             |
| G2  | Affiliate link se real product data fetch           | < 3s per fetch                    |
| G3  | Per-account price/COD/offer comparison              | Real session data, not mock       |
| G4  | Bulk order placement with qty allocation            | Hybrid (auto + manual confirm)    |
| G5  | Session expiry alerting                             | Red badge within 10 min of expiry |
| G6  | ~~Commission tracking~~ ❌ REMOVED 2026-10-03     | `/commission` feature hata diya     |
| G7  | Phone + PC responsive UI                            | Mobile-first, bottom nav          |
| G8  | Bulk + fast operations                              | 200 acc health check < 5 min      |

## 3. Non-Goals

- Fake/stolen account creation — sirf apne ya consent wale real accounts
- CAPTCHA solving services / anti-detect fingerprint spoofing farms
- Multi-platform (Amazon, Myntra) — Phase 1 sirf Flipkart
- Public SaaS — ye personal/self-hosted tool hai

## 4. Personas

**P1 — Shop Owner (Primary):** Bulk mein goods khareedta hai, multiple accounts se offers maximize karna chahta hai, COD prefer karta hai, affiliate partner ka link use karta hai jisse partner ko commission mile.

**P2 — Operator (same person, different mode):** Roz scan karta hai kaunse account pe kaunsa price/offer/COD hai, aur orders ko batches me place karta hai.

## 5. Features (Prioritized)

### P0 — Must Have (Phase 1-4)

| ID  | Feature                            | Description                                                                        | Acceptance Criteria                              |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| F1  | Product fetch via affiliate link   | Link paste → product card (image, title, MRP, price, discount, offers, stock, COD) | Real API data; < 3s; affid attached; **guarantee: order hamesha user ki link se hi chalega** (land na ho to honest fail) |
| F2  | Multi-account OTP login            | Number/Email → OTP (user enters) → session saved                                   | Unlimited accounts; storageState saved; no limit |
| F3  | Session health monitoring          | Background check every 10 min                                                      | Expired → red badge + toast                      |
| F4  | Bulk account add                   | CSV/paste se ek saath 100+ add                                                     | All rows processed; status shown                 |
| F5  | Start Scan (COD + price)           | Product + qty → scan all active acc                                                | Per-acc price, offers, COD shown in table        |
| F6  | Qty validation                     | Qty vs available acc mismatch warn                                                 | "Sirf 4 acc hain" warning; no crash              |
| F7  | Qty mode: total / per-acc          | Total 5 ya har acc se 5 — user choice                                              | Both modes allocate correctly                    |
| F8  | COD auto-filter                    | Non-COD acc auto-exclude                                                           | Only COD accs in allocation                      |
| F9  | Per-account price comparison table | Kaunsa acc kitne ka, kaunsa offer mila                                             | Sortable; best price highlighted                 |
| F10 | Hybrid order placement             | Auto cart→address→COD; CAPTCHA manual; **live steps** (affiliate→product→price→buy→address→payment→captcha→place→done) | Order placed or in pending queue; har step SSE pe live |
| F11 | ~~Commission dashboard~~ ❌ REMOVED 2026-10-03      | `/commission` + sync hata diya; earnings network site pe |

### P1 — Should Have (Phase 5)

| ID  | Feature                     | Description                               |
| --- | --------------------------- | ----------------------------------------- |
| F12 | Bulk select + batch actions | Select all → batch health/scan/export     |
| F13 | CSV export                  | Scan results, orders export               |
| F14 | PWA                         | Phone pe install, offline shell           |
| F15 | Desktop notifications       | Order done / session expired alerts       |
| F16 | Dashboard stats             | Active accs, today orders, jobs cards |

### P2 — Nice to Have

| ID  | Feature                                                |
| --- | ------------------------------------------------------ |
| F17 | Dark mode                                              |
| F18 | Multi-product batch scan                               |
| F19 | Telegram bot alerts                                    |
| F20 | Direct Flipkart Affiliate API swap (Cuelinks → direct) |

## 6. User Stories

**US1 — Login:**
As a shop owner, I want to add my Flipkart number, receive an OTP, type it once, and have the session saved forever — so that I never re-login unless Flipkart expires me (and I get a red alert when that happens).

**US2 — Fetch:**
As a shop owner, I want to paste my partner's affiliate link and immediately see the real product image, price, MRP, offers and COD status — so that I know what I'm buying before scanning accounts.

**US3 — Scan:**
As a shop owner, I want to enter quantity 5, choose "per account: 1", press Start Scan, and see a table of exactly which accounts have COD, what price each account sees, and which offers each got — so I can pick the cheapest/most eligible accounts.

**US4 — Qty guard:**
As a shop owner, if I enter 5 but only 4 accounts are active, I want a clear warning before scanning — so I don't waste time.

**US5 — Order:**
As a shop owner, I want the system to auto-fill cart/address/COD per account, auto-solve CAPTCHA when possible, and queue failures for my one-tap confirm — so I can place 50 orders in minutes without 50x full manual work.

**US6 — Commission:** ❌ REMOVED (2026-10-03) — commission dashboard nahi chahiye; earnings affiliate network ke dashboard me.

## 7. Non-Functional Requirements

| Category          | Requirement                                                         |
| ----------------- | ------------------------------------------------------------------- |
| Performance       | API p95 < 500ms (non-scan); scan throughput ≥ 1 acc/5s              |
| Scale             | 200 accounts, 100 scan jobs, 1000 orders in DB without UI lag       |
| Responsiveness    | 320px → 1920px; mobile bottom-nav, desktop sidebar                  |
| Data              | Production me sirf real data (API/session se); mock sirf dev mode   |
| Security          | Session files gitignored; .env for keys; no keys in repo            |
| Availability      | Termux pe 24/7 (wakelock); crash auto-restart (pm2/loop)            |
| Portability       | Ek codebase — Termux (system Chromium) aur PC (Playwright Chromium) |
| Rate-limit safety | Max 2 concurrent browser contexts; 2-5s jitter between requests     |

## 8. Dependencies

- Cuelinks account + API key (free, no website needed)
- Flipkart accounts (user ke paas, OTP accessible)
- Termux (F-Droid) + cloudflared, ya PC (Windows/Linux/macOS)
- Node.js 18+

## 9. Out of Scope Notes (Compliance)

- Accounts: sirf user ke apne/consented real accounts. No fake identity.
- Orders: user ke apne shop ke liye real purchases.
- Affiliate: partner ka link — commission partner ko jayega. Program T&C ka risk partner/user dono knowingly accept karte hain (see RISKS.md).
- Automation: Flipkart ToS automation restrict karta hai — throttle + human-paced design mandatory (RISKS.md).
