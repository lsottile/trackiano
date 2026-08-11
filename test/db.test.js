import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createDatabase } from '../src/db.js';
import { runMigrations } from '../src/migrations.js';

function fakePool({ failWork = false } = {}) {
  const events = [];
  const client = {
    async query(sql) {
      events.push(sql);
      if (failWork && sql === 'work') throw new Error('failed work');
      return { rows: [], rowCount: 0 };
    },
    release() { events.push('release'); },
  };
  return {
    events,
    async connect() { events.push('connect'); return client; },
    async query(sql) { events.push(sql); return { rows: [], rowCount: 0 }; },
    async end() { events.push('end'); },
  };
}

test('fails closed when a real pool has a missing or unknown TLS mode', () => {
  for (const sslMode of [undefined, '', 'prefer', 'verify-full']) {
    assert.throws(() => createDatabase({
      connectionString: 'postgres://example', sslMode, PoolClass: class {},
    }), /PGSSLMODE must be explicitly set to "require" or "disable"/);
  }
});

test('requires a trusted root certificate when TLS is required', () => {
  assert.throws(() => createDatabase({
    connectionString: 'postgres://example', sslMode: 'require', PoolClass: class {},
  }), /PGSSLROOTCERT is required/);
});

test('allows explicit TLS disable for disposable local or test PostgreSQL', () => {
  let options;
  class PoolClass { constructor(value) { options = value; } on() {} }
  createDatabase({
    connectionString: 'postgres://localhost/test', sslMode: 'disable', PoolClass,
  });
  assert.deepEqual(options, { connectionString: 'postgres://localhost/test' });
});

test('verifies TLS certificates and handles idle pool errors', () => {
  let options;
  let listener;
  const errors = [];
  class PoolClass {
    constructor(value) { options = value; }
    on(event, handler) { listener = { event, handler }; }
    async end() {}
  }
  createDatabase({
    connectionString: 'postgres://example',
    sslMode: 'require',
    sslRootCert: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
    PoolClass,
    onPoolError: (error) => errors.push(error),
  });

  assert.deepEqual(options.ssl, {
    rejectUnauthorized: true,
    ca: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
  });
  assert.equal(listener.event, 'error');
  const error = new Error('idle connection failed');
  listener.handler(error);
  assert.deepEqual(errors, [error]);
});

test('commits successful transactions and always releases the client', async () => {
  const pool = fakePool();
  const db = createDatabase({ pool });

  const result = await db.transaction(async (transaction) => {
    await transaction.query('work');
    return 'done';
  });

  assert.equal(result, 'done');
  assert.deepEqual(pool.events, ['connect', 'BEGIN', 'work', 'COMMIT', 'release']);
});

test('rolls back failed transactions and always releases the client', async () => {
  const pool = fakePool({ failWork: true });
  const db = createDatabase({ pool });

  await assert.rejects(
    db.transaction((transaction) => transaction.query('work')),
    /failed work/,
  );

  assert.deepEqual(pool.events, ['connect', 'BEGIN', 'work', 'ROLLBACK', 'release']);
});

test('applies pending SQL migrations in filename order and skips applied versions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'trackiano-migrations-'));
  await writeFile(path.join(directory, '002_second.sql'), 'SELECT 2;');
  await writeFile(path.join(directory, '001_first.sql'), 'SELECT 1;');
  const applied = new Set(['001_first.sql']);
  const events = [];
  const db = {
    async query(sql) {
      if (sql.includes('SELECT version')) {
        return { rows: [...applied].map((version) => ({ version })) };
      }
      events.push(sql);
      return { rows: [] };
    },
    async transaction(work) {
      return work({
        async query(sql, params) {
          events.push(sql);
          if (sql.includes('INSERT INTO schema_migrations')) applied.add(params[0]);
          return { rows: [] };
        },
      });
    },
  };

  assert.deepEqual(await runMigrations(db, { directory }), ['002_second.sql']);
  assert.deepEqual(await runMigrations(db, { directory }), []);
  assert.ok(events.includes('SELECT 2;'));
  assert.equal(events.includes('SELECT 1;'), false);
});
