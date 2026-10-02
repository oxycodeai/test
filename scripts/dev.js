#!/usr/bin/env node
// Dev mode: Express (auto-reload) + Vite HMR. Tunnel off.
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const kids = [];
function run(name, cmd, args, env = {}) {
  const c = spawn(cmd, args, { stdio: 'inherit', cwd: root, env: { ...process.env, ...env } });
  c.on('exit', (code) => {
    if (!shutting) console.warn(`[dev] ${name} exited (${code})`);
  });
  kids.push(c);
  return c;
}

let shutting = false;
function shutdown() {
  if (shutting) return;
  shutting = true;
  kids.forEach((k) => {
    try {
      k.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  });
  setTimeout(() => process.exit(0), 800);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// migrate first
execFileSync(process.execPath, [path.join(root, 'src/db/migrate.js')], {
  stdio: 'inherit',
  cwd: root,
});

run('server', process.execPath, ['--watch', path.join(root, 'src/server/index.js')], {
  NODE_ENV: 'development',
  TUNNEL: '0',
});
run('vite', 'npm', ['run', 'web']);

console.log('[dev] server → http://localhost:3000   web → http://localhost:5173');
