import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import {
  buildDashboardData,
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

test('builds dashboard data with the extraordinary filter applied everywhere', async () => {
  const calls = [];
  const data = await buildDashboardData({
    now: new Date('2026-08-24T12:00:00.000Z'),
    timeZone: 'UTC',
    getBudgets: async () => [{ id: 'food', name: 'Food' }],
    getSettings: async () => ({ id: 'settings', dailyTarget: 10, attemptedWeeklyPeriod: '', attemptedMonthlyPeriod: '' }),
    getExpensesInRange: async (start, end) => {
      calls.push(['range', start, end]);
      return { food: 80 };
    },
    getRecentExpenses: async (limit) => {
      calls.push(['recent', limit]);
      return [{ id: '1', budgetId: 'food', description: 'Lunch', amount: 12, expenseDate: '2026-08-24' }];
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
  assert.equal(data.payPeriod.projectedEnd, 38.75);
  assert.equal(data.payPeriod.progress, 12.5);
  assert.equal(data.recentExpenses[0].name, 'Food');
  assert.equal(calls.filter(([type]) => type === 'range').length, 6);
  assert.deepEqual(calls.at(-2), ['today', '2026-08-24']);
  assert.deepEqual(calls.at(-1), ['recent', 20]);
});
