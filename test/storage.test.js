import assert from 'node:assert/strict';
import test from 'node:test';

import { createStorage } from '../src/storage.js';

test('defaults to the Notion backend before cutover', async () => {
  const storage = createStorage({
    notionRepository: { getBudgets: async () => ['notion'] },
    postgresRepository: { getBudgets: async () => ['postgres'] },
  });

  assert.deepEqual(await storage.getBudgets(), ['notion']);
});

test('selects PostgreSQL explicitly', async () => {
  const storage = createStorage({
    backend: 'postgres',
    notionRepository: { getBudgets: async () => ['notion'] },
    postgresRepository: { getBudgets: async () => ['postgres'] },
  });

  assert.deepEqual(await storage.getBudgets(), ['postgres']);
});

test('rejects an unknown storage backend', () => {
  assert.throws(
    () => createStorage({ backend: 'mongo', notionRepository: {}, postgresRepository: {} }),
    /Unknown STORAGE_BACKEND: mongo/,
  );
});
