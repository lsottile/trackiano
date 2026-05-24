import { Client } from '@notionhq/client';
import 'dotenv/config';

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const EXPENSES_DB_ID = process.env.NOTION_EXPENSES_DB_ID;
const BUDGETS_DB_ID = process.env.NOTION_BUDGETS_DB_ID;

export async function findBudgetId(categoryName) {
  const response = await notion.databases.query({ database_id: BUDGETS_DB_ID });
  const match = response.results.find((page) => {
    const title = page.properties.budget?.title?.[0]?.plain_text ?? '';
    return title.toLowerCase() === categoryName.toLowerCase();
  });
  return match?.id ?? null;
}

export async function getBudgets() {
  const response = await notion.databases.query({ database_id: BUDGETS_DB_ID });
  return response.results.map((page) => ({
    id: page.id,
    name: page.properties.budget?.title?.[0]?.plain_text ?? '',
    amount: page.properties.amount?.number ?? 0,
  }));
}

export async function getPeriodSpent(categoryId, periodStart) {
  const expenses = await getCategoryExpenses(categoryId, periodStart);
  return expenses.reduce((sum, e) => sum + e.amount, 0);
}

export async function getMonthlyExpenses() {
  const start = new Date();
  start.setDate(1);
  const startStr = start.toISOString().split('T')[0];

  const response = await notion.databases.query({
    database_id: EXPENSES_DB_ID,
    filter: {
      property: 'date',
      date: { on_or_after: startStr },
    },
  });

  const totals = {};
  for (const page of response.results) {
    const category = page.properties.budget?.relation?.[0]?.id ?? 'unknown';
    const amount = page.properties.amount?.number ?? 0;
    totals[category] = (totals[category] ?? 0) + amount;
  }
  return totals;
}

export async function getMonthlyExpensesWithDetails() {
  const start = new Date();
  start.setDate(1);
  const startStr = start.toISOString().split('T')[0];

  const response = await notion.databases.query({
    database_id: EXPENSES_DB_ID,
    filter: {
      property: 'date',
      date: { on_or_after: startStr },
    },
  });

  return response.results.map((page) => ({
    description: page.properties.description?.title?.[0]?.plain_text ?? '',
    amount: page.properties.amount?.number ?? 0,
    categoryId: page.properties.budget?.relation?.[0]?.id ?? 'unknown',
  }));
}

export async function getTotalSpentInPeriod(periodStart) {
  const startStr = periodStart.toISOString().split('T')[0];
  const response = await notion.databases.query({
    database_id: EXPENSES_DB_ID,
    filter: { property: 'date', date: { on_or_after: startStr } },
  });
  return response.results.reduce((sum, page) => sum + (page.properties.amount?.number ?? 0), 0);
}

export async function getTotalSpentToday() {
  const today = new Date().toISOString().split('T')[0];
  const response = await notion.databases.query({
    database_id: EXPENSES_DB_ID,
    filter: { property: 'date', date: { equals: today } },
  });
  return response.results.reduce((sum, page) => sum + (page.properties.amount?.number ?? 0), 0);
}

export async function getCategoryExpenses(categoryId, periodStart) {
  const startStr = periodStart.toISOString().split('T')[0];
  const response = await notion.databases.query({
    database_id: EXPENSES_DB_ID,
    filter: {
      and: [
        { property: 'date', date: { on_or_after: startStr } },
        { property: 'budget', relation: { contains: categoryId } },
      ],
    },
  });
  return response.results.map((page) => ({
    description: page.properties.description?.title?.[0]?.plain_text ?? '',
    amount: page.properties.amount?.number ?? 0,
  }));
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
  if (!response.results.length) return null;
  const page = response.results[0];
  return {
    id: page.id,
    description: page.properties.description?.title?.[0]?.plain_text ?? '',
    amount: page.properties.amount?.number ?? 0,
  };
}

export async function deleteExpense(pageId) {
  await notion.pages.update({ page_id: pageId, archived: true });
}

export async function createExpense({ description, amount, budgetId }) {
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
        date: { start: new Date().toISOString().split('T')[0] },
      },
      budget: {
        relation: [{ id: budgetId }],
      },
    },
  });
}
