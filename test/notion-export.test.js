import assert from 'node:assert/strict';
import test from 'node:test';

import { exportNotionData, normalizeNotionUuid } from '../src/notion-export.js';

const budgetId = '11111111-1111-1111-1111-111111111111';
const expenseId = '22222222-2222-2222-2222-222222222222';

function page(id, properties) {
  return { id, properties };
}

function fakeClient(responses) {
  const calls = [];
  return {
    calls,
    databases: {
      async query(request) {
        calls.push(request);
        return responses[request.database_id].shift();
      },
    },
  };
}

test('normalizes canonical and compact Notion UUIDs', () => {
  assert.equal(normalizeNotionUuid(budgetId), budgetId);
  assert.equal(normalizeNotionUuid(budgetId.replaceAll('-', '')), budgetId);
  assert.throws(() => normalizeNotionUuid('bad-id'), /Invalid Notion UUID/);
});

test('exports every paginated budget, expense, and settings page', async () => {
  const client = fakeClient({
    budgets: [
      { results: [], has_more: true, next_cursor: 'budget-page-2' },
      { results: [page(budgetId, {
        budget: { title: [{ plain_text: 'Food' }] },
        amount: { number: 100.005 },
      })], has_more: false },
    ],
    expenses: [{ results: [page(expenseId, {
      description: { title: [{ plain_text: 'Coffee' }] },
      amount: { number: 10.005 },
      date: { date: { start: '2026-08-10' } },
      budget: { relation: [{ id: budgetId }] },
    })], has_more: false }],
    settings: [{ results: [page('33333333-3333-3333-3333-333333333333', {
      'Daily target': { number: 70 },
      'Attempted weekly period': { rich_text: [{ plain_text: 'week-1' }] },
      'Attempted monthly period': { rich_text: [{ plain_text: 'month-1' }] },
    })], has_more: false }],
  });

  const data = await exportNotionData(client, {
    budgetsDatabaseId: 'budgets',
    expensesDatabaseId: 'expenses',
    settingsDatabaseId: 'settings',
  });

  assert.deepEqual(data, {
    budgets: [{ id: budgetId, name: 'Food', amount: 100.01 }],
    expenses: [{
      id: expenseId,
      budgetId,
      description: 'Coffee',
      amount: 10.01,
      date: '2026-08-10',
    }],
    settings: {
      dailyTarget: 70,
      attemptedWeeklyPeriod: 'week-1',
      attemptedMonthlyPeriod: 'month-1',
    },
  });
  assert.ok(client.calls.some((call) =>
    call.database_id === 'budgets' && call.start_cursor === 'budget-page-2'));
});

test('rejects an expense that references an unknown budget before import', async () => {
  const client = fakeClient({
    budgets: [{ results: [], has_more: false }],
    expenses: [{ results: [page(expenseId, {
      description: { title: [{ plain_text: 'Coffee' }] },
      amount: { number: 10 },
      date: { date: { start: '2026-08-10' } },
      budget: { relation: [{ id: budgetId }] },
    })], has_more: false }],
    settings: [{ results: [], has_more: false }],
  });

  await assert.rejects(
    exportNotionData(client, {
      budgetsDatabaseId: 'budgets',
      expensesDatabaseId: 'expenses',
      settingsDatabaseId: 'settings',
    }),
    new RegExp(`Expense ${expenseId} references unknown budget ${budgetId}`),
  );
});
