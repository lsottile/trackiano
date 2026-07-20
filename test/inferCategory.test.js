import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { findBudgetByName, inferCategory, selectInferredBudget } from '../src/inferCategory.js';

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

test('requests category inference with all allowed categories and expense details', async () => {
  const previousApiKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';

  const fetchMock = mock.method(globalThis, 'fetch', async (_url, options) => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              categoryName: 'Transport',
              confidence: 0.9,
              reason: 'Recurring transit expense',
            }),
          },
        },
      ],
    }),
  }));

  try {
    const inference = await inferCategory({
      description: 'monthly train pass',
      amount: 42.75,
      budgets,
    });

    assert.equal(inference.categoryName, 'Transport');

    const requestBody = JSON.parse(fetchMock.mock.calls[0].arguments[1].body);
    const userMessage = JSON.parse(requestBody.messages[1].content);
    assert.deepEqual(userMessage.allowedCategories, ['Food', 'Transport']);
    assert.deepEqual(userMessage.expense, {
      description: 'monthly train pass',
      amount: 42.75,
    });
    assert.equal(requestBody.response_format?.type, 'json_object');
    assert.notEqual(requestBody.response_format?.type, 'json_schema');
    assert.equal(
      JSON.stringify(requestBody.response_format ?? {}).includes('enum'),
      false,
    );
  } finally {
    if (previousApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = previousApiKey;
    }
    fetchMock.mock.restore();
  }
});
