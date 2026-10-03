# UI-UX Spec — KartBulk

**Version:** 1.0
**Theme:** Flipkart-style (White + Yellow), mobile-first, bulk-fast

## 1. Design Tokens

### Colors

```css
--bg: #ffffff; /* page background — white */
--bg-alt: #f1f3f6; /* Flipkart light gray — sidebar, table stripes */
--surface: #ffffff; /* cards */
--border: #e0e0e0;

--primary: #2874f0; /* Flipkart blue — links, header, active nav */
--primary-dark: #1a5fd0;
--accent: #ffe11b; /* Yellow — CTA buttons, badges, highlights */
--accent-hover: #f5d400;
--accent-text: #1a1a1a; /* yellow button text (dark for contrast) */

--text: #212121;
--text-muted: #878787;
--text-inverse: #ffffff;

--success: #388e3c; /* active, COD yes, placed */
--danger: #ff6161; /* expired, error, failed */
--warning: #ff9f00; /* pending, qty warning */
```

### Typography

- Font: `Inter, Roboto, -apple-system, sans-serif`
- Base: 14px (dense data UI), headings: 18/22/28px
- Numbers in tables: `font-variant-numeric: tabular-nums` (columns align)

### Spacing / Radius / Shadow

- Grid: 8px base (4, 8, 12, 16, 24, 32)
- Radius: 4px (inputs), 8px (cards), 999px (pills/chips)
- Shadow: `0 1px 3px rgba(0,0,0,.08)` cards; `0 4px 16px rgba(0,0,0,.12)` modals

### Motion

- 120–180ms ease-out; skeletons pulse; progress bars linear
- `prefers-reduced-motion`: animations off

## 2. Layout — Responsive

| Region  | Phone (<768px)                             | Tablet (768–1023) | Desktop (≥1024)                |
| ------- | ------------------------------------------ | ----------------- | ------------------------------ |
| Header  | Sticky top, logo + bell                    | Same              | Same + search                  |
| Nav     | **Bottom tab bar** (5 items, icons+labels) | Rail icons        | **Left sidebar** 240px, labels |
| Content | Full width, 12px pad, cards stack          | 2-col grids       | Full tables, multi-col         |
| Tables  | Card-list conversion                       | Horizontal scroll | Full grid, sticky header       |
| CTAs    | Full-width, bottom-fixed when primary      | Auto              | Inline                         |

Breakpoints: `--bp-sm: 640px`, `--bp-md: 768px`, `--bp-lg: 1024px`

## 3. Pages

### 3.1 Dashboard (`/`)

- 4 stat cards: Active Accounts | Today's Orders | Pending Jobs | Month Earning (₹, yellow accent on earning)
- Quick actions row: **Fetch Product** (yellow), Orders, Add Accounts
- Recent activity list (last 10 events)
- Health banner (red) jab koi session expired

### 3.2 Fetch Product (`/fetch`)

- Big URL input + yellow **Fetch** button
- Product card: image (120px), title, MRP (strikethrough muted), **price (24px bold)**, discount chip (green), offers list (blue bullets), COD pill (green/red), stock pill
- "Updated X min ago" chip (real data marker)
- Affiliate preview: generated affid link + Copy button

### 3.3 Accounts (`/accounts`)

- Toolbar: search, status filter (All/Active/Expired/Pending), **Add**, **Bulk Add**, batch actions (Check health, Delete) — select-all checkbox
- Table (desktop) / cards (phone): checkbox, label, identifier (masked `98xxx…45`), **status pill**, last checked, actions (re-login, delete)
- Status pill: green dot Active | red dot Expired | yellow dot Pending
- Bulk Add modal: textarea one-per-line `identifier,label` → progress → `{created, skipped}` summary

### 3.4 Add Account / OTP Wizard (`/accounts/new`)

- Step 1: identifier input → **Send OTP** (blue) → loading "OTP bheja…"
- Step 2: OTP input (6 boxes, auto-advance) → yellow **Verify & Save**
- Step 3: success (green check) → auto back to list
- Expired account pe same wizard with "Re-login" title

### 3.5 Scan (`/scan`)

- Config card: product (from fetch, or paste link), **qty number**, qty mode toggle (`Total` | `Per account`), per-acc qty (mode=per_account), yellow **Start Scan**
- Qty guard inline: qty > active → red warning strip `⚠ Sirf 4 active accounts hain — 5 nahi ho sakta (mode: Total)`
- Progress bar (yellow fill) + `progress/total` + ETA
- **Results table** (real data): Account | Price ₹ | Special ₹ | Offers (count→expand) | COD pill | Eligible check | Status
  - Best price row: yellow left border + "BEST" chip
  - Non-COD: row muted + Eligible ✗
  - Expired: red pill, skipped
  - Sort: price, COD, status (click header)
- Summary strip: `12/12 done · 9 COD · best ₹1,299 (Shop-03) · 3 excluded`
- Export CSV button

### 3.6 Orders (`/orders`)

- Tabs: Pending CAPTCHA | Placed | Failed
- **Pending queue (hero):** card per order — captcha image (clean, high-contrast), OTP-style text input, yellow **Place Order**; keyboard Enter
- Placed list: account, product thumb, qty, price, order ref (copy), time
- Failed: error reason + **Retry**
- Bulk: "Solve all via auto" reruns OCR pass

### 3.7 Commission — ❌ REMOVED (2026-10-03)

- `/commission` page + nav + Month-Earning card hata diya gaya (user decision).
- Earnings ab affiliate network ki site pe (EarnKaro/CashKaro/Cuelinks dashboard).

### 3.8 Settings (`/settings`)

- Tabs: General (health interval, delays, order cap), Affiliate (Cuelinks key/channel), Security (PIN change, session encrypt toggle), Data (export CSV, wipe)

## 4. Components

| Component         | Spec                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| Button            | primary=yellow(accent-text), secondary=blue outline, ghost=muted; h=40 (mobile 44 tap) |
| Status pill       | 999px, dot+label, 12px, tinted bg (10% color)                                          |
| Data table        | sticky thead, striped `--bg-alt`, hover row, checkbox col, tabular-nums                |
| Progress bar      | 6px, yellow fill, `% + count` label                                                    |
| Toast             | top-right (desktop) / top-center (mobile), 4s, colors by type; SSE-driven              |
| Modal             | centered, backdrop blur, focus trap, ESC close                                         |
| Skeleton          | gray shimmer blocks — layout match kare                                                |
| Empty state       | icon + line + CTA button (not blank screen)                                            |
| Qty warning strip | red-tinted bg `#FFF1F1`, icon, bold number, non-blocking                               |

## 5. Bulk-Fast UX Rules (F12)

1. Har list: **select-all** header checkbox + visible selected count `7 selected`
2. Batch toolbar appears on select: sticky bottom bar (mobile) / top bar (desktop) with actions
3. Long jobs: SSE live progress — rows stream in, no full-page spinner
4. Tables: paginate 50/page (200+ rows ke liye); sort/filter client-side on current page data + server query
5. Optimistic UI: delete/bulk actions instantly remove rows, restore on error
6. Keyboard (desktop): `/` focus search, `a` select all, `Enter` primary action in forms
7. Buttons show pending state (spinner + disabled) — double-click protection

## 6. Real-Data Rules

1. Har fetched/scanned value ke saath relative time chip ("2 min ago")
2. Stale > 15 min → muted "Stale" chip + refresh hint
3. Production build: mock/faker imports stripped (`import.meta.env.DEV` guard)
4. Failed fetch → explicit error card (reason), NOT fallback fake numbers
5. Currency: `₹` + Indian grouping (`1,29,999` — `toLocaleString('en-IN')`)

## 7. Accessibility

- Contrast: text/bg ≥ 4.5:1; yellow CTA → dark text (#1A1A1A) ensures this
- Focus ring: 2px `--primary` outline on all interactive
- Labels: every input has `<label>`; errors `aria-describedby`
- Pills/icons: color + text (never color-only — red/green colorblind safe)
- Tap targets ≥ 44px mobile; table rows ≥ 40px
- SSE updates: `aria-live="polite"` on progress + toast regions

## 8. Iconography & Assets

- Icons: inline SVG set (Lucide-style, 20px, stroke 1.75) — no icon font dependency
- Logo: text mark "KartBulk" (bold) + yellow bag icon
- No external image CDN — product images proxied/cached server-side (`/api/img?url=`)
