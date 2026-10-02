# SETUP — KartBulk Install & Run

**Version:** 1.0

## 0. Prerequisites

- **Accounts:** apne real Flipkart accounts (OTP aapke phone/email pe aana chahiye)
- **Affiliate:** Cuelinks publisher account + API key (free — dashboard → Settings → API)
- **Node.js 18+** (dono platforms pe)
- **Tunnel:** `cloudflared` binary

---

## 1. Termux (Primary Host)

> Install **F-Droid ka Termux** (Play Store wala outdated hai — `pkg` fail hota hai).

```bash
# 1. Packages
pkg update && pkg upgrade -y
pkg install -y nodejs git x11-repo cloudflared termux-api
pkg install -y chromium
# optional OCR accuracy ke liye:
pkg install -y tesseract-ocr

# 2. Storage
termux-setup-storage   # popup me Allow

# 3. Clone/copy project
cd ~ && git clone <repo> kartbulk || cp -r "<path>" ~/kartbulk
cd ~/kartbulk

# 4. Install deps
npm install

# 5. Configure
cp .env.example .env
# .env edit karo: CUELINKS_API_KEY, AUTH_PIN, SESSION_ENC_KEY (random 32 bytes)

# 6. Init DB
npm run db:migrate

# 7. Start (server + worker + tunnel ek command)
npm run start:termux
# → local: http://localhost:3000
# → public: https://<random>.trycloudflare.com  (terminal me print hota hai)
```

**Termux Chromium path check:**

```bash
which chromium
# → /data/data/com.termux/files/usr/bin/chromium
# agar alag hai to .env me: CHROMIUM_PATH=<that path>
```

**Stay awake (24/7 ke liye):**

```bash
termux-wake-lock
# service: termux-battery-status | grep -i temperature  (overheat check)
```

**Android 14+ note:** Chromium ke liye `--single-process` + `--js-flags=--jitless`
(worker `src/worker/platform.js` me already auto-lagta hai).

### Auto-start (optional)

```bash
# ~/.bashrc me:
cd ~/kartbulk && npm run start:termux
```

Ya Termux:Boot addon se boot pe script chalao.

---

## 2. PC (Secondary / Dev)

```bash
# 1. Node 18+ check
node -v

# 2. Project
git clone <repo> kartbulk && cd kartbulk
npm install

# 3. Playwright Chromium (PC pe bundled browser)
npx playwright install chromium

# 4. cloudflared
#   Windows: winget install cloudflared
#   macOS:   brew install cloudflared
#   Linux:   (package manager ya github release binary)

# 5. Configure
cp .env.example .env   # edit keys

# 6. Migrate + run
npm run db:migrate
npm run start:pc        # dev hot reload ke saath: npm run dev
```

---

## 3. Environment (`.env`)

```bash
# --- Required ---
CUELINKS_API_KEY=            # Cuelinks publisher API token
CUELINKS_CHANNEL_ID=         # channel id (link convert me)
AUTH_PIN=                     # dashboard ka PIN (first-run bhi set ho sakta hai)

# --- Optional / Security ---
SESSION_ENC_KEY=              # 32-byte hex — session AES encryption on karega
                              # generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# --- Platform overrides ---
# CHROMIUM_PATH=              # Termux custom chromium path (auto-detect fail ho to)

# --- Tuning (defaults TRD §12) ---
SCAN_CONCURRENCY=2
REQ_DELAY_MIN_MS=2000
REQ_DELAY_MAX_MS=5000
PORT=3000

# --- Mode ---
AFFILIATE_MODE=cuelinks      # cuelinks | manual
CHECKOUT_DRY_RUN=false       # true = Place Order click nahi (testing)
NODE_ENV=production
```

---

## 4. Commands

| Command                | Kaam                                          |
| ---------------------- | --------------------------------------------- |
| `npm run start:termux` | migrate + server + worker + tunnel (Termux)   |
| `npm run start:pc`     | migrate + server + worker + tunnel (PC)       |
| `npm run dev`          | dev mode (Vite HMR + server watch, no tunnel) |
| `npm run db:migrate`   | SQLite schema create/update                   |
| `npm run db:backup`    | `data/app.db` → `data/app.db.bak`             |
| `npm run db:reset`     | ⚠ wipe (confirm lagta hai)                    |
| `npm test`             | unit + integration tests                      |

---

## 5. First-Run Checklist

1. [ ] `.env` filled (Cuelinks key, PIN)
2. [ ] `npm run db:migrate` ok
3. [ ] Server up: `http://localhost:3000` → PIN screen
4. [ ] Tunnel URL open (phone se) → theme dikh raha
5. [ ] Settings → Affiliate: test fetch (Flipkart product link) → real card aaya
6. [ ] Accounts → Add (1 number) → OTP wizard complete → **Active** pill
7. [ ] Scan → qty guard check → Start Scan → real price table
8. [ ] `CHECKOUT_DRY_RUN=true` rakho jab tak real order confirm na karo

---

## 6. Troubleshooting

| Problem                               | Fix                                                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `chromium: not found` (Termux)        | `pkg install chromium`; `which chromium` → `.env CHROMIUM_PATH`                                                      |
| Chromium exits instantly (Android 14) | flags check: `src/worker/platform.js` (`--single-process`, `--jitless`)                                              |
| Phantom process killed                | `adb shell settings put global settings_enable_monitor_phantom_processes false` (PC se ADB), ya reduce contexts to 1 |
| Tunnel URL changes on restart         | quick tunnel — har restart pe naya. Stable chahiye → named tunnel + domain (`cloudflared tunnel create kartbulk`)    |
| `EADDRINUSE`                          | `PORT=` badlo ya pehla process kill                                                                                  |
| OTP nahi aata                         | number check, `Send OTP` pe rate limit (10/min) — 60s wait                                                           |
| Session expired red badges            | Accounts → Re-login (OTP wizard)                                                                                     |
| DB locked                             | sirf ek server instance chal raha confirm karo; WAL mode on hai check                                                |

---

## 7. Data Locations

```
kartbulk/
├── data/app.db          # SQLite (gitignored)
├── data/app.db.bak      # backup
├── sessions/*.json      # storageState (gitignored, chmod 600)
├── data/captchas/*.png  # pending captcha screenshots (gitignored)
├── .env                 # secrets (gitignored)
└── logs/worker.log      # rotating log (gitignored)
```
