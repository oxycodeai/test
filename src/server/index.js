// Server entry — Express + worker queue (same process, TRD §2).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(root, '.env') });

const { migrate } = await import('../db/migrate.js');
const { createApp } = await import('./app.js');
const { startJobWorker } = await import('../worker/index.js');
const { config, paths, platformName } = await import('../shared/constants.js');
const { sendEvent } = await import('./routes/stream.js');

migrate();
fs.mkdirSync(paths.sessions, { recursive: true });
fs.mkdirSync(paths.logs, { recursive: true });

// .env AUTH_PIN bootstrap — pehli baar CLI se bhi PIN set ho sake
{
  const { isPinSet, setPin } = await import('./middleware/auth.js');
  if (process.env.AUTH_PIN && !isPinSet()) {
    try {
      setPin(process.env.AUTH_PIN);
      console.log('✔ PIN set from AUTH_PIN (.env)');
    } catch (e) {
      console.warn('⚠ AUTH_PIN ignored:', e.message);
    }
  }
}

const app = createApp();

// worker: job events → SSE toasts
startJobWorker({
  onEvent: (ev) => {
    if (ev.type === 'job_failed') sendEvent('job_failed', { type: ev.job.type, error: ev.error });
    else sendEvent('job_done', { type: ev.job.type });
  },
});

// health sweep — har health_interval_min pe active sessions check (F3)
{
  const { startHealthScheduler } = await import('./health-scheduler.js');
  startHealthScheduler();
}

const server = app.listen(config.port, () => {
  console.log(`✔ KartBulk server  http://localhost:${config.port}  [${platformName()}]`);
  console.log(
    `  mode=${config.nodeEnv} affiliate=${config.affiliateMode} dryRun=${config.checkoutDryRun}`
  );
});

function shutdown(sig) {
  console.log(`\n${sig} — shutting down…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
