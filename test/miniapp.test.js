import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';

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
    getBudgets: async () => [
      { id: 'food', name: 'Food' },
      { id: 'investments', name: 'Investments' },
    ],
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
      { id: 'a', budgetId: 'food', description: 'Flight', amount: 150, expenseDate: '2026-11-22', isExtraordinary: false },
      { id: 'b', budgetId: 'food', description: 'Dinner', amount: 80, expenseDate: '2026-11-23', isExtraordinary: false },
      { id: 'c', budgetId: 'investments', description: 'Hotel', amount: 250, expenseDate: '2026-11-21', isExtraordinary: true },
      { id: 'd', budgetId: 'food', description: 'Taxi', amount: 110, expenseDate: '2026-11-20', isExtraordinary: false },
      { id: 'e', budgetId: 'food', description: 'Train', amount: 140, expenseDate: '2026-11-19', isExtraordinary: true },
      { id: 'f', budgetId: 'food', description: 'Lunch', amount: 101, expenseDate: '2026-11-18', isExtraordinary: false },
      { id: 'g', budgetId: 'food', description: 'Coffee', amount: 10, expenseDate: '2026-11-17', isExtraordinary: false },
    ]),
  });

  assert.equal(data.month.total, 841);
  assert.equal(data.month.daysElapsed, 24);
  assert.equal(data.month.daysInMonth, 30);
  assert.equal(data.month.daysRemaining, 6);
  assert.equal(data.month.averagePerDay, 3.33);
  assert.equal(data.month.projectedTotal, 860.98);
  assert.equal(data.month.label, expectedMonthLabel);
  assert.deepEqual(data.month.outflows, {
    total: 841,
    categories: [
      { budgetId: 'food', name: 'Food', amount: 591, extraordinaryAmount: 140 },
      { budgetId: 'investments', name: 'Investments', amount: 250, extraordinaryAmount: 250 },
    ],
  });
  assert.deepEqual(
    data.extraordinaryExpenses.map((expense) => expense.description),
    ['Hotel', 'Train'],
  );
  assert.equal(data.recentExpenses[0].name, 'Food');
  assert.equal(calls.filter(([type]) => type === 'range').length, 3);
  assert.equal(calls.filter(([type]) => type === 'recent').length, 1);
  assert.deepEqual(calls.find(([type]) => type === 'recent'), ['recent', 20]);
});

test('adds the expected remaining spend to actual totals after a large extraordinary expense', async () => {
  const data = await buildDashboardData({
    now: new Date('2026-11-24T12:00:00.000Z'),
    timeZone: 'UTC',
    getBudgets: async () => [{ id: 'travel', name: 'Travel' }],
    getExpensesInRange: async () => ({ travel: 100 }),
    getMonthlyExpenseDetails: async () => ([
      { id: 'expense', budgetId: 'travel', description: 'Emergency flight', amount: 1_000, expenseDate: '2026-11-20', isExtraordinary: true },
    ]),
    getRecentExpenses: async () => [],
  });

  assert.equal(data.month.projectedTotal, 1_025.02);
});

test('renders outflow categories and extraordinary amounts in the dashboard legend', async () => {
  const app = createMiniAppServer({ port: 0, botToken: 'token', ownerId: 42 });
  const server = await app.start();
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const dashboard = await response.text();
    const script = dashboard.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];
    assert.ok(script, 'dashboard must include its rendering script');

    const elements = new Map([
      ['category-chart', createElement()],
      ['category-legend', createElement()],
      ['hero-meta', createElement()],
      ['month-total', createElement()],
      ['month-meta', createElement()],
      ['avg-per-day', createElement()],
      ['avg-meta', createElement()],
      ['projected-total', createElement()],
      ['projection-meta', createElement()],
      ['days-remaining', createElement()],
      ['days-meta', createElement()],
      ['expenses', createElement()],
      ['extraordinary-expenses', createElement()],
    ]);
    const dashboardData = {
      generatedAt: '2026-11-24T12:00:00.000Z',
      month: {
        total: 80,
        daysElapsed: 24,
        daysInMonth: 30,
        daysRemaining: 6,
        averagePerDay: 3.33,
        projectedTotal: 99.9,
        outflows: {
          categories: [
            { name: 'Food', amount: 591, extraordinaryAmount: 140 },
            { name: 'Investments', amount: 250, extraordinaryAmount: 250 },
          ],
        },
      },
      recentExpenses: [],
      extraordinaryExpenses: [],
    };

    vm.runInNewContext(script, {
      Date,
      Intl,
      Math,
      String,
      document: {
        createElement,
        createElementNS: (_namespace, tagName) => createElement(tagName),
        getElementById: (id) => elements.get(id),
      },
      fetch: async () => ({ ok: true, json: async () => dashboardData }),
      window: {},
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(elements.get('category-chart').children.filter((child) => child.tagName === 'path').length, 2);
    assert.deepEqual(
      elements.get('category-legend').children.map((item) => item.innerHTML),
      [
        '<span class="swatch" style="background:#ff5f87"></span><span>Food · 70% · $140.00 extraordinario</span>',
        '<span class="swatch" style="background:#ff9f43"></span><span>Investments · 30% · $250.00 extraordinario</span>',
      ],
    );
  } finally {
    await app.stop();
  }
});

test('labels only the dashboard daily average as excluding extraordinary expenses', async () => {
  const app = createMiniAppServer({ port: 0, botToken: 'token', ownerId: 42 });
  const server = await app.start();
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/`);
    const dashboard = await response.text();

    assert.match(dashboard, /Consumo del mes<\/div>/);
    assert.doesNotMatch(dashboard, /Consumo del mes \(sin gastos extraordinarios\)/);
    assert.match(dashboard, /Promedio diario \(sin gastos extraordinarios\)/);
    assert.match(dashboard, /Proyección del mes<\/div>/);
    assert.doesNotMatch(dashboard, /Proyección del mes \(sin gastos extraordinarios\)/);
  } finally {
    await app.stop();
  }
});

function createElement(tagName = '') {
  return {
    children: [],
    innerHTML: '',
    tagName,
    textContent: '',
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = children;
    },
    setAttribute(name, value) {
      if (name === 'class') this.className = value;
    },
  };
}

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
