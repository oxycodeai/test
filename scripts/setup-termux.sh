#!/data/data/com.termux/files/usr/bin/bash
# KartBulk — Termux setup (F-Droid Termux use karo, Play Store wala purana hai)
set -e
echo "=== KartBulk Termux Setup ==="

pkg update -y
pkg install -y nodejs git x11-repo cloudflared termux-api python make clang
pkg install -y chromium || echo "! chromium install failed — check manually: pkg install chromium"

# storage
if [ ! -d ~/storage ]; then
  termux-setup-storage || true
fi

cd "$(dirname "$0")/.."

echo "=== npm install (browser download skip — system Chromium use hoga) ==="
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install

# chromium path detect → .env me
CHROMIUM_BIN="$(which chromium || true)"
if [ -z "$CHROMIUM_BIN" ]; then
  CHROMIUM_BIN="$(which chromium-browser || true)"
fi
if [ -n "$CHROMIUM_BIN" ] && ! grep -q '^CHROMIUM_PATH=' .env 2>/dev/null; then
  echo "CHROMIUM_PATH=$CHROMIUM_BIN" >> .env
  echo "✔ CHROMIUM_PATH=$CHROMIUM_BIN"
fi

[ -f .env ] || cp .env.example .env
npm run db:migrate

echo ""
echo "=== Done ==="
echo "1. .env edit karo (CUELINKS_API_KEY, AUTH_PIN)"
echo "2. npm run smoke       # browser test"
echo "3. npm run start:termux"
echo "4. termux-wake-lock    # 24/7 ke liye"
