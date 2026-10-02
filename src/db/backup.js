import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb, DB_PATH } from './index.js';

export function backup() {
  const dest = `${DB_PATH}.bak`;
  if (fs.existsSync(dest)) fs.rmSync(dest);
  // VACUUM INTO — consistent hot backup (WAL safe), built into SQLite
  getDb().exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  return dest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.error('✖ no DB yet — run `npm run db:migrate` first');
      process.exit(1);
    }
    const dest = backup();
    console.log(`✔ backup → ${dest} (${fs.statSync(dest).size} bytes)`);
  } catch (err) {
    console.error('✖ backup failed:', err.message);
    process.exit(1);
  }
}
