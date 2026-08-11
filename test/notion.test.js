import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { Client } from '@notionhq/client';

const notionRequests = [];
const expenseQueryResponses = [];
const settingsQueryResponses = [];
const pageCreateResponses = [];

mock.method(Client.prototype, 'request', async (request) => {
  notionRequests.push(request);
  if (request.path === 'databases/test-expenses/query') {
    return expenseQueryResponses.shift() ?? { results: [] };
  }
  if (request.path === 'databases/test-settings/query') {
    return settingsQueryResponses.shift() ?? { results: [] };
  }
  if (request.path === 'pages') {
    return pageCreateResponses.shift() ?? {};
  }
  return {};
});

process.env.APP_TIMEZONE = 'America/Guatemala';
process.env.NOTION_TOKEN = 'test-token';
process.env.NOTION_EXPENSES_DB_ID = 'test-expenses';
process.env.NOTION_BUDGETS_DB_ID = 'test-budgets';
process.env.NOTION_SETTINGS_DB_ID = 'test-settings';

const {
  claimSummaryPeriod,
  createExpense,
  createExpenseAndGetTotalToday,
  deleteExpense,
  getExpensesInRange,
  getMonthlyExpenseDetails,
  getMonthlyExpenses,
  getSettings,
  getTotalSpentToday,
  setDailyTarget,
  updateExpenseBudget,
} = await import('../src/notion.js');

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

  pageCreateResponses.push({ id: 'expense-1' });
  const expenseId = await createExpense({
    description: 'coffee',
    amount: 5.305,
    budgetId: 'budget-food',
    now: new Date('2026-07-20T05:30:00.000Z'),
  });

  assert.equal(expenseId, 'expense-1');
  assert.equal(notionRequests[0].body.properties.amount.number, 5.31);
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

test('uses one timestamp for the pre-write total and expense date', async (t) => {
  notionRequests.length = 0;
  expenseQueryResponses.push({
    results: [expensePage('budget-food', 5)],
  });

  const RealDate = Date;
  const timestamps = [
    new RealDate('2026-07-22T05:59:59.000Z'),
    new RealDate('2026-07-22T06:00:00.000Z'),
  ];
  let clockReads = 0;
  t.mock.method(global, 'Date', class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [timestamps[clockReads++]]));
    }
  });

  pageCreateResponses.push({ id: 'expense-1' });
  const result = await createExpenseAndGetTotalToday({
    description: 'coffee',
    amount: 5,
    budgetId: 'budget-food',
  });

  assert.deepEqual(result, { expenseId: 'expense-1', totalToday: 10 });
  assert.equal(clockReads, 1);
  assert.equal(notionRequests[0].path, 'databases/test-expenses/query');
  assert.equal(notionRequests[1].path, 'pages');
  assert.equal(notionRequests[0].body.filter.date.equals, '2026-07-21');
  assert.equal(notionRequests[1].body.properties.date.date.start, '2026-07-21');
});

test('updates or deletes the exact expense selected in Telegram', async () => {
  notionRequests.length = 0;

  await updateExpenseBudget('expense-1', 'budget-investments');
  await deleteExpense('expense-1');

  assert.equal(notionRequests[0].path, 'pages/expense-1');
  assert.deepEqual(notionRequests[0].body.properties, {
    budget: { relation: [{ id: 'budget-investments' }] },
  });
  assert.equal(notionRequests[1].path, 'pages/expense-1');
  assert.equal(notionRequests[1].body.archived, true);
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

test('returns every current-month expense detail for verbose summaries', async () => {
  notionRequests.length = 0;
  expenseQueryResponses.push({
    results: [
      {
        id: 'expense-coffee',
        properties: {
          budget: { relation: [{ id: 'budget-food' }] },
          description: { title: [{ plain_text: 'Coffee' }] },
          amount: { number: 5.5 },
        },
      },
    ],
    has_more: false,
  });

  const expenses = await getMonthlyExpenseDetails({
    now: new Date('2026-08-01T02:00:00.000Z'),
  });

  assert.deepEqual(expenses, [{
    id: 'expense-coffee',
    budgetId: 'budget-food',
    description: 'Coffee',
    amount: 5.5,
  }]);
  assert.deepEqual(notionRequests[0].body.filter, {
    and: [
      { property: 'date', date: { on_or_after: '2026-07-01' } },
      { property: 'date', date: { before: '2026-08-01' } },
    ],
  });
});

test('queries an exact half-open date range and paginates every result', async () => {
  notionRequests.length = 0;
  expenseQueryResponses.push(
    {
      results: [expensePage('budget-food', 8)],
      has_more: true,
      next_cursor: 'range-page-2',
    },
    {
      results: [expensePage('budget-food', 12)],
      has_more: false,
      next_cursor: null,
    },
  );

  const totals = await getExpensesInRange('2026-07-20', '2026-07-27');

  assert.deepEqual(totals, { 'budget-food': 20 });
  assert.deepEqual(notionRequests[0].body.filter, {
    and: [
      { property: 'date', date: { on_or_after: '2026-07-20' } },
      { property: 'date', date: { before: '2026-07-27' } },
    ],
  });
  assert.equal(notionRequests[0].body.start_cursor, undefined);
  assert.equal(notionRequests[1].body.start_cursor, 'range-page-2');
});

test('initializes a missing settings singleton with closed periods already claimed', async () => {
  notionRequests.length = 0;
  settingsQueryResponses.push({ results: [] });
  pageCreateResponses.push({
    id: 'settings-page',
    properties: {
      Name: { title: [{ plain_text: 'Trackiano Settings' }] },
      'Daily target': { number: null },
      'Attempted weekly period': {
        rich_text: [{ plain_text: '2026-07-13/2026-07-20' }],
      },
      'Attempted monthly period': { rich_text: [{ plain_text: '2026-06' }] },
    },
  });

  const settings = await getSettings({
    initialWeeklyPeriodKey: '2026-07-13/2026-07-20',
    initialMonthlyPeriodKey: '2026-06',
  });

  assert.deepEqual(settings, {
    id: 'settings-page',
    dailyTarget: null,
    attemptedWeeklyPeriod: '2026-07-13/2026-07-20',
    attemptedMonthlyPeriod: '2026-06',
  });
  assert.deepEqual(notionRequests[1].body.properties, {
    Name: { title: [{ text: { content: 'Trackiano Settings' } }] },
    'Attempted weekly period': {
      rich_text: [{ text: { content: '2026-07-13/2026-07-20' } }],
    },
    'Attempted monthly period': {
      rich_text: [{ text: { content: '2026-06' } }],
    },
  });
});

test('initializes blank attempted periods on an existing settings singleton', async () => {
  notionRequests.length = 0;
  settingsQueryResponses.push({
    results: [
      {
        id: 'settings-page',
        properties: {
          'Daily target': { number: 70 },
          'Attempted weekly period': { rich_text: [] },
          'Attempted monthly period': { rich_text: [] },
        },
      },
    ],
  });

  const settings = await getSettings({
    initialWeeklyPeriodKey: '2026-07-13/2026-07-20',
    initialMonthlyPeriodKey: '2026-06',
  });

  assert.deepEqual(settings, {
    id: 'settings-page',
    dailyTarget: 70,
    attemptedWeeklyPeriod: '2026-07-13/2026-07-20',
    attemptedMonthlyPeriod: '2026-06',
  });
  assert.deepEqual(notionRequests[1].body.properties, {
    'Attempted weekly period': {
      rich_text: [{ text: { content: '2026-07-13/2026-07-20' } }],
    },
    'Attempted monthly period': {
      rich_text: [{ text: { content: '2026-06' } }],
    },
  });
});

test('initializes only a blank attempted period without overwriting existing settings', async () => {
  notionRequests.length = 0;
  settingsQueryResponses.push({
    results: [
      {
        id: 'settings-page',
        properties: {
          'Daily target': { number: 70 },
          'Attempted weekly period': {
            rich_text: [{ plain_text: '2026-07-06/2026-07-13' }],
          },
          'Attempted monthly period': { rich_text: [] },
        },
      },
    ],
  });

  const settings = await getSettings({
    initialWeeklyPeriodKey: '2026-07-13/2026-07-20',
    initialMonthlyPeriodKey: '2026-06',
  });

  assert.deepEqual(settings, {
    id: 'settings-page',
    dailyTarget: 70,
    attemptedWeeklyPeriod: '2026-07-06/2026-07-13',
    attemptedMonthlyPeriod: '2026-06',
  });
  assert.deepEqual(notionRequests[1].body.properties, {
    'Attempted monthly period': {
      rich_text: [{ text: { content: '2026-06' } }],
    },
  });
});

test('initializes blank attempted periods before persisting the recurring daily target', async () => {
  notionRequests.length = 0;
  settingsQueryResponses.push({
    results: [
      {
        id: 'settings-page',
        properties: {
          'Daily target': { number: 50 },
          'Attempted weekly period': { rich_text: [] },
          'Attempted monthly period': { rich_text: [] },
        },
      },
    ],
  });

  await setDailyTarget(70, {
    initialWeeklyPeriodKey: '2026-07-13/2026-07-20',
    initialMonthlyPeriodKey: '2026-06',
  });

  assert.deepEqual(notionRequests[1].body.properties, {
    'Attempted weekly period': {
      rich_text: [{ text: { content: '2026-07-13/2026-07-20' } }],
    },
    'Attempted monthly period': {
      rich_text: [{ text: { content: '2026-06' } }],
    },
  });
  assert.equal(notionRequests[2].path, 'pages/settings-page');
  assert.deepEqual(notionRequests[2].body.properties, {
    'Daily target': { number: 70 },
  });
});

test('persists an attempted period claim before reporting success', async () => {
  notionRequests.length = 0;
  settingsQueryResponses.push({
    results: [
      {
        id: 'settings-page',
        properties: {
          'Daily target': { number: 70 },
          'Attempted weekly period': {
            rich_text: [{ plain_text: '2026-07-13/2026-07-20' }],
          },
          'Attempted monthly period': { rich_text: [] },
        },
      },
    ],
  });

  const claimed = await claimSummaryPeriod(
    'weekly',
    '2026-07-20/2026-07-27',
  );

  assert.equal(claimed, true);
  assert.deepEqual(notionRequests[1].body.properties, {
    'Attempted weekly period': {
      rich_text: [{ text: { content: '2026-07-20/2026-07-27' } }],
    },
  });
});
