import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRuntimeAndBackend,
  assertRuntimeEnvironment,
} from '../src/runtimeConfig.js';

test('accepts Node 22 with the exact PostgreSQL backend', () => {
  assert.doesNotThrow(() => assertRuntimeAndBackend({
    nodeVersion: '22.12.0', storageBackend: 'postgres',
  }));
});

test('rejects unsupported, malformed, and unconfigured runtimes before startup', () => {
  for (const nodeVersion of ['21.7.0', '23.0.0', '25.9.0', '', 'banana']) {
    assert.throws(
      () => assertRuntimeAndBackend({ nodeVersion, storageBackend: 'postgres' }),
      /Node\.js 22\.x is required/,
    );
  }
});

test('rejects every backend except the exact postgres value', () => {
  for (const storageBackend of [undefined, '', 'notion', 'Postgres', 'POSTGRES', ' postgres', 'mongo']) {
    assert.throws(
      () => assertRuntimeAndBackend({ nodeVersion: '22.0.0', storageBackend }),
      /STORAGE_BACKEND must be exactly "postgres"/,
    );
  }
});

test('accepts complete require and disable runtime environments', () => {
  const base = { DATABASE_URL: 'postgres://db', TELEGRAM_OWNER_ID: '42' };
  assert.doesNotThrow(() => assertRuntimeEnvironment({
    ...base, PGSSLMODE: 'require', PGSSLROOTCERT: '/cert.pem',
  }));
  assert.doesNotThrow(() => assertRuntimeEnvironment({ ...base, PGSSLMODE: 'disable' }));
});

test('rejects missing or invalid runtime environment values', () => {
  const valid = {
    DATABASE_URL: 'postgres://db', TELEGRAM_OWNER_ID: '42',
    PGSSLMODE: 'require', PGSSLROOTCERT: '/cert.pem',
  };
  for (const [key, value] of [
    ['DATABASE_URL', ''], ['TELEGRAM_OWNER_ID', '0'],
    ['TELEGRAM_OWNER_ID', '1.5'], ['PGSSLMODE', 'prefer'],
    ['PGSSLMODE', undefined], ['PGSSLROOTCERT', ''],
  ]) {
    assert.throws(() => assertRuntimeEnvironment({ ...valid, [key]: value }), new RegExp(key));
  }
});
