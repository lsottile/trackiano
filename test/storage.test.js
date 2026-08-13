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

test('PostgreSQL application facade exposes feature methods', async () => {
  const calls = [];
  const storage = createStorage({
    backend: 'postgres',
    postgresRepository: {
      createFinancialEntryAndGetBalances: async (...args) => calls.push(['entry', ...args]),
      createPaydayAndGetBalances: async (...args) => calls.push(['payday', ...args]),
      findLearnedBudget: async (...args) => calls.push(['find', ...args]),
      recategorizeExpenseAndLearn: async (...args) => calls.push(['change', ...args]),
    },
  });

  await storage.createFinancialEntryAndGetBalances({ amount: 1 });
  await storage.createPaydayAndGetBalances({ amount: 2 });
  await storage.findLearnedBudget('a'.repeat(64));
  await storage.recategorizeExpenseAndLearn('expense', 'budget');
  assert.deepEqual(calls, [
    ['entry', { amount: 1 }],
    ['payday', { amount: 2 }],
    ['find', 'a'.repeat(64)],
    ['change', 'expense', 'budget'],
  ]);
});

test('historical Notion facade does not expose PostgreSQL feature methods', () => {
  const storage = createStorage({ backend: 'notion', notionRepository: {} });
  assert.equal(Object.hasOwn(storage, 'createFinancialEntryAndGetBalances'), false);
  assert.equal(Object.hasOwn(storage, 'findLearnedBudget'), false);
  assert.equal(Object.hasOwn(storage, 'recategorizeExpenseAndLearn'), false);
});
