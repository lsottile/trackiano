import { roundMoney } from './money.js';

export function normalizeNotionUuid(value) {
  const compact = value?.replaceAll('-', '') ?? '';
  if (!/^[0-9a-fA-F]{32}$/.test(compact)) {
    throw new Error(`Invalid Notion UUID: ${value}`);
  }
  const hex = compact.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readMoney(value, context) {
  if (!Number.isFinite(value)) throw new Error(`Invalid money for ${context}`);
  return roundMoney(value);
}

function readDate(value, context) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) {
    throw new Error(`Invalid date for ${context}: ${value}`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid date for ${context}: ${value}`);
  }
  return value;
}

async function queryAll(client, databaseId) {
  const pages = [];
  let cursor;
  do {
    const response = await client.databases.query({
      database_id: databaseId,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...(response?.results ?? []));
    cursor = response?.has_more ? response?.next_cursor : null;
    if (response?.has_more && !cursor) {
      throw new Error(`Notion pagination for ${databaseId} has no next cursor.`);
    }
  } while (cursor);
  return pages;
}

function readBudget(page) {
  const id = normalizeNotionUuid(page?.id);
  const name = page?.properties?.budget?.title?.[0]?.plain_text?.trim() ?? '';
  if (!name) throw new Error(`Budget ${id} has no name.`);
  return {
    id,
    name,
    amount: readMoney(page?.properties?.amount?.number, `budget ${id}`),
  };
}

function readExpense(page) {
  const id = normalizeNotionUuid(page?.id);
  const description = page?.properties?.description?.title?.[0]?.plain_text?.trim() ?? '';
  if (!description) throw new Error(`Expense ${id} has no description.`);
  const relation = page?.properties?.budget?.relation ?? [];
  if (relation.length !== 1) throw new Error(`Expense ${id} must have one budget relation.`);
  return {
    id,
    budgetId: normalizeNotionUuid(relation[0]?.id),
    description,
    amount: readMoney(page?.properties?.amount?.number, `expense ${id}`),
    date: readDate(page?.properties?.date?.date?.start, `expense ${id}`),
  };
}

function readSettings(pages) {
  if (pages.length > 1) throw new Error('Notion settings must contain at most one row.');
  const page = pages[0];
  if (!page) {
    return {
      dailyTarget: null,
      attemptedWeeklyPeriod: '',
      attemptedMonthlyPeriod: '',
    };
  }
  const rawTarget = page?.properties?.['Daily target']?.number;
  return {
    dailyTarget: rawTarget === null || rawTarget === undefined
      ? null
      : readMoney(rawTarget, 'settings daily target'),
    attemptedWeeklyPeriod:
      page?.properties?.['Attempted weekly period']?.rich_text?.[0]?.plain_text ?? '',
    attemptedMonthlyPeriod:
      page?.properties?.['Attempted monthly period']?.rich_text?.[0]?.plain_text ?? '',
  };
}

export async function exportNotionData(client, {
  budgetsDatabaseId,
  expensesDatabaseId,
  settingsDatabaseId,
}) {
  const [budgetPages, expensePages, settingsPages] = await Promise.all([
    queryAll(client, budgetsDatabaseId),
    queryAll(client, expensesDatabaseId),
    queryAll(client, settingsDatabaseId),
  ]);
  const budgets = budgetPages.map(readBudget);
  const names = new Set();
  for (const budget of budgets) {
    const normalized = budget.name.toLocaleLowerCase('en');
    if (names.has(normalized)) throw new Error(`Duplicate budget name: ${budget.name}`);
    names.add(normalized);
  }
  const budgetIds = new Set(budgets.map(({ id }) => id));
  const expenses = expensePages.map(readExpense);
  for (const expense of expenses) {
    if (!budgetIds.has(expense.budgetId)) {
      throw new Error(`Expense ${expense.id} references unknown budget ${expense.budgetId}`);
    }
  }

  return { budgets, expenses, settings: readSettings(settingsPages) };
}
