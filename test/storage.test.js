import assert from 'node:assert/strict';
import test from 'node:test';

import { createStorage } from '../src/storage.js';

test('uses the injected PostgreSQL repository', async () => {
  const storage = createStorage({
    postgresRepository: { getBudgets: async () => ['postgres'] },
  });

  assert.deepEqual(await storage.getBudgets(), ['postgres']);
});

test('exposes the PostgreSQL feature methods', async () => {
  const calls = [];
  const storage = createStorage({
    postgresRepository: {
      findLearnedBudget: async (...args) => calls.push(['find', ...args]),
      recategorizeExpenseAndLearn: async (...args) => calls.push(['change', ...args]),
    },
  });

  await storage.findLearnedBudget('a'.repeat(64));
  await storage.recategorizeExpenseAndLearn('expense', 'budget');
  assert.deepEqual(calls, [
    ['find', 'a'.repeat(64)],
    ['change', 'expense', 'budget'],
  ]);
});
