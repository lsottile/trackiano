import 'dotenv/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { formatDateInTimeZone, getCalendarMonthPeriod } from './periods.js';
import {
  getBudgets,
  getExpensesInRange,
  getRecentExpenses,
} from './storage.js';
import { roundMoney } from './money.js';
import { assertRuntimeAndBackend, assertRuntimeEnvironment } from './runtimeConfig.js';

const DEFAULT_PORT = 3000;
const DEFAULT_MAX_AGE_SECONDS = 15 * 60;
const DASHBOARD_MONTH_HISTORY = 3;
const DASHBOARD_CACHE_TTL_MS = 10_000;

function resolveWebAppPort(port = null) {
  const candidates = [
    port,
    process.env.PORT,
    process.env.RAILWAY_TCP_APPLICATION_PORT,
    process.env.RAILWAY_TCP_PROXY_PORT,
    process.env.RAILWAY_PORT,
  ];
  const value = candidates.find((candidate) => typeof candidate === 'string' ? candidate.trim() : candidate != null);
  return Number(value ?? DEFAULT_PORT);
}

function formatMonthLabel(isoDate, timeZone) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone })
    .format(new Date(`${isoDate}-15T12:00:00.000Z`));
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
  getBudgets: readBudgets = getBudgets,
  getExpensesInRange: readExpenses = getExpensesInRange,
}) {
  const budgets = await readBudgets();
  const budgetNames = Object.fromEntries(budgets.map((budget) => [budget.id, budget.name]));
  const months = await Promise.all(Array.from({ length: DASHBOARD_MONTH_HISTORY }, async (_, offset) => {
    const range = getCalendarMonthPeriod({ now, offset: -offset, timeZone });
    const totals = await readExpenses(range.start, range.end);
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

function getDaysElapsedInMonth(now, timeZone, monthStart) {
  const currentDate = formatDateInTimeZone(now, timeZone);
  const elapsed = Math.floor((Date.parse(`${currentDate}T00:00:00.000Z`) - Date.parse(`${monthStart}T00:00:00.000Z`)) / (24 * 60 * 60 * 1000)) + 1;
  return Math.max(1, elapsed);
}

export async function buildDashboardData({
  now = new Date(),
  timeZone = process.env.APP_TIMEZONE ?? 'UTC',
  getBudgets: readBudgets = getBudgets,
  getExpensesInRange: readExpenses = getExpensesInRange,
  getRecentExpenses: readRecentExpenses = getRecentExpenses,
} = {}) {
  const [currentPeriodData, recentExpenses] = await Promise.all([
    collectMonthData({
      now,
      timeZone,
      getBudgets: readBudgets,
      getExpensesInRange: readExpenses,
    }),
    readRecentExpenses(20),
  ]);
  const month = currentPeriodData.months[0];
  const daysElapsed = getDaysElapsedInMonth(now, timeZone, month.range.start);
  const daysInMonth = month.range.days;
  const daysRemaining = Math.max(0, daysInMonth - daysElapsed);
  const averagePerDay = roundMoney(month.total / daysElapsed);
  const projectedTotal = roundMoney(averagePerDay * daysInMonth);
  const budgetNames = currentPeriodData.budgetNames;

  return {
    generatedAt: now.toISOString(),
    month: {
      label: month.label,
      total: month.total,
      categories: month.categories,
      daysElapsed,
      daysInMonth,
      daysRemaining,
      averagePerDay,
      projectedTotal,
    },
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
  <title>Mes en curso</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }
    body { margin: 0; background: radial-gradient(circle at top, #111b33 0, #0b1020 42%, #070b16 100%); color: #e5e7eb; }
    main { max-width: 1100px; margin: 0 auto; padding: 20px; }
    .hero { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: end; padding: 8px 0 6px; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 40px); }
    .muted { color: #94a3b8; }
    .summary, .legend { display: grid; gap: 14px; }
    .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 24px 0 18px; }
    .card, .expense { background: rgba(15, 23, 42, 0.92); border: 1px solid rgba(148, 163, 184, 0.16); border-radius: 22px; box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22); }
    .card { padding: 16px; }
    .metric { font-size: 26px; font-weight: 800; margin-top: 8px; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
    .metric.small { font-size: 20px; }
    .progress { height: 8px; margin-top: 10px; border-radius: 999px; background: rgba(148, 163, 184, 0.12); overflow: hidden; }
    .progress > span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #ff5f87, #ff9f43); box-shadow: 0 0 18px rgba(255, 95, 135, 0.24); }
    .section { margin-top: 24px; }
    .section h2 { margin: 0 0 12px; font-size: 20px; letter-spacing: -0.01em; }
    .expense { padding: 14px 16px; }
    .chart-card { padding: 18px; }
    .chart-wrap { overflow-x: auto; padding-bottom: 4px; }
    .chart { width: 100%; max-width: 100%; display: block; }
    .legend { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); margin-top: 16px; }
    .legend-item { display: flex; gap: 10px; align-items: center; color: #dbe4ff; }
    .swatch { width: 12px; height: 12px; border-radius: 999px; flex: 0 0 auto; }
    .swatch.line { width: 24px; border-radius: 999px; }
    .expense-list { display: grid; gap: 10px; }
    .expense-list:empty { min-height: 88px; align-items: center; }
    .expense-row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .expense-row strong { display: block; font-size: 16px; line-height: 1.2; }
    .expense-row span { font-variant-numeric: tabular-nums; }
    .expense-meta { margin-top: 4px; font-size: 13px; color: #94a3b8; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .chip { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; background: rgba(148, 163, 184, 0.12); color: #e2e8f0; font-size: 12px; font-weight: 600; }
    .donut-center { font-size: 20px; font-weight: 800; fill: #f8fafc; }
    .donut-sub { font-size: 11px; fill: #94a3b8; }
    @media (max-width: 640px) {
      main { padding: 12px; }
      .hero { align-items: start; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 16px 0 12px; }
      .card, .expense, .chart-card { border-radius: 18px; }
      .card, .chart-card { padding: 11px; }
      .expense-list { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .expense { padding: 10px; }
      .metric { font-size: 20px; margin-top: 4px; }
      .card .muted { font-size: 12px; }
      .section { margin-top: 18px; }
      .section h2 { font-size: 18px; margin-bottom: 10px; }
      .legend { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
      .legend-item { gap: 8px; font-size: 13px; }
      .chart-wrap { padding-bottom: 2px; }
    }
  </style>
</head>
<body>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <main>
    <div class="hero">
      <div>
        <h1>Mes en curso</h1>
        <div class="muted" id="hero-meta">Resumen solo lectura dentro de Telegram</div>
      </div>
    </div>

    <div class="summary">
      <div class="card"><div class="muted">Mes actual</div><div class="metric" id="month-total">-</div><div class="muted" id="month-meta"></div></div>
      <div class="card"><div class="muted">Promedio diario</div><div class="metric" id="avg-per-day">-</div><div class="muted" id="avg-meta"></div></div>
      <div class="card"><div class="muted">Proyección del mes</div><div class="metric" id="projected-total">-</div><div class="muted" id="projection-meta"></div></div>
      <div class="card"><div class="muted">Días restantes</div><div class="metric" id="days-remaining">-</div><div class="muted" id="days-meta"></div></div>
    </div>

    <div class="section">
      <h2>Últimos gastos</h2>
      <div class="card expense-list" id="expenses"></div>
    </div>

    <div class="section">
      <h2>Gastos por categoría</h2>
      <div class="card chart-card">
        <div class="chart-wrap">
          <svg id="category-chart" class="chart" viewBox="0 0 320 260" role="img" aria-label="Gastos por categoría"></svg>
        </div>
        <div class="legend" id="category-legend"></div>
      </div>
    </div>

    <div class="section">
      <h2>Progreso mensual</h2>
      <div class="card chart-card">
        <div class="chart-wrap">
          <svg id="monthly-chart" class="chart" viewBox="0 0 320 220" role="img" aria-label="Progreso mensual"></svg>
        </div>
      </div>
    </div>
  </main>

  <script>
    const webApp = window.Telegram?.WebApp;
    webApp?.ready?.();
    webApp?.expand?.();

    const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
    const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

    function moneyText(value) {
      return money.format(value ?? 0);
    }

    function moneyCompact(value) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0,
      }).format(value ?? 0);
    }

    function scheduleFrame(callback) {
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(() => callback());
        return;
      }
      setTimeout(callback, 0);
    }

    function formatExpenseDate(value) {
      const raw = String(value ?? '').trim();
      if (!raw) return 'Sin fecha';
      const date = /^\d{4}-\d{2}-\d{2}$/.test(raw)
        ? new Date(raw + 'T00:00:00.000Z')
        : new Date(raw);
      return Number.isNaN(date.getTime()) ? 'Sin fecha' : dateFormat.format(date);
    }

    function formatMonthLabel(value) {
      return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric' }).format(new Date(value));
    }

    function percentText(value) {
      return String(Math.round(value)) + '%';
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function polarToCartesian(cx, cy, radius, angle) {
      const radians = (angle - 90) * Math.PI / 180;
      return {
        x: cx + (radius * Math.cos(radians)),
        y: cy + (radius * Math.sin(radians)),
      };
    }

    function describeArc(cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
      const outerStart = polarToCartesian(cx, cy, outerRadius, endAngle);
      const outerEnd = polarToCartesian(cx, cy, outerRadius, startAngle);
      const innerStart = polarToCartesian(cx, cy, innerRadius, startAngle);
      const innerEnd = polarToCartesian(cx, cy, innerRadius, endAngle);
      const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
      return [
        'M', outerStart.x, outerStart.y,
        'A', outerRadius, outerRadius, 0, largeArc, 0, outerEnd.x, outerEnd.y,
        'L', innerStart.x, innerStart.y,
        'A', innerRadius, innerRadius, 0, largeArc, 1, innerEnd.x, innerEnd.y,
        'Z',
      ].join(' ');
    }

    function renderDonutChart(categories) {
      const chart = document.getElementById('category-chart');
      const legend = document.getElementById('category-legend');
      const visible = categories.filter((category) => category.amount > 0);
      const total = visible.reduce((sum, category) => sum + category.amount, 0);
      const colors = ['#ff5f87', '#ff9f43', '#54a0ff', '#2ecc71', '#a55eea', '#f368e0', '#c8d6e5'];
      const centerX = 160;
      const centerY = 122;
      const outerRadius = 82;
      const innerRadius = 48;
      const topCategories = visible.slice(0, 6);
      const otherAmount = visible.slice(6).reduce((sum, category) => sum + category.amount, 0);
      const chartCategories = otherAmount > 0
        ? [...topCategories, { name: 'Otros', amount: otherAmount }]
        : topCategories;

      chart.replaceChildren();
      legend.replaceChildren();

      if (!chartCategories.length || total <= 0) {
        chart.innerHTML = '<text x="160" y="120" text-anchor="middle" class="donut-center">Sin datos</text>';
        return;
      }

      let angle = 0;
      chartCategories.forEach((category, index) => {
        const share = category.amount / total;
        const nextAngle = angle + (share * 360);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', describeArc(centerX, centerY, innerRadius, outerRadius, angle, nextAngle));
        path.setAttribute('fill', colors[index % colors.length]);
        chart.appendChild(path);
        angle = nextAngle;
      });

      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('cx', centerX);
      ring.setAttribute('cy', centerY);
      ring.setAttribute('r', innerRadius - 1);
      ring.setAttribute('fill', '#0f172a');
      chart.appendChild(ring);

      const totalLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      totalLabel.setAttribute('x', centerX);
      totalLabel.setAttribute('y', centerY - 2);
      totalLabel.setAttribute('text-anchor', 'middle');
      totalLabel.setAttribute('class', 'donut-center');
      totalLabel.textContent = moneyCompact(total);
      chart.appendChild(totalLabel);

      const subLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      subLabel.setAttribute('x', centerX);
      subLabel.setAttribute('y', centerY + 18);
      subLabel.setAttribute('text-anchor', 'middle');
      subLabel.setAttribute('class', 'donut-sub');
      subLabel.textContent = 'total';
      chart.appendChild(subLabel);

      chartCategories.forEach((category, index) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = '<span class="swatch" style="background:' + colors[index % colors.length] + '"></span>' +
          '<span>' + escapeHtml(category.name) + ' · ' + percentText((category.amount / total) * 100) + '</span>';
        legend.appendChild(item);
      });
    }

    function renderMonthlyChart(months) {
      const chart = document.getElementById('monthly-chart');
      const width = 320;
      const height = 220;
      const padding = { top: 20, right: 16, bottom: 38, left: 36 };
      const plotWidth = width - padding.left - padding.right;
      const plotHeight = height - padding.top - padding.bottom;
      const values = months.map((month) => month.total);
      const maxValue = Math.max(1, ...values);
      const step = values.length > 1 ? plotWidth / (values.length - 1) : 0;
      const points = values.map((value, index) => {
        const x = padding.left + (step * index);
        const y = padding.top + plotHeight - ((value / maxValue) * plotHeight);
        return { x, y, value };
      });

      const grid = [];
      for (let tick = 0; tick <= 4; tick += 1) {
        const y = padding.top + (plotHeight / 4) * tick;
        const value = maxValue - ((maxValue / 4) * tick);
        grid.push('<line x1="' + padding.left + '" y1="' + y + '" x2="' + (width - padding.right) + '" y2="' + y + '" stroke="rgba(148,163,184,0.14)" />');
        grid.push('<text x="10" y="' + (y + 4) + '" fill="#94a3b8" font-size="11">' + moneyCompact(value) + '</text>');
      }

      const polyline = points.map((point) => String(point.x) + ',' + String(point.y)).join(' ');
      const labels = points.map((point, index) => {
        const month = months[index];
        return '<text x="' + point.x + '" y="' + (height - 16) + '" text-anchor="middle" fill="#94a3b8" font-size="11">' +
          escapeHtml(month.label.split(' ')[0]) + '</text>';
      }).join('');

      chart.innerHTML = [
        '<rect x="0" y="0" width="' + width + '" height="' + height + '" fill="transparent" />',
        grid.join(''),
        '<polyline points="' + polyline + '" fill="none" stroke="#ff5f87" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />',
        points.map((point) => '<circle cx="' + point.x + '" cy="' + point.y + '" r="4" fill="#ff5f87" />').join(''),
        labels,
      ].join('');
    }

    function renderSummary(data) {
      const month = data.month;
      const displayedMonthLabel = formatMonthLabel(data.generatedAt);
      document.getElementById('hero-meta').textContent = displayedMonthLabel;
      document.getElementById('month-total').textContent = moneyText(month.total);
      document.getElementById('month-meta').textContent = displayedMonthLabel + ' · ' + month.daysElapsed + ' de ' + month.daysInMonth + ' días';
      document.getElementById('avg-per-day').textContent = moneyText(month.averagePerDay);
      document.getElementById('avg-meta').textContent = month.daysElapsed === 1 ? 'primer día del mes' : 'promedio real acumulado';
      document.getElementById('projected-total').textContent = moneyText(month.projectedTotal);
      document.getElementById('projection-meta').textContent = 'Ritmo actual';
      document.getElementById('days-remaining').textContent = String(month.daysRemaining);
      document.getElementById('days-meta').textContent = 'días restantes este mes';

      const expenses = document.getElementById('expenses');
      expenses.replaceChildren(...data.recentExpenses.slice(0, 6).map((expense) => {
        const item = document.createElement('article');
        item.className = 'expense';
        item.innerHTML = '<div class="expense-row"><strong>' + escapeHtml(expense.description) + '</strong><span>' +
          moneyText(expense.amount) + '</span></div><div class="expense-meta"><span class="chip">' +
          escapeHtml(expense.name) + '</span><span>' +
          escapeHtml(formatExpenseDate(expense.expenseDate)) + '</span></div>';
        return item;
      }));
    }

    function renderCharts(data) {
      const month = data.month;
      renderDonutChart(month.categories);
      renderMonthlyChart([...data.months].reverse());
    }

    function renderDashboard(data) {
      renderSummary(data);
      scheduleFrame(() => renderCharts(data));
    }

    async function refresh() {
      try {
        const initData = webApp?.initData ?? '';
        const response = await fetch('/api/dashboard', {
          headers: { 'X-Telegram-Init-Data': initData },
        });
        if (!response.ok) throw new Error(await response.text());
        renderDashboard(await response.json());
      } catch (error) {
        document.getElementById('expenses').replaceChildren();
        document.getElementById('expenses').innerHTML = '<div class="muted">' + escapeHtml(error.message || 'Unable to load dashboard') + '</div>';
      }
    }

    refresh();
  </script>
</body>
</html>`;
}

export function createMiniAppServer({
  botToken = process.env.TELEGRAM_TOKEN,
  ownerId = Number(process.env.TELEGRAM_OWNER_ID),
  timeZone = process.env.APP_TIMEZONE ?? 'UTC',
  port = resolveWebAppPort(),
  getDashboardData: readDashboardData = buildDashboardData,
  parseInitData = parseTelegramWebAppInitData,
  } = {}) {
  let dashboardCache = null;
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
        const now = Date.now();
        if (dashboardCache && (now - dashboardCache.at) < DASHBOARD_CACHE_TTL_MS) {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=10' });
          response.end(JSON.stringify(dashboardCache.payload));
          return;
        }
        const payload = await readDashboardData({ now: new Date(), timeZone });
        dashboardCache = { at: now, payload };
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=10' });
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
      await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));
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
    const app = createMiniAppServer({ port: resolveWebAppPort() });
    await app.start();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
