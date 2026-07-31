import { Client } from '@notionhq/client';
import 'dotenv/config';
import { formatDateInTimeZone } from './periods.js';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const EXPENSES_DB_ID = process.env.NOTION_EXPENSES_DB_ID;
const BUDGETS_DB_ID = process.env.NOTION_BUDGETS_DB_ID;
const SETTINGS_DB_ID = process.env.NOTION_SETTINGS_DB_ID;
const SETTINGS_NAME = 'Trackiano Settings';
const SETTINGS_PROPERTIES = {
  dailyTarget: 'Daily target',
  weeklyPeriod: 'Attempted weekly period',
  monthlyPeriod: 'Attempted monthly period',
};

export function formatAppDate(date = new Date()) {
  return formatDateInTimeZone(date);
}

export async function findBudgetId(categoryName) {
  const response = await notion.databases.query({ database_id: BUDGETS_DB_ID });
  const match = response?.results?.find((page) => {
    const title = page?.properties?.budget?.title?.[0]?.plain_text ?? '';
    return title.toLowerCase() === categoryName.toLowerCase();
  });
  return match?.id ?? null;
}

export async function getBudgets() {
  const response = await notion.databases.query({ database_id: BUDGETS_DB_ID });
  return response?.results?.map((page) => ({
    id: page?.id ?? '',
    name: page?.properties?.budget?.title?.[0]?.plain_text ?? '',
    amount: page?.properties?.amount?.number ?? 0,
  })) ?? [];
}

export async function getPeriodSpent(categoryId, periodStart) {
  const expenses = await getCategoryExpenses(categoryId, periodStart);
  return expenses.reduce((sum, e) => sum + e.amount, 0);
}

async function getExpensePagesInRange(start, end) {
  const pages = [];
  let cursor;
  do {
    const response = await notion.databases.query({
      database_id: EXPENSES_DB_ID,
      filter: {
        and: [
          { property: 'date', date: { on_or_after: start } },
          { property: 'date', date: { before: end } },
        ],
      },
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...(response?.results ?? []));
    cursor = response?.has_more ? (response?.next_cursor ?? null) : null;
  } while (cursor);
  return pages;
}

export async function getExpensesInRange(start, end) {
  const pages = await getExpensePagesInRange(start, end);
  const totals = {};
  for (const page of pages) {
    const category = page?.properties?.budget?.relation?.[0]?.id ?? 'unknown';
    const amount = page?.properties?.amount?.number ?? 0;
    totals[category] = (totals[category] ?? 0) + amount;
  }
  return totals;
}

function getMonthlyDateRange(now) {
  const [year, month] = formatAppDate(now).split('-').map(Number);
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const nextMonthYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextMonthStart = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { monthStart, nextMonthStart };
}

export async function getMonthlyExpenses({ now = new Date() } = {}) {
  const { monthStart, nextMonthStart } = getMonthlyDateRange(now);
  return getExpensesInRange(monthStart, nextMonthStart);
}

export async function getMonthlyExpenseDetails({ now = new Date() } = {}) {
  const { monthStart, nextMonthStart } = getMonthlyDateRange(now);
  const pages = await getExpensePagesInRange(monthStart, nextMonthStart);

  return pages.map((page) => ({
    id: page?.id ?? '',
    budgetId: page?.properties?.budget?.relation?.[0]?.id ?? 'unknown',
    description: page?.properties?.description?.title?.[0]?.plain_text ?? '',
    amount: page?.properties?.amount?.number ?? 0,
  }));
}

function readSettings(page) {
  return {
    id: page?.id ?? '',
    dailyTarget: page?.properties?.[SETTINGS_PROPERTIES.dailyTarget]?.number ?? null,
    attemptedWeeklyPeriod:
      page?.properties?.[SETTINGS_PROPERTIES.weeklyPeriod]?.rich_text?.[0]?.plain_text ?? '',
    attemptedMonthlyPeriod:
      page?.properties?.[SETTINGS_PROPERTIES.monthlyPeriod]?.rich_text?.[0]?.plain_text ?? '',
  };
}

export async function getSettings({
  initialWeeklyPeriodKey,
  initialMonthlyPeriodKey,
} = {}) {
  const response = await notion.databases.query({
    database_id: SETTINGS_DB_ID,
    page_size: 1,
  });
  const existingPage = response?.results?.[0];
  if (existingPage) {
    const settings = readSettings(existingPage);
    const properties = {};
    if (!settings.attemptedWeeklyPeriod.trim() && initialWeeklyPeriodKey) {
      properties[SETTINGS_PROPERTIES.weeklyPeriod] = {
        rich_text: [{ text: { content: initialWeeklyPeriodKey } }],
      };
      settings.attemptedWeeklyPeriod = initialWeeklyPeriodKey;
    }
    if (!settings.attemptedMonthlyPeriod.trim() && initialMonthlyPeriodKey) {
      properties[SETTINGS_PROPERTIES.monthlyPeriod] = {
        rich_text: [{ text: { content: initialMonthlyPeriodKey } }],
      };
      settings.attemptedMonthlyPeriod = initialMonthlyPeriodKey;
    }
    if (Object.keys(properties).length) {
      await notion.pages.update({ page_id: settings.id, properties });
    }
    return settings;
  }

  const page = await notion.pages.create({
    parent: { database_id: SETTINGS_DB_ID },
    properties: {
      Name: { title: [{ text: { content: SETTINGS_NAME } }] },
      [SETTINGS_PROPERTIES.weeklyPeriod]: {
        rich_text: [{ text: { content: initialWeeklyPeriodKey ?? '' } }],
      },
      [SETTINGS_PROPERTIES.monthlyPeriod]: {
        rich_text: [{ text: { content: initialMonthlyPeriodKey ?? '' } }],
      },
    },
  });
  return readSettings(page);
}

export async function setDailyTarget(dailyTarget, initialPeriodKeys) {
  const settings = await getSettings(initialPeriodKeys);
  await notion.pages.update({
    page_id: settings.id,
    properties: {
      [SETTINGS_PROPERTIES.dailyTarget]: { number: dailyTarget },
    },
  });
}

export async function claimSummaryPeriod(periodType, periodKey, initialPeriodKeys) {
  const settings = await getSettings(initialPeriodKeys);
  const isWeekly = periodType === 'weekly';
  const attemptedPeriod = isWeekly
    ? settings.attemptedWeeklyPeriod
    : settings.attemptedMonthlyPeriod;
  if (attemptedPeriod === periodKey) return false;

  const property = isWeekly
    ? SETTINGS_PROPERTIES.weeklyPeriod
    : SETTINGS_PROPERTIES.monthlyPeriod;
  await notion.pages.update({
    page_id: settings.id,
    properties: {
      [property]: { rich_text: [{ text: { content: periodKey } }] },
    },
  });
  return true;
}

export async function getTotalSpentInPeriod(periodStart) {
  const startStr = formatAppDate(periodStart);
  const response = await notion.databases.query({
    database_id: EXPENSES_DB_ID,
    filter: { property: 'date', date: { on_or_after: startStr } },
  });
  return response?.results?.reduce(
    (sum, page) => sum + (page?.properties?.amount?.number ?? 0),
    0,
  ) ?? 0;
}

export async function getTotalSpentToday({ now = new Date() } = {}) {
  const today = formatAppDate(now);
  const response = await notion.databases.query({
    database_id: EXPENSES_DB_ID,
    filter: { property: 'date', date: { equals: today } },
  });
  return response?.results?.reduce(
    (sum, page) => sum + (page?.properties?.amount?.number ?? 0),
    0,
  ) ?? 0;
}

export async function getCategoryExpenses(categoryId, periodStart) {
  const startStr = formatAppDate(periodStart);
  const response = await notion.databases.query({
    database_id: EXPENSES_DB_ID,
    filter: {
      and: [
        { property: 'date', date: { on_or_after: startStr } },
        { property: 'budget', relation: { contains: categoryId } },
      ],
    },
  });
  return response?.results?.map((page) => ({
    description: page?.properties?.description?.title?.[0]?.plain_text ?? '',
    amount: page?.properties?.amount?.number ?? 0,
  })) ?? [];
}

export async function createBudget(name, amount) {
  await notion.pages.create({
    parent: { database_id: BUDGETS_DB_ID },
    properties: {
      budget: { title: [{ text: { content: name } }] },
      amount: { number: amount },
    },
  });
}

export async function getLastExpense() {
  const response = await notion.databases.query({
    database_id: EXPENSES_DB_ID,
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    page_size: 1,
  });
  if (!response?.results?.length) return null;
  const page = response?.results?.[0];
  return {
    id: page?.id ?? '',
    description: page?.properties?.description?.title?.[0]?.plain_text ?? '',
    amount: page?.properties?.amount?.number ?? 0,
  };
}

export async function deleteExpense(pageId) {
  await notion.pages.update({ page_id: pageId, archived: true });
}

export async function createExpense({ description, amount, budgetId, now = new Date() }) {
  await notion.pages.create({
    parent: { database_id: EXPENSES_DB_ID },
    properties: {
      description: {
        title: [{ text: { content: description } }],
      },
      amount: {
        number: amount,
      },
      date: {
        date: { start: formatAppDate(now) },
      },
      budget: {
        relation: [{ id: budgetId }],
      },
    },
  });
}
