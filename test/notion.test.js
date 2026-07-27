import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { Client } from '@notionhq/client';

const notionRequests = [];
const expenseQueryResponses = [];

mock.method(Client.prototype, 'request', async (request) => {
  notionRequests.push(request);
  if (request.path === 'databases/test-expenses/query') {
    return expenseQueryResponses.shift() ?? { results: [] };
  }
  return {};
});

process.env.APP_TIMEZONE = 'America/Guatemala';
process.env.NOTION_TOKEN = 'test-token';
process.env.NOTION_EXPENSES_DB_ID = 'test-expenses';
process.env.NOTION_BUDGETS_DB_ID = 'test-budgets';

const { createExpense, getMonthlyExpenses, getTotalSpentToday } = await import('../src/notion.js');

function expensePage(categoryId, amount) {
  return {
    properties: {
      budget: { relation: [{ id: categoryId }] },
      amount: { number: amount },
    },
  };
}

test('creates expense with Guatemala local date for UTC instant still previous day locally', async () => {
  notionRequests.length = 0;

  await createExpense({
    description: 'coffee',
    amount: 5.3,
    budgetId: 'budget-food',
    now: new Date('2026-07-20T05:30:00.000Z'),
  });

  assert.equal(
    notionRequests[0].body.properties.date.date.start,
    '2026-07-19',
  );
});

test('queries today total with Guatemala local date for UTC instant already next day', async () => {
  notionRequests.length = 0;

  await getTotalSpentToday({
    now: new Date('2026-07-22T02:00:00.000Z'),
  });

  assert.equal(
    notionRequests[0].body.filter.date.equals,
    '2026-07-21',
  );
});

test('aggregates every Notion page for the current app calendar month', async () => {
  notionRequests.length = 0;
  expenseQueryResponses.push(
    {
      results: [expensePage('budget-food', 12.5)],
      has_more: true,
      next_cursor: 'next-expenses-page',
    },
    {
      results: [
        expensePage('budget-food', 7.5),
        expensePage('budget-transport', 10),
      ],
      has_more: false,
      next_cursor: null,
    },
  );

  const totals = await getMonthlyExpenses({
    now: new Date('2026-08-01T02:00:00.000Z'),
  });

  assert.deepEqual(totals, {
    'budget-food': 20,
    'budget-transport': 10,
  });
  assert.deepEqual(notionRequests[0].body.filter, {
    and: [
      { property: 'date', date: { on_or_after: '2026-07-01' } },
      { property: 'date', date: { before: '2026-08-01' } },
    ],
  });
  assert.equal(notionRequests[0].body.start_cursor, undefined);
  assert.equal(notionRequests[1].body.start_cursor, 'next-expenses-page');
});
