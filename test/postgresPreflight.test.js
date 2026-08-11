import assert from 'node:assert/strict';
import test from 'node:test';

import { runPostgresTests } from '../scripts/run-postgres-tests.js';

test('PostgreSQL test preflight fails clearly without exposing configuration', () => {
  assert.throws(
    () => runPostgresTests({ env: {}, spawn: () => assert.fail('must not spawn') }),
    /TEST_DATABASE_URL is required to run PostgreSQL integration tests/,
  );
});

test('PostgreSQL test preflight starts only the opted-in integration test', () => {
  const calls = [];
  const result = runPostgresTests({
    env: { TEST_DATABASE_URL: 'postgres://secret' },
    spawn: (...args) => { calls.push(args); return { status: 0 }; },
  });
  assert.equal(result, 0);
  assert.deepEqual(calls, [[process.execPath, [
    '--test', 'test/postgres.integration.test.js',
  ], { stdio: 'inherit', env: { TEST_DATABASE_URL: 'postgres://secret' } }]]);
});
