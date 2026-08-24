import 'dotenv/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { daysSincePeriodStart, getPeriodStart } from './pay.js';
import {
  getCalendarMonthPeriod,
  getLatestClosedMonthlyPeriod,
  getLatestClosedWeeklyPeriod,
} from './periods.js';
import {
  getBudgets,
  getExpensesInRange,
  getRecentExpenses,
  getSettings,
  getTotalSpentInPeriod,
} from './storage.js';
import { roundMoney } from './money.js';
import { assertRuntimeAndBackend, assertRuntimeEnvironment } from './runtimeConfig.js';

const DEFAULT_PORT = 3000;
const DEFAULT_MAX_AGE_SECONDS = 15 * 60;

function formatMonthLabel(isoDate, timeZone) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone })
    .format(new Date(`${isoDate}-01T00:00:00.000Z`));
}

function buildDataCheckString(initData) {
  return [...initData.entries()]
    .filter(([key]) => key !== 'hash')
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

export function parseTelegramWebAppInitData(initData, botToken, {
  now = new Date(),
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
} = {}) {
  if (!initData?.trim()) throw new Error('Missing Telegram init data.');
  if (!botToken?.trim()) throw new Error('TELEGRAM_TOKEN is required.');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  const authDate = Number(params.get('auth_date'));
  if (!hash || !Number.isFinite(authDate)) throw new Error('Invalid Telegram init data.');
  if ((now.getTime() / 1000) - authDate > maxAgeSeconds) {
    throw new Error('Telegram init data expired.');
  }

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const expectedHash = createHmac('sha256', secretKey)
    .update(buildDataCheckString(params))
    .digest('hex');
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('Telegram init data signature mismatch.');
  }

  const user = JSON.parse(params.get('user') ?? 'null');
  if (!user?.id) throw new Error('Telegram user is missing.');
  return { user, authDate };
}

async function collectMonthData({
  now,
  timeZone,
  maxAmount,
  getBudgets: readBudgets = getBudgets,
  getExpensesInRange: readExpenses = getExpensesInRange,
}) {
  const budgets = await readBudgets();
  const budgetNames = Object.fromEntries(budgets.map((budget) => [budget.id, budget.name]));
  const months = await Promise.all([0, 1, 2, 3, 4, 5].map(async (offset) => {
    const range = getCalendarMonthPeriod({ now, offset: -offset, timeZone });
    const totals = await readExpenses(range.start, range.end, { maxAmount });
    const total = roundMoney(Object.values(totals).reduce((sum, amount) => sum + amount, 0));
    const categories = Object.entries(totals)
      .sort((first, second) => second[1] - first[1] || (budgetNames[first[0]] ?? first[0]).localeCompare(budgetNames[second[0]] ?? second[0]))
      .map(([budgetId, amount]) => ({
        budgetId,
        name: budgetNames[budgetId] ?? budgetId,
        amount: roundMoney(amount),
      }));
    return {
      label: formatMonthLabel(range.start.slice(0, 7), timeZone),
      range,
      total,
      categories,
    };
  }));

  return { budgets, budgetNames, months };
}

export async function buildDashboardData({
  now = new Date(),
  timeZone = process.env.APP_TIMEZONE ?? 'UTC',
  maxAmount = null,
  getBudgets: readBudgets = getBudgets,
  getExpensesInRange: readExpenses = getExpensesInRange,
  getRecentExpenses: readRecentExpenses = getRecentExpenses,
  getSettings: readSettings = getSettings,
  getTotalSpentInPeriod: readSpentInPeriod = getTotalSpentInPeriod,
} = {}) {
  const weeklyPeriod = getLatestClosedWeeklyPeriod({ now, timeZone });
  const [settings, currentPeriodData] = await Promise.all([
    readSettings({
      initialWeeklyPeriodKey: weeklyPeriod.key,
      initialMonthlyPeriodKey: getLatestClosedMonthlyPeriod({ now, timeZone }).key,
    }),
    collectMonthData({
      now,
      timeZone,
      maxAmount,
      getBudgets: readBudgets,
      getExpensesInRange: readExpenses,
    }),
  ]);
  const payPeriodStart = getPeriodStart(now);
  const daysElapsed = daysSincePeriodStart(now);
  const [payPeriodSpent, recentExpenses] = await Promise.all([
    readSpentInPeriod(payPeriodStart, { maxAmount }),
    readRecentExpenses(20, { maxAmount }),
  ]);
  const dailyTarget = settings.dailyTarget;
  const targetToDate = dailyTarget === null ? null : roundMoney(dailyTarget * daysElapsed);
  const targetRemaining = targetToDate === null ? null : roundMoney(targetToDate - payPeriodSpent);
  const budgetNames = currentPeriodData.budgetNames;

  return {
    filter: { maxAmount },
    generatedAt: now.toISOString(),
    target: { daily: dailyTarget },
    payPeriod: {
      start: payPeriodStart.toISOString().slice(0, 10),
      daysElapsed,
      spent: payPeriodSpent,
      targetToDate,
      remaining: targetRemaining,
    },
    currentMonth: currentPeriodData.months[0],
    months: currentPeriodData.months,
    recentExpenses: recentExpenses.map((expense) => ({
      ...expense,
      name: budgetNames[expense.budgetId] ?? expense.budgetId,
    })),
  };
}

function renderDashboardHTML() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trackiano Dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }
    body { margin: 0; background: #0b1020; color: #e5e7eb; }
    main { max-width: 1100px; margin: 0 auto; padding: 20px; }
    .hero { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: end; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 40px); }
    .muted { color: #94a3b8; }
    .toolbar, .grid, .months, .expenses { display: grid; gap: 14px; }
    .toolbar { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); margin: 24px 0; }
    .card, .month, .expense { background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.16); border-radius: 18px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2); }
    .card { padding: 16px; }
    .metric { font-size: 28px; font-weight: 700; margin-top: 6px; }
    .section { margin-top: 24px; }
    .section h2 { margin: 0 0 12px; font-size: 20px; }
    .months { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
    .month { padding: 14px; }
    .month h3, .expense strong { margin: 0 0 8px; }
    .bar { height: 8px; border-radius: 999px; background: rgba(148,163,184,0.18); overflow: hidden; margin: 6px 0 0; }
    .bar > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #60a5fa, #34d399); }
    .row { display: flex; gap: 10px; justify-content: space-between; align-items: center; }
    .stack { display: grid; gap: 8px; }
    label { display: grid; gap: 6px; font-size: 13px; color: #cbd5e1; }
    input[type="number"] { width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 12px; border: 1px solid rgba(148,163,184,0.18); background: #0f172a; color: inherit; }
    button { appearance: none; border: 0; border-radius: 12px; padding: 10px 14px; font: inherit; font-weight: 700; color: #0b1020; background: linear-gradient(90deg, #f8fafc, #cbd5e1); cursor: pointer; }
    button.secondary { color: #e2e8f0; background: rgba(148,163,184,0.12); border: 1px solid rgba(148,163,184,0.22); }
    .status { min-height: 22px; color: #93c5fd; }
    .expense { padding: 12px 14px; }
    .expenses { grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; background: rgba(96, 165, 250, 0.12); color: #bfdbfe; font-size: 12px; }
    @media (max-width: 640px) { main { padding: 14px; } .hero { align-items: start; } }
  </style>
</head>
<body>
  <main>
    <div class="hero">
      <div>
        <h1>Trackiano Dashboard</h1>
        <div class="muted">Read-only summary inside Telegram</div>
      </div>
      <div class="pill" id="filter-pill">All expenses</div>
    </div>

    <div class="toolbar">
      <div class="card stack" style="grid-column: span 2;">
        <label><input id="hide-extraordinary" type="checkbox" checked> Hide extraordinary expenses</label>
        <label>Extraordinary threshold
          <input id="max-amount" type="number" min="0" step="0.01" value="100">
        </label>
        <div class="row">
          <button id="refresh">Refresh</button>
          <button id="show-all" class="secondary" type="button">Show all</button>
        </div>
        <div class="status" id="status"></div>
      </div>
      <div class="card"><div class="muted">Spent this pay period</div><div class="metric" id="pay-spent">-</div><div class="muted" id="pay-meta"></div></div>
      <div class="card"><div class="muted">Target to date</div><div class="metric" id="target-to-date">-</div><div class="muted" id="target-meta"></div></div>
      <div class="card"><div class="muted">Remaining</div><div class="metric" id="remaining">-</div><div class="muted">vs. target to date</div></div>
      <div class="card"><div class="muted">Current month</div><div class="metric" id="month-total">-</div><div class="muted" id="month-meta"></div></div>
    </div>

    <div class="section">
      <h2>Last 6 Months</h2>
      <div class="months" id="months"></div>
    </div>

    <div class="section">
      <h2>Recent Expenses</h2>
      <div class="expenses" id="expenses"></div>
    </div>
  </main>

  <script>
    const webApp = window.Telegram?.WebApp;
    webApp?.ready?.();
    webApp?.expand?.();

    const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const status = document.getElementById('status');
    const filterPill = document.getElementById('filter-pill');

    function moneyText(value) {
      return money.format(value ?? 0);
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function buildQuery() {
      const hideExtraordinary = document.getElementById('hide-extraordinary').checked;
      const maxAmount = document.getElementById('max-amount').value.trim();
      const query = new URLSearchParams();
      if (hideExtraordinary && maxAmount) query.set('maxAmount', maxAmount);
      return query.toString();
    }

    function renderDashboard(data) {
      const currentMonth = data.currentMonth;
      document.getElementById('pay-spent').textContent = moneyText(data.payPeriod.spent);
      document.getElementById('pay-meta').textContent = data.target.daily === null
        ? 'Daily target not set'
        : data.payPeriod.daysElapsed + ' days into the pay period';
      document.getElementById('target-to-date').textContent = data.payPeriod.targetToDate === null
        ? '-'
        : moneyText(data.payPeriod.targetToDate);
      document.getElementById('target-meta').textContent = data.target.daily === null
        ? 'Set /target first'
        : moneyText(data.target.daily) + ' per day';
      document.getElementById('remaining').textContent = data.payPeriod.remaining === null
        ? '-'
        : moneyText(data.payPeriod.remaining);
      document.getElementById('month-total').textContent = moneyText(currentMonth.total);
      document.getElementById('month-meta').textContent = currentMonth.label;
      filterPill.textContent = data.filter.maxAmount === null
        ? 'All expenses'
        : 'Extraordinary off > ' + moneyText(data.filter.maxAmount);

      const months = document.getElementById('months');
      months.replaceChildren(...data.months.map((month) => {
        const monthCard = document.createElement('article');
        monthCard.className = 'month';
        const categoryList = month.categories.slice(0, 4).map((category) => {
          const percent = month.total > 0 ? Math.round((category.amount / month.total) * 100) : 0;
          return '<div class="row"><span>' + escapeHtml(category.name) + '</span><span>' +
            moneyText(category.amount) + ' · ' + percent + '%</span></div>';
        }).join('');
        monthCard.innerHTML = '<h3>' + escapeHtml(month.label) + '</h3><div class="muted">' +
          moneyText(month.total) + '</div><div class="stack" style="margin-top:12px;">' +
          (categoryList || '<div class="muted">No expenses</div>') + '</div>';
        return monthCard;
      }));

      const expenses = document.getElementById('expenses');
      expenses.replaceChildren(...data.recentExpenses.map((expense) => {
        const item = document.createElement('article');
        item.className = 'expense';
        item.innerHTML = '<strong>' + escapeHtml(expense.description) + '</strong><div class="row"><span class="muted">' +
          escapeHtml(expense.name) + '</span><span>' + moneyText(expense.amount) + '</span></div><div class="muted">' +
          dateFormat.format(new Date(expense.expenseDate + 'T00:00:00.000Z')) + '</div>';
        return item;
      }));
    }

    async function refresh() {
      status.textContent = 'Loading...';
      try {
        const initData = webApp?.initData ?? '';
        const query = buildQuery();
        const response = await fetch('/api/dashboard' + (query ? '?' + query : ''), {
          headers: { 'X-Telegram-Init-Data': initData },
        });
        if (!response.ok) throw new Error(await response.text());
        renderDashboard(await response.json());
        status.textContent = 'Loaded';
      } catch (error) {
        status.textContent = error.message || 'Unable to load dashboard';
      }
    }

    document.getElementById('refresh').addEventListener('click', refresh);
    document.getElementById('show-all').addEventListener('click', () => {
      document.getElementById('hide-extraordinary').checked = false;
      refresh();
    });
    document.getElementById('hide-extraordinary').addEventListener('change', refresh);
    document.getElementById('max-amount').addEventListener('change', refresh);
    refresh();
  </script>
</body>
</html>`;
}

export function createMiniAppServer({
  botToken = process.env.TELEGRAM_TOKEN,
  ownerId = Number(process.env.TELEGRAM_OWNER_ID),
  timeZone = process.env.APP_TIMEZONE ?? 'UTC',
  port = Number(process.env.PORT ?? DEFAULT_PORT),
  getDashboardData: readDashboardData = buildDashboardData,
  parseInitData = parseTelegramWebAppInitData,
} = {}) {
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (requestUrl.pathname === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('ok');
      return;
    }
    if (requestUrl.pathname === '/api/dashboard') {
      try {
        const initData = request.headers['x-telegram-init-data'] ?? '';
        const { user } = parseInitData(String(initData), botToken, { now: new Date() });
        if (Number(user.id) !== ownerId) {
          response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Unauthorized' }));
          return;
        }
        const maxAmountRaw = requestUrl.searchParams.get('maxAmount');
        const maxAmount = maxAmountRaw === null || maxAmountRaw === '' ? null : Number(maxAmountRaw);
        if (maxAmount !== null && (!Number.isFinite(maxAmount) || maxAmount < 0)) {
          response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: 'Invalid maxAmount' }));
          return;
        }
        const payload = await readDashboardData({ now: new Date(), timeZone, maxAmount });
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify(payload));
        return;
      } catch (error) {
        response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
        response.end(JSON.stringify({ error: error.message }));
        return;
      }
    }

    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(renderDashboardHTML());
  });

  return {
    async start() {
      await new Promise((resolve) => server.listen(port, resolve));
      return server;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assertRuntimeAndBackend();
    assertRuntimeEnvironment();
    const app = createMiniAppServer();
    await app.start();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
