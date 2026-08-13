import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../migrations/005_accounting_periods.sql', import.meta.url);

test('migration 005 creates durable owner-scoped ordered period boundaries', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /CREATE TABLE accounting_periods/);
  assert.match(sql, /user_id UUID NOT NULL[\s\S]*REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(sql, /request_key TEXT NOT NULL/);
  assert.match(sql, /started_at TIMESTAMPTZ NOT NULL/);
  assert.match(sql, /UNIQUE \(user_id, request_key\)/);
  assert.match(sql, /CREATE INDEX accounting_periods_user_started_idx[\s\S]*user_id, started_at DESC, id DESC/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON accounting_periods FROM anon/);
  assert.match(sql, /REVOKE ALL ON accounting_periods FROM authenticated/);
});
