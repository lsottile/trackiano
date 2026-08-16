import { createDefaultPostgresRepository } from './postgres.js';

const STORAGE_METHODS = [
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
  'findLearnedBudget',
  'recategorizeExpenseAndLearn',
];

export function createStorage({ postgresRepository } = {}) {
  const repository = postgresRepository ?? createDefaultPostgresRepository();

  return Object.fromEntries(STORAGE_METHODS.map((method) => [
    method,
    (...args) => repository[method](...args),
  ]));
}

let applicationStorage;
function callApplicationStorage(method, args) {
  applicationStorage ??= createStorage();
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
export const createExpenseAndGetTotalToday = (...args) => callApplicationStorage('createExpenseAndGetTotalToday', args);
export const getCategoryExpenses = (...args) => callApplicationStorage('getCategoryExpenses', args);
export const createBudget = (...args) => callApplicationStorage('createBudget', args);
export const getLastExpense = (...args) => callApplicationStorage('getLastExpense', args);
export const deleteExpense = (...args) => callApplicationStorage('deleteExpense', args);
export const updateExpenseBudget = (...args) => callApplicationStorage('updateExpenseBudget', args);
export const createExpense = (...args) => callApplicationStorage('createExpense', args);
export const findLearnedBudget = (...args) => callApplicationStorage('findLearnedBudget', args);
export const recategorizeExpenseAndLearn = (...args) => callApplicationStorage('recategorizeExpenseAndLearn', args);
