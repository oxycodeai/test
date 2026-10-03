# INTEGRATIONS — Cuelinks API + Flipkart Automation

**Version:** 1.0
**Status:** Reference for implementation

## Part A: Cuelinks API (Affiliate — Phase 1)

### A1. Auth & Endpoint

- Base: `https://pubapi.cuelinks.com` (v3)
- Header: `Auth-Token: <CUELINKS_API_KEY>` + `Content-Type: application/json`
- Key milta hai: Cuelinks publisher dashboard → Settings → API (free, website optional)
- Rate limit: reasonable (≤ 60 req/min assume) — cache product fetches 15 min

> NOTE: Confirm exact base URL/paths from `developers.cuelinks.com` at implementation time.
> Agar docs changed ho to sirf `src/server/integrations/cuelinks.js` update — UI contract same rahega.

### A2. Endpoints Used

| Purpose                   | Method | Path                                         | Body/Query                   |
| ------------------------- | ------ | -------------------------------------------- | ---------------------------- |
| Link convert (affid)      | POST   | `/pub_api/v3/links/convert`                  | `{original_url, channel_id}` |
| Campaign list/offers      | GET    | `/pub_api/v3/campaigns`                      | `?q=<keyword>`               |
| Product/search data       | GET    | `/pub_api/v3/products` (or campaign product) | `?q=` / `?id=`               |
| Transactions (commission) | GET    | `/pub_api/v3/transactions`                   | `?from=&to=&status=`         |
| Reports summary           | GET    | `/pub_api/v3/reports/summary`                | `?period=today\|month`       |

### A3. Fetch Flow (F1)

```
POST /api/products/fetch {url}
  1. validate: flipkart.com URL (product/links/affiliate short link)
  2. cuelinks: links/convert → affiliate URL (affid attached, commission tag)
  3. product data (priority):
     a. Cuelinks product/campaign API (agar item milta hai)
     b. fallback: fetch product page og:title/og:image/JSON-LD (server-side GET)
  4. normalize → products row save → return:
     {title, image, mrp, price, discount_pct, in_stock, cod_product, offers[], productUrl}
  5. cache: url hash → 15 min (settings table ya memory)
```

**COD product-level:** JSON-LD `offers.availability` + page text `Cash on Delivery`
(Per-account COD Phase 3 me session se exact milta hai.)

### A4. Commission Sync (F11) — ❌ REMOVED (2026-10-03)

- `/api/commission` route + UI hata diya (user decision); `commission_events` table legacy rakhi hai (tests assert).
- `listTransactions()` client bhi hata diya; **`convertLink` intact** (fetch attribution ke liye).
- Earnings affiliate network ke dashboard me dekhni (EarnKaro/CashKaro).

### A5. Fallback (Cuelinks not available)

Setting `affiliate_mode`: `cuelinks` (default) | `manual`

- `manual`: user apna affid link paste kare (jo partner ne diya); fetch sirf page data karega; commission manual/zero
- Direct Flipkart Affiliate (`affiliate-api.flipkart.net`, headers `Fk-Affiliate-Id`/`Fk-Affiliate-Token`) Phase 5 me swap option — same normalize function reuse

---

## Part B: Flipkart Automation (Phase 2-4)

### B1. OTP Login (F2)

**Pages:** `https://www.flipkart.com/account/login` (or `?ret=/`)

```
Step 1 — otp-request (worker, headless):
  1. context = launch (no storageState)
  2. goto login URL, wait networkidle
  3. click "Login" / phone input visible
  4. type identifier (phone: 10 digit; email: tab switch "Email")
  5. click CONTINUE / Send OTP
  6. wait: OTP input visible → SUCCESS
  7. detect OTP (dev/debug only): intercept SMS? Nahi — user ke phone pe aata hai.
     Dev mode: agar test number + mailhog jaisa setup nahi, to user khud OTP dega.
  8. respond 202 {accountId, otpRequestId} — login page state RAM me rakho
     (server memory map: otpRequestId → {context, page} TTL 5 min)

Step 2 — verify (user OTP de):
  1. POST /accounts/:id/login {otp}
  2. type 6-digit OTP → auto-submit / click Verify
  3. wait redirect to account/home OR header avatar visible
  4. success → context.storageState() → sessions/<id>.json
     → accounts.status='active', sessions row
  5. failure (wrong OTP): 400 {error:'Invalid OTP'} — retry up to 3 (Flipkart resend)
  6. context close → memory cleanup
```

**Selectors:** `shared/flipkart-login.js` — phone input (`input[type=tel]` pattern), OTP boxes (`input[maxlength=1]` group ya single input), buttons by text `Continue|Verify|Send OTP` — text-based first, CSS second.

**Edge cases:**

- Captcha on login → screenshot → pending-OTP UI me captcha bhi dikhao (Phase 2.5)
- "Access blocked" / Akamai → backoff 60s, retry 2; persist fail → `status='error'`
- Rate limit: login attempts ≤ 10/min across all accounts (queue global)

### B2. Session Health Check (F3)

```
every health_interval_min (default 10):
  for each account.status='active' (semaphore 2, delay 2-5s):
    context = launch({storageState})
    goto https://www.flipkart.com/ (or /account)
    check login marker:
      VALID: header shows account dropdown / /account page 200 & no login-wall
      EXPIRED: redirected to /account/login OR login-wall modal
    ok   → status='active', last_checked=now
    fail → status='expired' + SSE {type:'session_expired', accountId}
    context.close()
```

Marker logic ek jagah: `isLoggedIn(page)` in `shared/flipkart-auth.js`.

### B3. Per-Account Price/Offers/COD Scan (F5)

```
per account (semaphore scan_concurrency=2, delay jitter 2-5s):
  1. context = storageState
  2. goto product URL (affid wala)
  3. wait __NEXT_DATA__ / price element
  4. extract:
     - __NEXT_DATA__.props.pageProps.initialState → offerPrice, price Mrp, offers[]
     - fallback JSON-LD (ld+json) price
     - fallback content regex: ₹[\d,]+ + line-through
     - COD: checkout probe? PHASE 3 simplified:
       product page pe COD badge/ text "Cash on Delivery"
       + delivery pincode-dependent → default pincode set (settings) lagake check
  5. offers: coupon/offer strip titles[] (from JSON offers array)
  6. result → scan_results row {price, special_price, offers_json, cod_available, status}
  7. session expired mid-scan → status='expired' row, account flagged, skip
```

**Selector config:** `src/shared/selectors.js`

```js
export const PRODUCT = {
  nextData: '#__NEXT_DATA__',
  jsonLd: 'script[type="application/ld+json"]',
  // JSON paths (update HERE when Flipkart changes):
  paths: {
    price: 'props.pageProps.initialState.product.price.finalPrice', // VERIFY at impl
    mrp: 'props.pageProps.initialState.product.price.mrp',
    offers: 'props.pageProps.initialState.product.offers',
  },
  fallbackPriceRegex: /₹\s?[\d,]+/,
  codText: 'Cash on Delivery',
};
```

> Implement karte waqt actual `__NEXT_DATA__` path khol ke verify karna — upar placeholder hai.
> Content-pattern fallback class-rotation se safe.

### B4. Checkout + Order (F10)

```
per allocation:
  1. goto product → click "Buy Now" (ya Add to Cart → /cart)
  2. wait checkout; address step:
     - saved address list se default (first) select
     - nahi hai → order failed 'no_address' (user address add kare pehle — settings)
  3. payment page → click COD option ("Cash on Delivery")
     - unavailable → mark order failed 'cod_unavailable' (scan me galat hua tha)
  4. CAPTCHA (agar dikhe):
     - screenshot element → buffer PNG
     - tesseract.js (eng, single line/digit mode) → guess text
     - fill → click Place Order
     - accepted → order_ref = success page order id → 'placed'
     - rejected (max 2 tries) → captcha_png save → status='pending' → SSE
  5. manual path: user UI me image dekh ke type → POST captcha → worker fill+submit
  6. success page se: order id, total → orders row update
```

**Order guard:** pre-flight price check vs scan price (±5% tolerance) — price badha to `failed:'price_changed'` (user re-scan).

**Dry-run:** settings `checkout_dry_run` = true → sab steps lekin Place Order click nahi (Phase 4 dev testing). Prod: false.

### B5. Rate-Limit & Detection Countermeasures

| Control                     | Value                                    | Rationale                  |
| --------------------------- | ---------------------------------------- | -------------------------- |
| Browser contexts concurrent | ≤ 2                                      | IP/behavioral throttle     |
| Flipkart request gap        | 2–5s jitter                              | Human-ish pacing           |
| Login attempts global       | ≤ 10/min                                 | OTP request limit          |
| Jobs single-flight          | 1 worker loop                            | No thundering herd         |
| Akamai block detected       | backoff 60s → 1 retry → fail row         | No ban hammer loop         |
| Fingerprints                | default Playwright; NO spoofing stack    | Keep low-profile           |
| Hours                       | user ke active hours (setting, optional) | Night bulk = risky pattern |

### B6. What We Explicitly DON'T Do

- No captcha farm / 2Captcha external service
- No browser fingerprint spoofing / proxy rotation
- No account creation automation (sirf login)
- No bypass of OTP/2FA
- These keep the system inside "personal automation" territory instead of fraud-tool territory

### B7. Firebase OTP Inbox (auto-login)

SMS-forwarder panel ka Firebase RTDB se OTP khud kheench ke login automatic (bulk
numbers ke liye — import → row-wise Login, har row ka OTP auto-verify).

- **Config (.env):** `FIREBASE_DB_URL` (required) · `FIREBASE_DB_AUTH` (optional) ·
  `FIREBASE_MAP_NODE=automation/numbers` · `FIREBASE_MSG_NODE=messages`.
  Khali chhoda toh feature OFF — manual OTP chalta rahega.
- **Read-only paths (kuch likhte nahi):**
  - `automation/numbers/{phone}` → `{ deviceId }` — phone→device mapping
    (`7018156007` aur `917018156007` dono form try hote hain; 10-min cache)
  - `messages/{deviceId}/{epochMs}` → `{ message, sender, type }` — incoming SMS
  - **Mapping miss → fallback:** `messages` ke SAB devices ke recent (last 8)
    messages scan (batches of 12) — serial login safe (rate ≤10/min = ek time
    pe ek OTP); last-hit device cache se agli poll ~1s me
- **Flow:** Send OTP (`POST /:id/otp-request`) → `OtpStep` har 4s
  `GET /accounts/:id/otp-fetch?since=` poll (max ~90s) → `since` ke baad ke
  incoming me **Flipkart-text wala 6-digit code priority** (warna newest
  6-digit) → **auto-fill + auto-verify**; timeout par manual fallback.
- **Errors:** `501 not_configured` (env missing) · `404 otp_not_found`
  (abhi nahi aaya / number mapping me nahi) · `502 rtdb_error` (RTDB down).
- **Security:** OTP sirf authed API se (x-auth-token). Aapke RTDB rules abhi
  **public read** hain (bina auth ke open) — panel/DB tight karo ya
  `FIREBASE_DB_AUTH` token set karo. Rate limit: login ≤10/min (OTP burst safe).
