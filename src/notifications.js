import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { Bot } from 'grammy';
import {
  claimSummaryPeriod,
  getBudgets,
  getExpensesInRange,
  getSettings,
} from './notion.js';
import {
  getLatestClosedMonthlyPeriod,
  getLatestClosedWeeklyPeriod,
} from './periods.js';
import { formatAutomaticSummary } from './summary.js';

export function parseTelegramOwnerId(rawOwnerId) {
  if (!rawOwnerId?.trim()) {
    throw new Error('TELEGRAM_OWNER_ID must be a positive safe integer.');
  }
  const ownerId = Number(rawOwnerId);
  if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
    throw new Error('TELEGRAM_OWNER_ID must be a positive safe integer.');
  }
  return ownerId;
}

export async function runNotifications({
  now = new Date(),
  timeZone = process.env.APP_TIMEZONE ?? 'UTC',
  getSettings: readSettings = getSettings,
  claimSummaryPeriod: claimPeriod = claimSummaryPeriod,
  getExpensesInRange: readExpenses = getExpensesInRange,
  getBudgets: readBudgets = getBudgets,
  sendMessage,
} = {}) {
  const weeklyPeriod = getLatestClosedWeeklyPeriod({ now, timeZone });
  const monthlyPeriod = getLatestClosedMonthlyPeriod({ now, timeZone });
  const initialPeriodKeys = {
    initialWeeklyPeriodKey: weeklyPeriod.key,
    initialMonthlyPeriodKey: monthlyPeriod.key,
  };
  const settings = await readSettings(initialPeriodKeys);
  if (settings.dailyTarget === null) return;

  const reports = [
    {
      type: 'weekly',
      period: weeklyPeriod,
      attemptedPeriod: settings.attemptedWeeklyPeriod,
    },
    {
      type: 'monthly',
      period: monthlyPeriod,
      attemptedPeriod: settings.attemptedMonthlyPeriod,
    },
  ];

  for (const report of reports) {
    if (report.attemptedPeriod === report.period.key) continue;
    const [budgets, totals] = await Promise.all([
      readBudgets(),
      readExpenses(report.period.start, report.period.end),
    ]);
    const message = formatAutomaticSummary({
      periodType: report.type,
      period: report.period,
      budgets,
      totals,
      dailyTarget: settings.dailyTarget,
    });
    const claimed = await claimPeriod(report.type, report.period.key, initialPeriodKeys);
    if (!claimed) continue;
    await sendMessage(message);
  }
}

export async function main() {
  const token = process.env.TELEGRAM_TOKEN;
  if (!token) throw new Error('TELEGRAM_TOKEN is required.');
  const ownerId = parseTelegramOwnerId(process.env.TELEGRAM_OWNER_ID);

  const bot = new Bot(token);
  await runNotifications({
    sendMessage: (message) => bot.api.sendMessage(ownerId, message),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
