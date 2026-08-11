import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateNotionData, summarizeData } from '../src/data-migration.js';

const sourceData = {
  budgets: [{
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Food',
    amount: 100.01,
  }],
  expenses: [{
    id: '22222222-2222-2222-2222-222222222222',
    budgetId: '11111111-1111-1111-1111-111111111111',
    description: 'Coffee',
    amount: 10.01,
    date: '2026-08-10',
  }],
  settings: {
    dailyTarget: 70,
    attemptedWeeklyPeriod: 'week-1',
    attemptedMonthlyPeriod: 'month-1',
  },
};

function migrationTarget({
  mismatch = false,
  failExpense = false,
  initialData = { budgets: [], expenses: [], settings: null },
} = {}) {
  const state = { data: structuredClone(initialData), writes: [] };
  return {
    state,
    async snapshot() {
      if (!mismatch || !state.data.expenses.length) return structuredClone(state.data);
      return { ...structuredClone(state.data), expenses: state.data.expenses.map((expense) => ({
        ...expense, description: 'corrupted',
      })) };
    },
    async transaction(work) {
      const before = structuredClone(state.data);
      try {
        return await work(this);
      } catch (error) {
        state.data = before;
        throw error;
      }
    },
    async upsertUser(telegramUserId) {
      state.writes.push(`user:${telegramUserId}`);
      return 'user-1';
    },
    async upsertBudget(userId, budget) {
      assert.equal(userId, 'user-1'); state.writes.push(`budget:${budget.id}`);
      state.data.budgets = [structuredClone(budget)];
    },
    async upsertExpense(userId, expense) {
      assert.equal(userId, 'user-1'); state.writes.push(`expense:${expense.id}`);
      if (failExpense) throw new Error('expense failed');
      state.data.expenses = [structuredClone(expense)];
    },
    async upsertSettings(userId, settings) {
      assert.equal(userId, 'user-1'); state.writes.push('settings');
      state.data.settings = structuredClone(settings);
    },
  };
}

test('summarizes financial records in integer cents', () => {
  assert.deepEqual(summarizeData(sourceData), {
    budgetCount: 1,
    budgetTotalCents: 10001,
    expenseCount: 1,
    expenseTotalCents: 1001,
    settings: sourceData.settings,
  });
});

test('dry-run performs no writes', async () => {
  const target = migrationTarget();

  const result = await migrateNotionData({
    sourceData,
    target,
    telegramUserId: 42,
  });

  assert.equal(result.mode, 'dry-run');
  assert.deepEqual(target.state.writes, []);
  assert.deepEqual(result.source, summarizeData(sourceData));
});

test('apply imports transactionally and is idempotent on retry', async () => {
  const target = migrationTarget();

  const first = await migrateNotionData({
    sourceData,
    target,
    telegramUserId: 42,
    apply: true,
  });
  const writesAfterFirstApply = target.state.writes.length;
  const second = await migrateNotionData({
    sourceData,
    target,
    telegramUserId: 42,
    apply: true,
  });

  assert.equal(first.mode, 'apply');
  assert.equal(second.matches, true);
  assert.equal(target.state.writes.length, writesAfterFirstApply);
  assert.equal(target.state.data.budgets.length, 1);
  assert.equal(target.state.data.expenses.length, 1);
});

test('refuses equal aggregates with divergent record identities or fields', async () => {
  const target = migrationTarget({
    initialData: {
      budgets: [{ ...sourceData.budgets[0], id: 'budget-other', name: 'Other' }],
      expenses: [{
        ...sourceData.expenses[0],
        id: 'expense-other',
        budgetId: 'budget-other',
        description: 'Tea',
        date: '2026-08-11',
      }],
      settings: sourceData.settings,
    },
  });

  const dryRun = await migrateNotionData({ sourceData, target, telegramUserId: 42 });
  assert.equal(dryRun.matches, false);
  await assert.rejects(migrateNotionData({
    sourceData, target, telegramUserId: 42, apply: true,
  }), /Target contains divergent data; refusing to overwrite: budgets, expenses/);
  assert.deepEqual(target.state.writes, []);
});

test('reconciles every non-aggregate budget and expense field', async () => {
  const variants = [
    { budgets: [{ ...sourceData.budgets[0], id: 'other' }] },
    { budgets: [{ ...sourceData.budgets[0], name: 'Other' }] },
    { expenses: [{ ...sourceData.expenses[0], id: 'other' }] },
    { expenses: [{ ...sourceData.expenses[0], budgetId: 'other' }] },
    { expenses: [{ ...sourceData.expenses[0], description: 'Tea' }] },
    { expenses: [{ ...sourceData.expenses[0], date: '2026-08-11' }] },
  ];
  for (const variant of variants) {
    const target = migrationTarget({ initialData: { ...structuredClone(sourceData), ...variant } });
    assert.equal((await migrateNotionData({ sourceData, target, telegramUserId: 42 })).matches, false);
  }
});

test('recognizes a canonically equal import regardless of record order', async () => {
  const secondBudget = { id: 'budget-2', name: 'Travel', amount: 25 };
  const data = { ...sourceData, budgets: [...sourceData.budgets, secondBudget] };
  const target = migrationTarget({
    initialData: { ...structuredClone(data), budgets: [secondBudget, ...sourceData.budgets] },
  });

  const result = await migrateNotionData({
    sourceData: data, target, telegramUserId: 42, apply: true,
  });
  assert.equal(result.alreadyImported, true);
  assert.deepEqual(target.state.writes, []);
});

test('rolls back every imported record when a write fails', async () => {
  const target = migrationTarget({ failExpense: true });

  await assert.rejects(migrateNotionData({
    sourceData,
    target,
    telegramUserId: 42,
    apply: true,
  }), /expense failed/);

  assert.deepEqual(target.state.data, { budgets: [], expenses: [], settings: null });
});

test('fails and rolls back when reconciliation does not match', async () => {
  const target = migrationTarget({ mismatch: true });

  await assert.rejects(migrateNotionData({
    sourceData,
    target,
    telegramUserId: 42,
    apply: true,
  }), /Migration reconciliation failed: expenses/);

  assert.deepEqual(target.state.data, { budgets: [], expenses: [], settings: null });
});
