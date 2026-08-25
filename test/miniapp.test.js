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
    getTotalSpentInPeriod: async (periodStart) => {
      calls.push(['period', periodStart.toISOString().slice(0, 10)]);
      return 30;
    },
    getTotalSpentToday: async ({ now }) => {
      calls.push(['today', now.toISOString().slice(0, 10)]);
      return 8.5;
    },
  });

  assert.equal(data.payPeriod.spent, 30);
  assert.equal(data.payPeriod.today, 8.5);
  assert.equal(
    data.payPeriod.projectedEnd,
    Math.round(((data.payPeriod.spent / data.payPeriod.daysElapsed) * (data.payPeriod.daysElapsed + data.payPeriod.daysRemaining)) * 100) / 100,
  );
  assert.equal(data.payPeriod.progress, 12.5);
  assert.equal(data.currentMonth.label, expectedMonthLabel);
  assert.equal(data.recentExpenses[0].name, 'Food');
  assert.equal(calls.filter(([type]) => type === 'range').length, 3);
  assert.deepEqual(calls.at(-2), ['today', '2026-11-24']);
  assert.deepEqual(calls.at(-1), ['recent', 20]);
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
        target: { daily: null },
        payPeriod: {
          start: '2026-11-01',
          daysElapsed: 1,
          spent: 0,
          today: 0,
          targetToDate: null,
          remaining: null,
          daysRemaining: 1,
          pacePerDay: 0,
          projectedEnd: 0,
          progress: null,
        },
        currentMonth: { label: 'Nov 2026', total: 0, categories: [] },
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
