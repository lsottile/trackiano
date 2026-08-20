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
import { fingerprintDescription } from '../src/descriptionFingerprint.js';

const connectionString = process.env.TEST_DATABASE_URL;

test('real PostgreSQL enforces ownership, cents, soft deletion, and atomic claims', {
  skip: !connectionString,
}, async () => {
  const database = createDatabase({ connectionString, sslMode: 'disable' });
  try {
    await database.query('CREATE ROLE anon NOLOGIN');
    await database.query('CREATE ROLE authenticated NOLOGIN');
    const directory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../migrations',
    );
    assert.deepEqual(await runMigrations(database, { directory }), [
      '001_initial.sql',
      '002_lock_down_public_schema.sql',
      '003_category_inference_rules.sql',
      '004_takenos_ingestion.sql',
    ]);
    assert.deepEqual(await runMigrations(database, { directory }), []);
    const protectedTables = await database.query(
      `SELECT relname FROM pg_class
       WHERE relname IN ('users', 'budgets', 'expenses', 'user_settings',
                         'category_inference_rules', 'merchant_mappings',
                         'pending_ingestions')
         AND relrowsecurity = true`,
    );
    assert.equal(protectedTables.rows.length, 7);
    const clientPrivileges = await database.query(
      `SELECT has_table_privilege('anon', 'category_inference_rules', 'SELECT') AS anon_select,
              has_table_privilege('authenticated', 'category_inference_rules', 'INSERT') AS authenticated_insert`,
    );
    assert.deepEqual(clientPrivileges.rows[0], {
      anon_select: false, authenticated_insert: false,
    });
    assert.equal((await database.query('SELECT count(*)::int AS count FROM category_inference_rules')).rows[0].count, 0);
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
      database.query(`INSERT INTO category_inference_rules
        (user_id, description_fingerprint, budget_id)
        VALUES ($1, decode('aa', 'hex'), $2)`,
      [firstUser.rows[0].id, firstBudget.rows[0].id]),
      (error) => error.code === '23514',
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

    const alternateBudget = await database.query(
      `INSERT INTO budgets (user_id, name, amount)
       VALUES ($1, 'Travel', 100) RETURNING id`,
      [firstUser.rows[0].id],
    );
    const sharedFingerprint = fingerprintDescription('Coffee');
    await database.query(
      `INSERT INTO category_inference_rules (user_id, description_fingerprint, budget_id)
       VALUES ($1, decode($2, 'hex'), $3), ($4, decode($2, 'hex'), $5)`,
      [firstUser.rows[0].id, sharedFingerprint, firstBudget.rows[0].id,
        secondUser.rows[0].id, otherBudget.rows[0].id],
    );
    assert.deepEqual(await repository.findLearnedBudget(sharedFingerprint), {
      id: firstBudget.rows[0].id, name: 'Food',
    });
    await assert.rejects(database.query(
      `INSERT INTO category_inference_rules (user_id, description_fingerprint, budget_id)
       VALUES ($1, decode($2, 'hex'), $3)`,
      [firstUser.rows[0].id, fingerprintDescription('cross-user'), otherBudget.rows[0].id],
    ), (error) => error.code === '23503');

    await repository.recategorizeExpenseAndLearn(expenseId, alternateBudget.rows[0].id);
    let learnedPair = await database.query(
      `SELECT e.budget_id AS expense_budget, r.budget_id AS rule_budget
       FROM expenses e JOIN category_inference_rules r
         ON r.user_id = e.user_id AND r.description_fingerprint = decode($2, 'hex')
       WHERE e.id = $1`,
      [expenseId, sharedFingerprint],
    );
    assert.equal(learnedPair.rows[0].expense_budget, alternateBudget.rows[0].id);
    assert.equal(learnedPair.rows[0].rule_budget, alternateBudget.rows[0].id);

    await database.query(`CREATE FUNCTION fail_rule_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'forced rule failure'; END $$`);
    await database.query(`CREATE TRIGGER fail_rule_write BEFORE INSERT OR UPDATE
      ON category_inference_rules FOR EACH ROW EXECUTE FUNCTION fail_rule_write()`);
    await assert.rejects(repository.recategorizeExpenseAndLearn(expenseId, firstBudget.rows[0].id), /forced rule failure/);
    assert.equal((await database.query('SELECT budget_id FROM expenses WHERE id = $1', [expenseId])).rows[0].budget_id, alternateBudget.rows[0].id);
    await database.query('DROP TRIGGER fail_rule_write ON category_inference_rules');
    await database.query('DROP FUNCTION fail_rule_write()');

    await Promise.all([
      repository.recategorizeExpenseAndLearn(expenseId, firstBudget.rows[0].id),
      createPostgresRepository(database, { telegramUserId: 42 }).recategorizeExpenseAndLearn(expenseId, alternateBudget.rows[0].id),
    ]);
    learnedPair = await database.query(
      `SELECT e.budget_id AS expense_budget, r.budget_id AS rule_budget
       FROM expenses e JOIN category_inference_rules r
         ON r.user_id = e.user_id AND r.description_fingerprint = decode($2, 'hex')
       WHERE e.id = $1`,
      [expenseId, sharedFingerprint],
    );
    assert.equal(learnedPair.rows[0].expense_budget, learnedPair.rows[0].rule_budget);

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
    assert.equal((await database.query(
      'SELECT count(*)::int AS count FROM category_inference_rules WHERE user_id = $1 AND description_fingerprint = decode($2, \'hex\')',
      [firstUser.rows[0].id, sharedFingerprint],
    )).rows[0].count, 1);

    const ingestedExpense = {
      budgetId: firstBudget.rows[0].id,
      description: 'Takenos coffee',
      amount: 20.27,
      ingestId: 'takenos:dedupe-after-delete',
      now: new Date('2026-08-11T05:30:00.000Z'),
    };
    const ingested = await repository.createExpenseIfNew(ingestedExpense);
    assert.equal(ingested.created, true);
    await repository.deleteExpense(ingested.expenseId);
    assert.deepEqual(await repository.createExpenseIfNew(ingestedExpense), {
      created: false,
      expenseId: null,
    });
    assert.equal((await database.query(
      'SELECT count(*)::int AS count FROM expenses WHERE user_id = $1 AND ingest_id = $2',
      [firstUser.rows[0].id, 'takenos:dedupe-after-delete'],
    )).rows[0].count, 1);

    await database.query('DELETE FROM expenses WHERE id = $1', [expenseId]);
    assert.equal((await database.query(
      'SELECT count(*)::int AS count FROM category_inference_rules WHERE user_id = $1 AND description_fingerprint = decode($2, \'hex\')',
      [firstUser.rows[0].id, sharedFingerprint],
    )).rows[0].count, 1);
    await database.query('DELETE FROM budgets WHERE id = $1', [alternateBudget.rows[0].id]);
    assert.equal((await database.query(
      'SELECT count(*)::int AS count FROM category_inference_rules WHERE budget_id = $1',
      [alternateBudget.rows[0].id],
    )).rows[0].count, 0);

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
