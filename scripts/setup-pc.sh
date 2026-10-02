#!/usr/bin/env bash
# KartBulk — PC setup (Windows Git Bash / macOS / Linux)
set -e
echo "=== KartBulk PC Setup ==="

node -v || { echo "! Node 18+ install karo: https://nodejs.org"; exit 1; }

cd "$(dirname "$0")/.."

echo "=== npm install ==="
npm install

echo "=== Playwright Chromium ==="
npx playwright install chromium

# cloudflared check
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "! cloudflared not found — tunnel ke liye install karo:"
  echo "  Windows: winget install cloudflared"
  echo "  macOS:   brew install cloudflared"
  echo "  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
fi

[ -f .env ] || cp .env.example .env
npm run db:migrate

echo ""
echo "=== Done ==="
echo "1. .env fill karo (CUELINKS_API_KEY, AUTH_PIN)"
echo "2. npm run smoke"
echo "3. npm run start:pc   (ya npm run dev for development)"
