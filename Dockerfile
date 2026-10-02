# Railway deploy — Node + Playwright(chromium) container
FROM node:24-bookworm-slim

WORKDIR /app

# Deps pehle (layer cache) — workspaces ke liye src/web/package.json bhi chahiye
COPY package.json package-lock.json ./
COPY src/web/package.json src/web/
RUN npm ci

# Chromium + system deps (worker/pageFetch ke liye)
RUN npx playwright install --with-deps chromium

COPY . .
RUN npm run web:build

ENV NODE_ENV=production \
    TUNNEL=0

EXPOSE 3000

CMD ["npm", "start"]
