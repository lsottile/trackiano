import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../migrations/004_income_entries.sql', import.meta.url);

test('migration 004 defaults legacy rows to expense and constrains income shape', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /entry_type TEXT NOT NULL DEFAULT 'expense'/);
  assert.match(sql, /DROP NOT NULL/);
  assert.match(sql, /entry_type IN \('expense', 'income'\)/);
  assert.match(sql, /entry_type = 'expense'.*budget_id IS NOT NULL/s);
  assert.match(sql, /entry_type = 'income'.*budget_id IS NULL/s);
  assert.match(sql, /entry_type <> 'income'.*amount > 0/s);
});
