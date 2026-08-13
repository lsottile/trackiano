import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabase } from '../src/db.js';
import {
  createPostgresRepository,
  derivePaydayExpenseId,
} from '../src/postgres.js';

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
      assert.deepEqual(params, [
        userId, budgetId, 'Coffee', 10.01, '2026-07-19', 'expense',
      ]);
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

test('derives stable, distinct, owner-scoped valid UUIDs for payday income', () => {
  const first = derivePaydayExpenseId(userId, 'telegram-update:987');
  assert.equal(first, derivePaydayExpenseId(userId, 'telegram-update:987'));
  assert.notEqual(first, derivePaydayExpenseId(userId, 'telegram-update:988'));
  assert.notEqual(first, derivePaydayExpenseId('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'telegram-update:987'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('locks the owner, obtains one database timestamp, and separates calendar-date monthly balance from timestamp pay balance', async () => {
  const occurredAt = new Date('2026-08-02T05:30:00.000Z');
  const database = fakeDatabase((sql, params) => {
    if (sql.startsWith('SELECT clock_timestamp()')) {
      return { rows: [{ occurred_at: occurredAt }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO expenses')) {
      assert.doesNotMatch(sql, /accounting_period_id/);
      assert.deepEqual(params, [
        userId, null, 'Opening balance', 100.01, '2026-08-01', 'income',
        occurredAt, occurredAt,
      ]);
      return { rows: [{ id: expenseId }], rowCount: 1 };
    }
    if (sql.includes('AS daily_balance')) {
      assert.match(sql, /ORDER BY started_at DESC, id DESC/);
      assert.match(sql, /e\.expense_date >= \$5::date AND e\.expense_date <= \$2::date/);
      assert.doesNotMatch(sql, /FILTER \(WHERE e\.created_at[^)]*\), 0\) AS monthly_balance/);
      assert.match(sql, /pay_balance/);
      assert.match(sql, /e\.created_at >= COALESCE\(p\.started_at, b\.month_start\)/);
      assert.match(sql, /date_trunc\('month', \$3 AT TIME ZONE \$4\)[\s\S]*AT TIME ZONE \$4/);
      assert.match(sql, /e\.deleted_at IS NULL/);
      assert.deepEqual(params, [
        userId, '2026-08-01', occurredAt, 'America/Guatemala', '2026-08-01',
      ]);
      return { rows: [{ daily_balance: '90.00', monthly_balance: '70.00', pay_balance: '80.00' }] };
    }
  });
  const repository = createPostgresRepository(database, {
    telegramUserId: 42, timeZone: 'America/Guatemala',
  });

  assert.deepEqual(await repository.createFinancialEntryAndGetBalances({
    description: 'Opening balance', amount: 100.005, budgetId: null, type: 'income',
  }), { expenseId, dailyBalance: 90, monthlyBalance: 70, payBalance: 80 });
  const transactionCalls = database.calls.slice(
    database.calls.findIndex(({ sql }) => sql === 'TRANSACTION') + 1,
  );
  assert.equal(transactionCalls[0].sql, "SET LOCAL statement_timeout = '5s'");
  assert.equal(transactionCalls[1].sql, "SET LOCAL lock_timeout = '1s'");
  assert.match(transactionCalls[2].sql, /pg_advisory_xact_lock/);
  assert.match(transactionCalls[3].sql, /^SELECT clock_timestamp\(\)/);
  assert.match(transactionCalls[4].sql, /^INSERT INTO expenses/);
  assert.equal(transactionCalls.filter(({ sql }) => sql.includes('clock_timestamp')).length, 1);
});

test('payday writes period then deterministic income at the same timestamp and is retry-safe', async () => {
  const startedAt = new Date('2026-08-08T14:30:00.000Z');
  const periodId = '44444444-4444-4444-4444-444444444444';
  const deterministicId = derivePaydayExpenseId(userId, 'telegram-update:987');
  const database = fakeDatabase((sql, params) => {
    if (sql.startsWith('SELECT clock_timestamp()')) return { rows: [{ occurred_at: startedAt }], rowCount: 1 };
    if (sql.startsWith('INSERT INTO accounting_periods')) {
      assert.deepEqual(params, [userId, 'telegram-update:987', startedAt]);
      return { rows: [{ id: periodId, started_at: startedAt }], rowCount: 1 };
    }
    if (sql.startsWith('INSERT INTO expenses')) {
      assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/);
      assert.deepEqual(params, [deterministicId, userId, 'Salary', 100, '2026-08-08', startedAt, startedAt]);
      return { rows: [{ id: deterministicId }], rowCount: 1 };
    }
    if (sql.startsWith('SELECT id FROM expenses')) {
      return { rows: [{ id: deterministicId }], rowCount: 1 };
    }
    if (sql.includes('AS daily_balance')) {
      return { rows: [{ daily_balance: '100', monthly_balance: '100', pay_balance: '100' }] };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  const result = await repository.createPaydayAndGetBalances({
    requestKey: 'telegram-update:987', amount: 100, description: 'Salary',
  });
  assert.equal(result.expenseId, deterministicId);

  const transactionCalls = database.calls.slice(database.calls.findIndex(({ sql }) => sql === 'TRANSACTION') + 1);
  assert.equal(transactionCalls[0].sql, "SET LOCAL statement_timeout = '5s'");
  assert.equal(transactionCalls[1].sql, "SET LOCAL lock_timeout = '1s'");
  assert.match(transactionCalls[2].sql, /pg_advisory_xact_lock/);
  assert.match(transactionCalls[3].sql, /^SELECT clock_timestamp\(\)/);
  assert.match(transactionCalls[4].sql, /^INSERT INTO accounting_periods/);
  assert.match(transactionCalls[5].sql, /^INSERT INTO expenses/);
  assert.equal(transactionCalls.filter(({ sql }) => sql.includes('clock_timestamp')).length, 1);
});

test('payday validates amount and description before storage', async () => {
  const database = fakeDatabase();
  const repository = createPostgresRepository(database, { telegramUserId: 42 });
  for (const input of [
    { requestKey: 'telegram-update:1', amount: 0, description: 'Salary' },
    { requestKey: 'telegram-update:1', amount: 1, description: '   ' },
  ]) await assert.rejects(repository.createPaydayAndGetBalances(input));
  assert.equal(database.calls.length, 0);
});

test('financial lock errors propagate and roll back without retries', async () => {
  for (const method of ['entry', 'payday']) {
    const events = [];
    const lockError = new Error(`${method} lock failed`);
    const client = {
      async query(sql) {
        events.push(sql);
        if (sql.includes('pg_advisory_xact_lock')) throw lockError;
        return { rows: [], rowCount: 0 };
      },
      release() { events.push('release'); },
    };
    const pool = {
      on() {},
      async query() { return { rows: [{ id: userId }], rowCount: 1 }; },
      async connect() { events.push('connect'); return client; },
    };
    const repository = createPostgresRepository(createDatabase({ pool }), { telegramUserId: 42 });
    const operation = method === 'entry'
      ? repository.createFinancialEntryAndGetBalances({
        description: 'Coffee', amount: 5, budgetId,
      })
      : repository.createPaydayAndGetBalances({
        requestKey: 'telegram-update:987', amount: 100, description: 'Salary',
      });

    await assert.rejects(operation, (error) => error === lockError);
    assert.deepEqual(events, [
      'connect',
      'BEGIN',
      "SET LOCAL statement_timeout = '5s'",
      "SET LOCAL lock_timeout = '1s'",
      'SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      'ROLLBACK',
      'release',
    ]);
  }
});

test('payday retry uses only its deterministic expense identity and never guesses by timestamp', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(
    new URL('../src/postgres.js', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /ordinal|accounting_period_id|income_expense_id/);
  assert.doesNotMatch(source, /created_at = \$2[\s\S]*entry_type = 'income'/);
  assert.match(source, /WHERE id = \$1 AND user_id = \$2/);
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

test('finds a learned budget with strict fingerprint and owner-scoped same-user join', async () => {
  const fingerprint = 'a'.repeat(64);
  const database = fakeDatabase((sql, params) => {
    if (sql.includes('FROM category_inference_rules')) {
      assert.match(sql, /b\.user_id = r\.user_id/);
      assert.match(sql, /r\.user_id = \$1/);
      assert.match(sql, /decode\(\$2, 'hex'\)/);
      assert.deepEqual(params, [userId, fingerprint]);
      return { rows: [{ id: budgetId, name: 'Food' }], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  assert.deepEqual(await repository.findLearnedBudget(fingerprint), { id: budgetId, name: 'Food' });
});

test('rejects invalid fingerprints before any database query and returns null on learned miss', async () => {
  const database = fakeDatabase();
  const repository = createPostgresRepository(database, { telegramUserId: 42 });
  for (const fingerprint of ['', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
    await assert.rejects(repository.findLearnedBudget(fingerprint), /64 lowercase hexadecimal/);
  }
  assert.equal(database.calls.length, 0);
  assert.equal(await repository.findLearnedBudget('b'.repeat(64)), null);
});

test('recategorizes and learns from the persisted description in one ordered transaction', async () => {
  const database = fakeDatabase((sql) => {
    if (sql.startsWith('SELECT e.description')) return { rows: [{ description: '  Coffee\tShop ' }], rowCount: 1 };
    if (sql.startsWith('UPDATE expenses')) return { rows: [], rowCount: 1 };
    if (sql.startsWith('INSERT INTO category_inference_rules')) return { rows: [], rowCount: 1 };
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  await repository.recategorizeExpenseAndLearn(expenseId, budgetId);
  const transactionIndex = database.calls.findIndex(({ sql }) => sql === 'TRANSACTION');
  const transactionCalls = database.calls.slice(transactionIndex + 1);
  assert.equal(transactionCalls[0].sql, "SET LOCAL statement_timeout = '5s'");
  assert.equal(transactionCalls[1].sql, "SET LOCAL lock_timeout = '1s'");
  assert.match(transactionCalls[2].sql, /JOIN budgets AS b/);
  assert.match(transactionCalls[2].sql, /e\.user_id = \$3/);
  assert.match(transactionCalls[2].sql, /FOR UPDATE OF e FOR KEY SHARE OF b/);
  assert.deepEqual(transactionCalls[2].params, [expenseId, budgetId, userId]);
  assert.match(transactionCalls[3].sql, /user_id = \$3 AND deleted_at IS NULL/);
  assert.deepEqual(transactionCalls[3].params, [expenseId, budgetId, userId]);
  assert.match(transactionCalls[4].sql, /ON CONFLICT \(user_id, description_fingerprint\)/);
  assert.match(transactionCalls[4].sql, /updated_at = now\(\)/);
  assert.deepEqual(transactionCalls[4].params, [userId, 'c798e5b18ed876efb8a937d27a0c48de53e3735e490e2116701901e369d8b7d9', budgetId]);
});

test('timeout setup failure rolls back and releases before any row lock', async () => {
  const events = [];
  const client = {
    async query(sql) {
      events.push(sql);
      if (sql.startsWith('SET LOCAL statement_timeout')) throw new Error('setup failed');
      return { rows: [], rowCount: 0 };
    },
    release() { events.push('release'); },
  };
  const pool = {
    on() {},
    async query() { return { rows: [{ id: userId }], rowCount: 1 }; },
    async connect() { events.push('connect'); return client; },
  };
  const database = createDatabase({ pool });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  await assert.rejects(repository.recategorizeExpenseAndLearn(expenseId, budgetId), /setup failed/);
  assert.deepEqual(events, [
    'connect', 'BEGIN', "SET LOCAL statement_timeout = '5s'", 'ROLLBACK', 'release',
  ]);
});

test('recategorization fails before writes for missing resources or empty persisted descriptions', async () => {
  for (const rows of [[], [{ description: '   ' }]]) {
    const database = fakeDatabase((sql) => {
      if (sql.startsWith('SELECT e.description')) return { rows, rowCount: rows.length };
      assert.fail(`unexpected write: ${sql}`);
    });
    const repository = createPostgresRepository(database, { telegramUserId: 42 });
    await assert.rejects(repository.recategorizeExpenseAndLearn(expenseId, budgetId));
    assert.equal(database.calls.some(({ sql }) => sql.startsWith('UPDATE expenses')), false);
    assert.equal(database.calls.some(({ sql }) => sql.startsWith('INSERT INTO category_inference_rules')), false);
  }
});

test('recategorization propagates update and upsert failures through the transaction', async () => {
  for (const failAt of ['update', 'upsert']) {
    const database = fakeDatabase((sql) => {
      if (sql.startsWith('SELECT e.description')) return { rows: [{ description: 'Coffee' }], rowCount: 1 };
      if (sql.startsWith('UPDATE expenses')) {
        if (failAt === 'update') return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO category_inference_rules')) throw new Error('upsert failed');
    });
    const repository = createPostgresRepository(database, { telegramUserId: 42 });
    await assert.rejects(repository.recategorizeExpenseAndLearn(expenseId, budgetId));
    if (failAt === 'update') {
      assert.equal(database.calls.some(({ sql }) => sql.startsWith('INSERT INTO category_inference_rules')), false);
    }
  }
});

test('all spending queries explicitly exclude income', async () => {
  const database = fakeDatabase((sql) => {
    if (sql.includes('FROM expenses')) return { rows: [], rowCount: 0 };
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });
  await repository.getPeriodSpent(budgetId, new Date());
  await repository.getExpensesInRange('2026-07-01', '2026-08-01');
  await repository.getMonthlyExpenseDetails();
  await repository.getTotalSpentInPeriod(new Date());
  await repository.getCategoryExpenses(budgetId, new Date());
  await repository.getLastExpense();
  const spendingQueries = database.calls.filter(({ sql }) => sql.includes('FROM expenses'));
  assert.ok(spendingQueries.length >= 6);
  assert.ok(spendingQueries.every(({ sql }) => sql.includes("entry_type = 'expense'")));
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
