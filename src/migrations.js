import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export async function runMigrations(database, { directory }) {
  await database.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const appliedResult = await database.query('SELECT version FROM schema_migrations');
  const applied = new Set(appliedResult.rows.map(({ version }) => version));
  const versions = (await readdir(directory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  const completed = [];

  for (const version of versions) {
    if (applied.has(version)) continue;
    const sql = await readFile(path.join(directory, version), 'utf8');
    await database.transaction(async (transaction) => {
      await transaction.query(sql);
      await transaction.query(
        'INSERT INTO schema_migrations (version) VALUES ($1)',
        [version],
      );
    });
    completed.push(version);
  }

  return completed;
}
