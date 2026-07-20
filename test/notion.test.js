import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { Client } from '@notionhq/client';

const notionRequests = [];

mock.method(Client.prototype, 'request', async (request) => {
  notionRequests.push(request);
  if (request.path === 'databases/test-expenses/query') {
    return { results: [] };
  }
  return {};
});

process.env.APP_TIMEZONE = 'America/Guatemala';
process.env.NOTION_TOKEN = 'test-token';
process.env.NOTION_EXPENSES_DB_ID = 'test-expenses';
process.env.NOTION_BUDGETS_DB_ID = 'test-budgets';

const { createExpense, getTotalSpentToday } = await import('../src/notion.js');

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
