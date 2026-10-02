#!/usr/bin/env node
// Production start: migrate → server (crash-restart) → cloudflared tunnel.
// Usage: npm start | npm run start:termux | npm run start:pc
//        TUNNEL=0 npm start   (tunnel off)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });

const PORT = process.env.PORT || '3000';
const WANT_TUNNEL = (process.env.TUNNEL || '1') !== '0';

// ── 1. migrate ──────────────────────────────────────────────
try {
  execFileSync(process.execPath, [path.join(root, 'src/db/migrate.js')], {
    stdio: 'inherit',
    cwd: root,
  });
} catch {
  console.error('✖ migrate failed');
  process.exit(1);
}

// ── 2. server with restart loop ─────────────────────────────
let shuttingDown = false;
let server = null;
function startServer() {
  const child = spawn(process.execPath, [path.join(root, 'src/server/index.js')], {
    stdio: 'inherit',
    cwd: root,
    env: process.env,
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.warn(`[start] server exited (code=${code} signal=${signal}) — restarting in 3s…`);
    setTimeout(() => {
      server = startServer();
    }, 3000);
  });
  server = child;
  return child;
}
startServer();

// ── 3. tunnel ───────────────────────────────────────────────
let tunnel = null;
function findCloudflared() {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['cloudflared'], {
      encoding: 'utf8',
    });
    const first = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (first) return first;
  } catch {
    /* PATH me nahi — fallbacks try karo */
  }
  // winget/common install fallbacks (PATH refresh na hua ho to)
  const fallbacks =
    process.platform === 'win32'
      ? [
          'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
          'C:\\Program Files\\cloudflared\\cloudflared.exe',
        ]
      : ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'];
  return fallbacks.find((p) => fs.existsSync(p)) || null;
}

if (WANT_TUNNEL) {
  const bin = findCloudflared();
  if (!bin) {
    console.warn(
      '⚠ cloudflared not found — tunnel skipped (local only: http://localhost:' + PORT + ')'
    );
    console.warn(
      '  install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'
    );
  } else {
    tunnel = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: root,
    });
    let buf = '';
    let printedUrl = false;
    const onTunnelData = (chunk, stream) => {
      buf += chunk;
      stream.write(`[tunnel] ${chunk}`);
      const m = buf.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !printedUrl) {
        printedUrl = true;
        console.log('\n──────────────────────────────────────────────');
        console.log(`  PUBLIC URL (phone/PC dono ke liye): ${m[0]}`);
        console.log('──────────────────────────────────────────────\n');
      }
    };
    tunnel.stdout.on('data', (c) => onTunnelData(c, process.stdout));
    tunnel.stderr.on('data', (c) => onTunnelData(c, process.stderr));
    tunnel.on('exit', (code) => {
      if (!shuttingDown) console.warn(`[tunnel] exited (${code}) — cloudflared band ho gaya`);
    });
  }
}

console.log(`[start] local: http://localhost:${PORT}`);

// ── 4. shutdown ─────────────────────────────────────────────
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[start] stopping…');
  for (const c of [server, tunnel]) {
    try {
      c?.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
