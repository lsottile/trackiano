import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');
const database = createDatabase();

try {
  const applied = await runMigrations(database, { directory });
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date.');
} finally {
  await database.close();
}
