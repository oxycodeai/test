import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, DB_PATH } from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  getDb().exec(schema);
  return { ok: true, db: DB_PATH };
}

// Direct run: npm run db:migrate
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const r = migrate();
    console.log(`✔ schema applied → ${r.db}`);
  } catch (err) {
    console.error('✖ migrate failed:', err.message);
    process.exit(1);
  }
}
