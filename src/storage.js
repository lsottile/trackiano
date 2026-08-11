import * as notionRepository from './notion.js';
import { createDefaultPostgresRepository } from './postgres.js';

const METHODS = [
  'findBudgetId',
  'getBudgets',
  'getPeriodSpent',
  'getExpensesInRange',
  'getMonthlyExpenses',
  'getMonthlyExpenseDetails',
  'getSettings',
  'setDailyTarget',
  'claimSummaryPeriod',
  'getTotalSpentInPeriod',
  'getTotalSpentToday',
  'createExpenseAndGetTotalToday',
  'getCategoryExpenses',
  'createBudget',
  'getLastExpense',
  'deleteExpense',
  'updateExpenseBudget',
  'createExpense',
];

export function createStorage({
  backend = 'notion',
  notionRepository: notion = notionRepository,
  postgresRepository,
} = {}) {
  if (!['notion', 'postgres'].includes(backend)) {
    throw new Error(`Unknown STORAGE_BACKEND: ${backend}`);
  }
  const repository = backend === 'notion'
    ? notion
    : (postgresRepository ?? createDefaultPostgresRepository());

  return Object.fromEntries(METHODS.map((method) => [
    method,
    (...args) => repository[method](...args),
  ]));
}

const storage = createStorage({ backend: process.env.STORAGE_BACKEND ?? 'notion' });

export const findBudgetId = storage.findBudgetId;
export const getBudgets = storage.getBudgets;
export const getPeriodSpent = storage.getPeriodSpent;
export const getExpensesInRange = storage.getExpensesInRange;
export const getMonthlyExpenses = storage.getMonthlyExpenses;
export const getMonthlyExpenseDetails = storage.getMonthlyExpenseDetails;
export const getSettings = storage.getSettings;
export const setDailyTarget = storage.setDailyTarget;
export const claimSummaryPeriod = storage.claimSummaryPeriod;
export const getTotalSpentInPeriod = storage.getTotalSpentInPeriod;
export const getTotalSpentToday = storage.getTotalSpentToday;
export const createExpenseAndGetTotalToday = storage.createExpenseAndGetTotalToday;
export const getCategoryExpenses = storage.getCategoryExpenses;
export const createBudget = storage.createBudget;
export const getLastExpense = storage.getLastExpense;
export const deleteExpense = storage.deleteExpense;
export const updateExpenseBudget = storage.updateExpenseBudget;
export const createExpense = storage.createExpense;
