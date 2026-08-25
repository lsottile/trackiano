import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  buildDashboardData,
  createMiniAppServer,
  parseTelegramWebAppInitData,
} from '../src/miniapp.js';

function signInitData(params, botToken) {
  const data = new URLSearchParams(params);
  const dataCheckString = [...data.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  data.set('hash', hash);
  return data.toString();
}

test('verifies Telegram Web App init data and rejects owner mismatches', () => {
  const botToken = 'token';
  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 42, first_name: 'Luciano' }),
  }, botToken);

  assert.deepEqual(parseTelegramWebAppInitData(initData, botToken), {
    user: { id: 42, first_name: 'Luciano' },
    authDate: Number(new URLSearchParams(initData).get('auth_date')),
  });
  assert.throws(() => parseTelegramWebAppInitData(initData, 'wrong'), /signature mismatch/);
});

test('builds dashboard data for the requested month and current totals', async () => {
  const calls = [];
  const now = new Date('2026-11-24T12:00:00.000Z');
  const timeZone = 'UTC';
  const expectedMonthLabel = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone })
    .format(new Date(`${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`));
  const data = await buildDashboardData({
    now,
    timeZone,
    getBudgets: async () => [{ id: 'food', name: 'Food' }],
    getSettings: async () => ({ id: 'settings', dailyTarget: 10, attemptedWeeklyPeriod: '', attemptedMonthlyPeriod: '' }),
    getExpensesInRange: async (start, end) => {
      calls.push(['range', start, end]);
      return { food: 80 };
    },
    getRecentExpenses: async (limit) => {
      calls.push(['recent', limit]);
      return [{ id: '1', budgetId: 'food', description: 'Lunch', amount: 12, expenseDate: '2026-11-24' }];
    },
    getMonthlyExpenseDetails: async () => ([
      { id: 'a', budgetId: 'food', description: 'Flight', amount: 150, expenseDate: '2026-11-22' },
      { id: 'b', budgetId: 'food', description: 'Dinner', amount: 80, expenseDate: '2026-11-23' },
      { id: 'c', budgetId: 'food', description: 'Hotel', amount: 250, expenseDate: '2026-11-21' },
      { id: 'd', budgetId: 'food', description: 'Taxi', amount: 110, expenseDate: '2026-11-20' },
      { id: 'e', budgetId: 'food', description: 'Train', amount: 140, expenseDate: '2026-11-19' },
      { id: 'f', budgetId: 'food', description: 'Lunch', amount: 101, expenseDate: '2026-11-18' },
      { id: 'g', budgetId: 'food', description: 'Coffee', amount: 10, expenseDate: '2026-11-17' },
    ]),
  });

  assert.equal(data.month.total, 80);
  assert.equal(data.month.daysElapsed, 24);
  assert.equal(data.month.daysInMonth, 30);
  assert.equal(data.month.daysRemaining, 6);
  assert.equal(data.month.averagePerDay, 3.33);
  assert.equal(
    data.month.projectedTotal,
    Math.round((data.month.averagePerDay * data.month.daysInMonth) * 100) / 100,
  );
  assert.equal(data.month.label, expectedMonthLabel);
  assert.deepEqual(
    data.extraordinaryExpenses.map((expense) => expense.description),
    ['Hotel', 'Flight', 'Train', 'Taxi', 'Lunch'],
  );
  assert.equal(data.recentExpenses[0].name, 'Food');
  assert.equal(calls.filter(([type]) => type === 'range').length, 3);
  assert.equal(calls.filter(([type]) => type === 'recent').length, 1);
  assert.deepEqual(calls.find(([type]) => type === 'recent'), ['recent', 20]);
});

test('caches dashboard data briefly at the HTTP layer', async () => {
  let calls = 0;
  const app = createMiniAppServer({
    port: 0,
    botToken: 'token',
    ownerId: 42,
    timeZone: 'UTC',
    parseInitData: () => ({ user: { id: 42 } }),
    getDashboardData: async () => {
      calls += 1;
      return {
        generatedAt: new Date().toISOString(),
        month: { label: 'Nov 2026', total: 0, categories: [], daysElapsed: 1, daysInMonth: 30, daysRemaining: 29, averagePerDay: 0, projectedTotal: 0 },
        months: [],
        recentExpenses: [],
      };
    },
  });

  const server = await app.start();
  try {
    const { port } = server.address();
    const options = {
      headers: { 'X-Telegram-Init-Data': 'init-data' },
    };
    const first = await fetch(`http://127.0.0.1:${port}/api/dashboard`, options);
    const second = await fetch(`http://127.0.0.1:${port}/api/dashboard`, options);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(calls, 1);
  } finally {
    await app.stop();
  }
});
