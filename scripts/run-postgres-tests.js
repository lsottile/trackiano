import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function runPostgresTests({ env = process.env, spawn = spawnSync } = {}) {
  if (!env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is required to run PostgreSQL integration tests.');
  }
  const result = spawn(process.execPath, [
    '--test', 'test/postgres.integration.test.js',
  ], { stdio: 'inherit', env });
  return Number.isInteger(result.status) ? result.status : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = runPostgresTests();
  } catch {
    console.error('TEST_DATABASE_URL is required to run PostgreSQL integration tests.');
    process.exitCode = 1;
  }
}
