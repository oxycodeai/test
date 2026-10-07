# Changelog — KartBulk

All notable changes to this project are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/) — dates in `YYYY-MM-DD`.

## [Unreleased]

### Added

- **Affiliate guarantee + live checkout progress (2026-10-05):** order hamesha **user ki apni affiliate link** se land karenga (`booking.affiliate_url` → product page) — na land ho to honest 422, bina aapki link ke checkout kabhi nahi (tracking safe). Har step live: `shared/steps.js` + `orders.step` column + SSE `order_step` + UI steppers (OrderPanel/Orders/Fetch). `pageFetch.js` `isProductUrl`/`extractPriceOnPage` export — quote vs live price ka right extractor (bodyText regex galat ₹ pakadta tha).
- **Naya Flipkart checkout UI support (worker):** Buy Now = sticky RN-web CTA (role-less DOM click), address = single-page `viewcheckout` (inline "Deliver to" → Change picker → Add New map-pin flow: search → suggestion force-click → away sheet → details form → save), payments = `pay.flipkart.com` (COD + Place Order leaf fallback). Login flow fixed: `/account/login` → `/login` redirect + `input[type=number]` phone field.
- **Multi-panel Firebase OTP inbox:** `FIREBASE_DB_URL` ab comma-separated panel list (entry `url` ya `url|||auth`); `rtdbGet` sab panels try karta hai (pehla non-null wins), `rtdbShallowKeys` merged fallback scan. `.env` me hamare forwarder panels (dhiko0909, jime-10a55, sunil-da+auth, …).
- **E2E dry-run green:** `.tmp-test/e2e-dryrun.js` — 20/20 (FKTR affiliate land → quote ₹485 → confirm → steps affiliate→buy→address→payment→place→done, `captcha_state=solved`, `order_ref=DRY-RUN`). `refreshBooking` ab `captcha_state='solved'` ko placed jaisa count karta hai (dry-run bookings complete hote hain).
- **Booking/orders retry hardening:** `POST /api/bookings/:id/requote` (failed quote se wapas), `POST /api/orders/:id/retry` ab price-null par `price_check` enqueue karta hai, order handler me login-wall detection (honest `SESSION_EXPIRED` error + SSE).

### Fixed

- **FKTR affiliate resolver:** fktr.in link → native Flipkart affiliate URL (`affid` + `affExtParams` land hote hain — e2e me verify). Price check resolve-first + cache branch `affiliate:{url…}`.
- **undici/net.js:** `ProxyAgent` + `undiciFetch` (proxy flakiness retries), lint green, `npm test` 21/21.

### Removed

- **Commission feature (2026-10-03):** `/api/commission` route, `/commission` page, nav entry, Dashboard "Month Earning" card + quick link, `month_earning` stats field, `listTransactions()` — sab hata diya. `commission_events` table legacy rakhi (tests). Earnings affiliate network ke dashboard pe. Docs (PRD/TRD/UI-UX/INTEGRATIONS + phases) updated.

### Added

- **Phase 0 — Documentation:** `docs/` (PRD, TRD, UI-UX, INTEGRATIONS, RISKS, SETUP, CHANGELOG) and `phases/` (index + phase-0..5 task checklists).
