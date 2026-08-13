import * as notionRepository from './notion.js';
import { createDefaultPostgresRepository } from './postgres.js';

const BASE_METHODS = [
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
  'getCategoryExpenses',
  'createBudget',
  'getLastExpense',
  'deleteExpense',
  'updateExpenseBudget',
  'createExpense',
];

const POSTGRES_FEATURE_METHODS = [
  'createFinancialEntryAndGetBalances',
  'findLearnedBudget',
  'recategorizeExpenseAndLearn',
  'startAccountingPeriod',
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
  const methods = backend === 'postgres'
    ? [...BASE_METHODS, ...POSTGRES_FEATURE_METHODS]
    : BASE_METHODS;

  return Object.fromEntries(methods.map((method) => [
    method,
    (...args) => repository[method](...args),
  ]));
}

let applicationStorage;
function callApplicationStorage(method, args) {
  applicationStorage ??= createStorage({
    backend: 'postgres',
    postgresRepository: createDefaultPostgresRepository(),
  });
  return applicationStorage[method](...args);
}

export const findBudgetId = (...args) => callApplicationStorage('findBudgetId', args);
export const getBudgets = (...args) => callApplicationStorage('getBudgets', args);
export const getPeriodSpent = (...args) => callApplicationStorage('getPeriodSpent', args);
export const getExpensesInRange = (...args) => callApplicationStorage('getExpensesInRange', args);
export const getMonthlyExpenses = (...args) => callApplicationStorage('getMonthlyExpenses', args);
export const getMonthlyExpenseDetails = (...args) => callApplicationStorage('getMonthlyExpenseDetails', args);
export const getSettings = (...args) => callApplicationStorage('getSettings', args);
export const setDailyTarget = (...args) => callApplicationStorage('setDailyTarget', args);
export const claimSummaryPeriod = (...args) => callApplicationStorage('claimSummaryPeriod', args);
export const getTotalSpentInPeriod = (...args) => callApplicationStorage('getTotalSpentInPeriod', args);
export const getTotalSpentToday = (...args) => callApplicationStorage('getTotalSpentToday', args);
export const createFinancialEntryAndGetBalances = (...args) => callApplicationStorage('createFinancialEntryAndGetBalances', args);
export const startAccountingPeriod = (...args) => callApplicationStorage('startAccountingPeriod', args);
export const getCategoryExpenses = (...args) => callApplicationStorage('getCategoryExpenses', args);
export const createBudget = (...args) => callApplicationStorage('createBudget', args);
export const getLastExpense = (...args) => callApplicationStorage('getLastExpense', args);
export const deleteExpense = (...args) => callApplicationStorage('deleteExpense', args);
export const updateExpenseBudget = (...args) => callApplicationStorage('updateExpenseBudget', args);
export const createExpense = (...args) => callApplicationStorage('createExpense', args);
export const findLearnedBudget = (...args) => callApplicationStorage('findLearnedBudget', args);
export const recategorizeExpenseAndLearn = (...args) => callApplicationStorage('recategorizeExpenseAndLearn', args);
