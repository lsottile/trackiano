import assert from 'node:assert/strict';
import test from 'node:test';

import { createDatabase } from '../src/db.js';
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
      assert.deepEqual(params, [userId, budgetId, 'Coffee', 10.01, '2026-07-19', null]);
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

test('finds the owner-scoped active merchant mapping or returns null on miss', async () => {
  const database = fakeDatabase((sql, params) => {
    if (sql.includes('FROM merchant_mappings')) {
      assert.match(sql, /user_id = \$1 AND merchant = \$2 AND archived_at IS NULL/);
      assert.deepEqual(params, [userId, 'ARTISTA DE CAFE']);
      return { rows: [{ merchant: 'ARTISTA DE CAFE', budget_id: budgetId }], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  assert.deepEqual(await repository.findActiveMerchantMapping('ARTISTA DE CAFE'), {
    merchant: 'ARTISTA DE CAFE',
    budgetId,
  });
  const missing = createPostgresRepository(fakeDatabase(), { telegramUserId: 42 });
  assert.equal(await missing.findActiveMerchantMapping('UNKNOWN'), null);
});

test('upserts the merchant mapping and unarchives it instead of creating a duplicate', async () => {
  const database = fakeDatabase((sql, params) => {
    if (sql.startsWith('INSERT INTO merchant_mappings')) {
      assert.match(sql, /ON CONFLICT \(user_id, merchant\) DO UPDATE/);
      assert.match(sql, /budget_id = EXCLUDED\.budget_id/);
      assert.match(sql, /archived_at = NULL/);
      assert.match(sql, /updated_at = now\(\)/);
      assert.deepEqual(params, [userId, 'ARTISTA DE CAFE', budgetId]);
      return { rows: [{ merchant: 'ARTISTA DE CAFE', budget_id: budgetId }], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  const saved = await repository.saveMerchantMapping('ARTISTA DE CAFE', budgetId);
  const resaved = await repository.saveMerchantMapping('ARTISTA DE CAFE', budgetId);

  assert.deepEqual(saved, { merchant: 'ARTISTA DE CAFE', budgetId });
  assert.deepEqual(resaved, saved);
  assert.equal(database.calls.filter(
    ({ sql }) => sql.startsWith('INSERT INTO merchant_mappings'),
  ).length, 2);
});

test('lists only the owners non-archived merchant mappings', async () => {
  const database = fakeDatabase((sql, params) => {
    if (sql.includes('FROM merchant_mappings')) {
      assert.match(sql, /archived_at IS NULL/);
      assert.deepEqual(params, [userId]);
      return {
        rows: [
          { merchant: 'ARTISTA DE CAFE', budget_id: budgetId },
          { merchant: 'PIZZA PLACE', budget_id: '44444444-4444-4444-4444-444444444444' },
        ],
        rowCount: 2,
      };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  assert.deepEqual(await repository.getActiveMerchantMappings(), [
    { merchant: 'ARTISTA DE CAFE', budgetId },
    { merchant: 'PIZZA PLACE', budgetId: '44444444-4444-4444-4444-444444444444' },
  ]);
});

test('archives a merchant mapping by merchant key instead of by page id', async () => {
  const database = fakeDatabase((sql, params) => {
    if (sql.startsWith('UPDATE merchant_mappings')) {
      assert.match(sql, /archived_at = now\(\)/);
      assert.match(sql, /user_id = \$1 AND merchant = \$2 AND archived_at IS NULL/);
      assert.deepEqual(params, [userId, 'ARTISTA DE CAFE']);
      return { rows: [], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  await repository.archiveMerchantMapping('ARTISTA DE CAFE');
});

test('creates one pending ingestion per ingest id and returns the existing row on retry', async () => {
  const pendingRow = {
    id: '55555555-5555-5555-5555-555555555555',
    ingest_id: 'takenos:42',
    merchant: 'ARTISTA DE CAFE',
    description: 'Artista de Cafe',
    amount: '20.27',
    status: 'pending',
  };
  let inserts = 0;
  const database = fakeDatabase((sql, params) => {
    if (sql.startsWith('INSERT INTO pending_ingestions')) {
      inserts += 1;
      assert.match(sql, /ON CONFLICT \(user_id, ingest_id\) DO NOTHING/);
      assert.deepEqual(params, [userId, 'takenos:42', 'ARTISTA DE CAFE', 'Artista de Cafe', 20.27]);
      return inserts === 1
        ? { rows: [pendingRow], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.startsWith('SELECT id, ingest_id') && sql.includes('FROM pending_ingestions')) {
      return { rows: [pendingRow], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });
  const pending = {
    ingestId: 'takenos:42',
    merchant: 'ARTISTA DE CAFE',
    description: 'Artista de Cafe',
    amount: 20.27,
  };

  const first = await repository.createPendingIngestionIfNew(pending);
  const repeated = await repository.createPendingIngestionIfNew(pending);

  assert.equal(first.created, true);
  assert.equal(first.row.id, pendingRow.id);
  assert.equal(first.row.amount, 20.27);
  assert.equal(repeated.created, false);
  assert.equal(repeated.row.id, pendingRow.id);
  assert.equal(inserts, 2);
});

test('retrieves a pending ingestion by id and returns null when missing', async () => {
  const createdAt = new Date('2026-07-19T10:00:00.000Z');
  const database = fakeDatabase((sql, params) => {
    if (sql.includes('FROM pending_ingestions')) {
      assert.match(sql, /id = \$1 AND user_id = \$2/);
      assert.match(sql, /created_at/);
      if (params[0] === '55555555-5555-5555-5555-555555555555') {
        return {
          rows: [{
            id: params[0],
            ingest_id: 'takenos:42',
            merchant: 'ARTISTA DE CAFE',
            description: 'Artista de Cafe',
            amount: '20.27',
            status: 'pending',
            created_at: createdAt,
          }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  const pending = await repository.getPendingIngestion('55555555-5555-5555-5555-555555555555');
  const missing = await repository.getPendingIngestion('66666666-6666-6666-6666-666666666666');

  assert.deepEqual(pending, {
    id: '55555555-5555-5555-5555-555555555555',
    ingestId: 'takenos:42',
    merchant: 'ARTISTA DE CAFE',
    description: 'Artista de Cafe',
    amount: 20.27,
    status: 'pending',
    createdAt,
  });
  assert.equal(missing, null);
});

test('lists only pending ingestions for one merchant', async () => {
  const database = fakeDatabase((sql, params) => {
    if (sql.includes('FROM pending_ingestions')) {
      assert.match(sql, /merchant = \$2 AND status = 'pending'/);
      assert.deepEqual(params, [userId, 'ARTISTA DE CAFE']);
      return {
        rows: [
          {
            id: '55555555-5555-5555-5555-555555555555',
            ingest_id: 'takenos:42',
            merchant: 'ARTISTA DE CAFE',
            description: 'Artista de Cafe',
            amount: '20.27',
            status: 'pending',
          },
        ],
        rowCount: 1,
      };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  const rows = await repository.getPendingIngestionsByMerchant('ARTISTA DE CAFE');

  assert.equal(rows.length, 1);
  assert.equal(rows[0].ingestId, 'takenos:42');
});

test('marks a pending ingestion processed for the owner', async () => {
  const database = fakeDatabase((sql, params) => {
    if (sql.startsWith('UPDATE pending_ingestions')) {
      assert.match(sql, /status = 'processed'/);
      assert.match(sql, /id = \$1 AND user_id = \$2/);
      assert.deepEqual(params, ['55555555-5555-5555-5555-555555555555', userId]);
      return { rows: [], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  await repository.markPendingIngestionProcessed('55555555-5555-5555-5555-555555555555');
});

test('deletes a pending ingestion only for the owner', async () => {
  const database = fakeDatabase((sql, params) => {
    if (sql.startsWith('DELETE FROM pending_ingestions')) {
      assert.match(sql, /WHERE id = \$1 AND user_id = \$2/);
      assert.match(sql, /status = 'pending'/);
      assert.deepEqual(params, ['55555555-5555-5555-5555-555555555555', userId]);
      return { rows: [], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, { telegramUserId: 42 });

  await repository.cancelPendingIngestion('55555555-5555-5555-5555-555555555555');
});

test('creates an ingest-deduped expense and reports the conflict on redelivery', async () => {
  let inserts = 0;
  const database = fakeDatabase((sql, params) => {
    if (sql.startsWith('INSERT INTO expenses')) {
      inserts += 1;
      assert.match(sql, /ON CONFLICT \(user_id, ingest_id\) WHERE ingest_id IS NOT NULL DO NOTHING/);
      assert.deepEqual(params, [
        userId, budgetId, 'ARTISTA DE CAFE', 20.27, '2026-07-19', 'takenos:notification-42',
      ]);
      return inserts === 1
        ? { rows: [{ id: expenseId }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
  });
  const repository = createPostgresRepository(database, {
    telegramUserId: 42,
    timeZone: 'America/Guatemala',
  });
  const expense = {
    description: 'ARTISTA DE CAFE',
    amount: 20.27,
    budgetId,
    ingestId: 'takenos:notification-42',
    now: new Date('2026-07-20T05:30:00.000Z'),
  };

  const first = await repository.createExpenseIfNew(expense);
  const repeated = await repository.createExpenseIfNew(expense);

  assert.deepEqual(first, { created: true, expenseId });
  assert.deepEqual(repeated, { created: false, expenseId: null });
  assert.equal(inserts, 2);
});

test('flows an optional ingest id through the shared expense insert', async () => {
  const database = fakeDatabase((sql, params) => {
    if (sql.startsWith('INSERT INTO expenses')) {
      assert.match(sql, /ingest_id/);
      assert.equal(params[5], 'takenos:notification-42');
      return { rows: [{ id: expenseId }], rowCount: 1 };
    }
  });
  const repository = createPostgresRepository(database, {
    telegramUserId: 42,
    timeZone: 'America/Guatemala',
  });

  assert.equal(await repository.createExpense({
    description: 'Coffee',
    amount: 10.01,
    budgetId,
    now: new Date('2026-07-20T05:30:00.000Z'),
    ingestId: 'takenos:notification-42',
  }), expenseId);
});
