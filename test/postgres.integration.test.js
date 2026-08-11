import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createDatabase } from '../src/db.js';
import {
  createPostgresMigrationTarget,
  migrateNotionData,
} from '../src/data-migration.js';
import { runMigrations } from '../src/migrations.js';
import { createPostgresRepository } from '../src/postgres.js';

const connectionString = process.env.TEST_DATABASE_URL;

test('real PostgreSQL enforces ownership, cents, soft deletion, and atomic claims', {
  skip: !connectionString,
}, async () => {
  const database = createDatabase({ connectionString, sslMode: 'disable' });
  try {
    const directory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../migrations',
    );
    assert.deepEqual(await runMigrations(database, { directory }), [
      '001_initial.sql',
      '002_lock_down_public_schema.sql',
    ]);
    assert.deepEqual(await runMigrations(database, { directory }), []);
    const protectedTables = await database.query(
      `SELECT relname FROM pg_class
       WHERE relname IN ('users', 'budgets', 'expenses', 'user_settings')
         AND relrowsecurity = true`,
    );
    assert.equal(protectedTables.rows.length, 4);

    const firstUser = await database.query(
      `INSERT INTO users (telegram_user_id, timezone)
       VALUES (42, 'America/Guatemala') RETURNING id`,
    );
    const secondUser = await database.query(
      'INSERT INTO users (telegram_user_id) VALUES (43) RETURNING id',
    );
    const firstBudget = await database.query(
      `INSERT INTO budgets (user_id, name, amount)
       VALUES ($1, 'Food', 100) RETURNING id`,
      [firstUser.rows[0].id],
    );
    const otherBudget = await database.query(
      `INSERT INTO budgets (user_id, name, amount)
       VALUES ($1, 'Other', 100) RETURNING id`,
      [secondUser.rows[0].id],
    );

    await assert.rejects(
      database.query(
        `INSERT INTO expenses
          (user_id, budget_id, description, amount, expense_date)
         VALUES ($1, $2, 'invalid', 1, '2026-08-10')`,
        [firstUser.rows[0].id, otherBudget.rows[0].id],
      ),
      (error) => error.code === '23503',
    );

    const repository = createPostgresRepository(database, {
      telegramUserId: 42,
      timeZone: 'America/Guatemala',
    });
    const expenseId = await repository.createExpense({
      budgetId: firstBudget.rows[0].id,
      description: 'Coffee',
      amount: 10.005,
      now: new Date('2026-08-11T05:30:00.000Z'),
    });
    const stored = await database.query(
      'SELECT amount, expense_date::text AS expense_date FROM expenses WHERE id = $1',
      [expenseId],
    );
    assert.equal(stored.rows[0].amount, '10.01');
    assert.equal(stored.rows[0].expense_date, '2026-08-10');

    const initialKeys = {
      initialWeeklyPeriodKey: 'week-1',
      initialMonthlyPeriodKey: 'month-1',
    };
    const competingRepository = createPostgresRepository(database, {
      telegramUserId: 42,
      timeZone: 'America/Guatemala',
    });
    const claims = await Promise.all([
      repository.claimSummaryPeriod('weekly', 'week-2', initialKeys),
      competingRepository.claimSummaryPeriod('weekly', 'week-2', initialKeys),
    ]);
    assert.deepEqual(claims.sort(), [false, true]);

    await repository.deleteExpense(expenseId);
    assert.deepEqual(
      await repository.getExpensesInRange('2026-08-01', '2026-09-01'),
      {},
    );

    const sourceData = {
      budgets: [{
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        name: 'Imported',
        amount: 200,
      }],
      expenses: [{
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        budgetId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        description: 'Imported expense',
        amount: 20.27,
        date: '2026-08-09',
      }],
      settings: {
        dailyTarget: 50,
        attemptedWeeklyPeriod: 'week-imported',
        attemptedMonthlyPeriod: 'month-imported',
      },
    };
    const migrationTarget = createPostgresMigrationTarget(database);
    const migration = await migrateNotionData({
      sourceData,
      target: migrationTarget,
      telegramUserId: 99,
      apply: true,
    });
    assert.equal(migration.matches, true);
    assert.equal((await migrateNotionData({
      sourceData,
      target: migrationTarget,
      telegramUserId: 99,
      apply: true,
    })).matches, true);
  } finally {
    await database.close();
  }
});
