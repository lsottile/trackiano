import assert from 'node:assert/strict';
import test from 'node:test';

import { findBudgetByName, selectInferredBudget } from '../src/inferCategory.js';

const budgets = [
  { id: 'budget-food', name: 'Food', amount: 1000 },
  { id: 'budget-transport', name: 'Transport', amount: 500 },
];

test('finds budget by exact case-insensitive name', () => {
  assert.deepEqual(findBudgetByName(budgets, 'food'), budgets[0]);
});

test('selects inferred budget when confidence is high enough', () => {
  assert.deepEqual(
    selectInferredBudget(budgets, {
      categoryName: 'Transport',
      confidence: 0.7,
      reason: 'Bus fare',
    }),
    budgets[1],
  );
});

test('rejects low-confidence inference', () => {
  assert.equal(
    selectInferredBudget(budgets, {
      categoryName: 'Food',
      confidence: 0.69,
      reason: 'Maybe food',
    }),
    null,
  );
});

test('rejects category outside Notion budgets', () => {
  assert.equal(
    selectInferredBudget(budgets, {
      categoryName: 'Entertainment',
      confidence: 0.99,
      reason: 'Not allowed',
    }),
    null,
  );
});
