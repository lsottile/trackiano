import assert from 'node:assert/strict';
import test from 'node:test';

import { createPostgresRepository } from '../src/postgres.js';

const userId = '11111111-1111-1111-1111-111111111111';
const budgetId = '22222222-2222-2222-2222-222222222222';
const expenseId = '33333333-3333-3333-3333-333333333333';

function fakeDatabase(handler) {
  const calls = [];
  const database = {
    calls,
    async query(sql, params = []) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: normalized, params });
      if (normalized.includes('FROM users')) return { rows: [{ id: userId }], rowCount: 1 };
      return handler?.(normalized, params, calls) ?? { rows: [], rowCount: 0 };
    },
    async transaction(work) {
      calls.push({ sql: 'TRANSACTION', params: [] });
      return work(database);
    },
  };
  return database;
}

test('fails closed when the configured Telegram owner has no PostgreSQL user', async () => {
  const database = fakeDatabase();
  database.query = async () => ({ rows: [], rowCount: 0 });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  await assert.rejects(repository.getBudgets(), /No PostgreSQL user found for Telegram owner 42/);
});

test('returns only owner-scoped budgets and maps numeric money values', async () => {
  const database = fakeDatabase((sql) => {
    if (sql.includes('FROM budgets')) {
      return { rows: [{ id: budgetId, name: 'Food', amount: '10.50' }], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  assert.deepEqual(await repository.getBudgets(), [{ id: budgetId, name: 'Food', amount: 10.5 }]);
  const budgetQuery = database.calls.find(({ sql }) => sql.includes('FROM budgets'));
  assert.deepEqual(budgetQuery.params, [userId]);
  assert.match(budgetQuery.sql, /user_id = \$1/);
});

test('creates a cent-rounded expense on the app-local calendar date', async () => {
  const database = fakeDatabase((sql, params) => {
    if (sql.startsWith('INSERT INTO expenses')) {
      assert.deepEqual(params, [userId, budgetId, 'Coffee', 10.01, '2026-07-19']);
      return { rows: [{ id: expenseId }], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, {
    telegramUserId: 42,
    timeZone: 'America/Guatemala',
  });

  assert.equal(await repository.createExpense({
    description: 'Coffee',
    amount: 10.005,
    budgetId,
    now: new Date('2026-07-20T05:30:00.000Z'),
  }), expenseId);
});

test('changes or soft-deletes only the owners exact expense', async () => {
  const database = fakeDatabase((sql) => {
    if (sql.startsWith('UPDATE expenses')) return { rows: [], rowCount: 1 };
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  await repository.updateExpenseBudget(expenseId, budgetId);
  await repository.deleteExpense(expenseId);

  const updates = database.calls.filter(({ sql }) => sql.startsWith('UPDATE expenses'));
  assert.match(updates[0].sql, /WHERE id = \$1 AND user_id = \$3/);
  assert.deepEqual(updates[0].params, [expenseId, budgetId, userId]);
  assert.match(updates[1].sql, /deleted_at IS NULL/);
  assert.deepEqual(updates[1].params, [expenseId, userId]);
});

test('claims a summary period only when the conditional update returns a row', async () => {
  let claimAttempts = 0;
  const database = fakeDatabase((sql) => {
    if (sql.startsWith('INSERT INTO user_settings')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('UPDATE user_settings') && sql.includes('btrim')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith('SELECT user_id')) {
      return {
        rows: [{
          user_id: userId,
          daily_target: '70.00',
          attempted_weekly_period: '2026-07-20/2026-07-27',
          attempted_monthly_period: '2026-06',
        }],
        rowCount: 1,
      };
    }
    if (sql.startsWith('UPDATE user_settings') && sql.includes('RETURNING')) {
      claimAttempts += 1;
      return { rows: claimAttempts === 1 ? [{ user_id: userId }] : [], rowCount: claimAttempts === 1 ? 1 : 0 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });
  const keys = {
    initialWeeklyPeriodKey: '2026-07-20/2026-07-27',
    initialMonthlyPeriodKey: '2026-06',
  };

  assert.equal(await repository.claimSummaryPeriod('weekly', '2026-07-27/2026-08-03', keys), true);
  assert.equal(await repository.claimSummaryPeriod('weekly', '2026-07-27/2026-08-03', keys), false);
});

test('groups active expenses by budget in a half-open date range', async () => {
  const database = fakeDatabase((sql) => {
    if (sql.includes('GROUP BY budget_id')) {
      assert.match(sql, /expense_date >= \$2 AND expense_date < \$3/);
      assert.match(sql, /deleted_at IS NULL/);
      return { rows: [{ budget_id: budgetId, total: '20.27' }], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  assert.deepEqual(
    await repository.getExpensesInRange('2026-07-01', '2026-08-01'),
    { [budgetId]: 20.27 },
  );
});
