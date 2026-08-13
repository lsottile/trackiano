import { roundMoney } from './money.js';

function cents(value) {
  return Math.round(roundMoney(value) * 100);
}

export function summarizeData(data) {
  return {
    budgetCount: data.budgets.length,
    budgetTotalCents: data.budgets.reduce((sum, budget) => sum + cents(budget.amount), 0),
    expenseCount: data.expenses.length,
    expenseTotalCents: data.expenses.reduce((sum, expense) => sum + cents(expense.amount), 0),
    settings: data.settings,
  };
}

function canonicalRecords(data) {
  const byId = (left, right) => String(left.id) < String(right.id) ? -1 : String(left.id) > String(right.id) ? 1 : 0;
  return {
    budgets: data.budgets.map((budget) => ({
      id: budget.id, name: budget.name, amountCents: cents(budget.amount),
    })).sort(byId),
    expenses: data.expenses.map((expense) => ({
      id: expense.id,
      budgetId: expense.budgetId,
      description: expense.description,
      amountCents: cents(expense.amount),
      date: expense.date,
    })).sort(byId),
    settings: data.settings === null ? null : {
      dailyTargetCents: data.settings.dailyTarget === null ? null : cents(data.settings.dailyTarget),
      attemptedWeeklyPeriod: data.settings.attemptedWeeklyPeriod,
      attemptedMonthlyPeriod: data.settings.attemptedMonthlyPeriod,
    },
  };
}

function compareData(sourceData, targetData) {
  const source = summarizeData(sourceData);
  const target = summarizeData(targetData);
  const sourceRecords = canonicalRecords(sourceData);
  const targetRecords = canonicalRecords(targetData);
  const mismatches = [];
  for (const [recordKey, measures] of [
    ['budgets', ['budgetCount', 'budgetTotalCents']],
    ['expenses', ['expenseCount', 'expenseTotalCents']],
  ]) {
    const aggregateMismatches = measures.filter((key) => source[key] !== target[key]);
    mismatches.push(...aggregateMismatches);
    if (!aggregateMismatches.length && JSON.stringify(sourceRecords[recordKey]) !==
      JSON.stringify(targetRecords[recordKey])) mismatches.push(recordKey);
  }
  if (JSON.stringify(sourceRecords.settings) !== JSON.stringify(targetRecords.settings)) {
    mismatches.push('settings');
  }
  return mismatches;
}

export async function migrateNotionData({
  sourceData,
  target,
  telegramUserId,
  userDefaults = {},
  apply = false,
}) {
  const source = summarizeData(sourceData);
  const currentData = await target.snapshot(telegramUserId);
  const current = summarizeData(currentData);
  const currentMismatches = compareData(sourceData, currentData);
  if (!apply) {
    return {
      mode: 'dry-run',
      source,
      target: current,
      matches: currentMismatches.length === 0,
    };
  }
  if (!currentMismatches.length) {
    return { mode: 'apply', source, target: current, matches: true, alreadyImported: true };
  }
  const targetIsEmpty = current.budgetCount === 0 &&
    current.expenseCount === 0 && current.settings === null;
  if (!targetIsEmpty) {
    throw new Error(
      `Target contains divergent data; refusing to overwrite: ${currentMismatches.join(', ')}`,
    );
  }

  return target.transaction(async (transaction) => {
    const userId = await transaction.upsertUser(telegramUserId, userDefaults);
    for (const budget of sourceData.budgets) {
      await transaction.upsertBudget(userId, budget);
    }
    for (const expense of sourceData.expenses) {
      await transaction.upsertExpense(userId, expense);
    }
    await transaction.upsertSettings(userId, sourceData.settings);

    const importedData = await transaction.snapshot(telegramUserId);
    const imported = summarizeData(importedData);
    const mismatches = compareData(sourceData, importedData);
    if (mismatches.length) {
      throw new Error(`Migration reconciliation failed: ${mismatches.join(', ')}`);
    }
    return { mode: 'apply', source, target: imported, matches: true };
  });
}

function mapSnapshot({ budgets, expenses, settings }) {
  return {
    budgets: budgets.map((row) => ({
      id: row.id,
      name: row.name,
      amount: roundMoney(Number(row.amount)),
    })),
    expenses: expenses.map((row) => ({
      id: row.id,
      budgetId: row.budget_id,
      description: row.description,
      amount: roundMoney(Number(row.amount)),
      date: typeof row.expense_date === 'string'
        ? row.expense_date
        : row.expense_date.toISOString().slice(0, 10),
    })),
    settings: settings ? {
      dailyTarget: settings.daily_target === null
        ? null
        : roundMoney(Number(settings.daily_target)),
      attemptedWeeklyPeriod: settings.attempted_weekly_period,
      attemptedMonthlyPeriod: settings.attempted_monthly_period,
    } : null,
  };
}

export function createPostgresMigrationTarget(database) {
  function targetFor(executor) {
    return {
      async snapshot(telegramUserId) {
        const user = await executor.query(
          'SELECT id FROM users WHERE telegram_user_id = $1',
          [String(telegramUserId)],
        );
        if (!user.rows[0]) return { budgets: [], expenses: [], settings: null };
        const userId = user.rows[0].id;
        const budgets = await executor.query(
          'SELECT id, name, amount FROM budgets WHERE user_id = $1 ORDER BY id',
          [userId],
        );
        const expenses = await executor.query(
          `SELECT id, budget_id, description, amount, expense_date
           FROM expenses
           WHERE user_id = $1 AND deleted_at IS NULL
             AND entry_type = 'expense'
           ORDER BY id`,
          [userId],
        );
        const settings = await executor.query(
          `SELECT daily_target, attempted_weekly_period, attempted_monthly_period
           FROM user_settings WHERE user_id = $1`,
          [userId],
        );
        return mapSnapshot({
          budgets: budgets.rows,
          expenses: expenses.rows,
          settings: settings.rows[0] ?? null,
        });
      },

      async upsertUser(telegramUserId, defaults) {
        const values = [
          String(telegramUserId),
          defaults.language ?? 'es',
          defaults.currency ?? 'USD',
          defaults.timezone ?? 'UTC',
          defaults.paydayDay ?? 31,
        ];
        await executor.query(
          `INSERT INTO users
            (telegram_user_id, language, currency, timezone, payday_day)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (telegram_user_id) DO NOTHING`,
          values,
        );
        const result = await executor.query(
          'SELECT id FROM users WHERE telegram_user_id = $1',
          [values[0]],
        );
        return result.rows[0].id;
      },

      async upsertBudget(userId, budget) {
        const result = await executor.query(
          `INSERT INTO budgets (id, user_id, name, amount)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             amount = EXCLUDED.amount,
             updated_at = now()
           WHERE budgets.user_id = EXCLUDED.user_id
           RETURNING id`,
          [budget.id, userId, budget.name, roundMoney(budget.amount)],
        );
        if (result.rowCount !== 1) throw new Error(`Budget ownership conflict: ${budget.id}`);
      },

      async upsertExpense(userId, expense) {
        const result = await executor.query(
          `INSERT INTO expenses
            (id, user_id, budget_id, description, amount, expense_date)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             budget_id = EXCLUDED.budget_id,
             description = EXCLUDED.description,
             amount = EXCLUDED.amount,
             expense_date = EXCLUDED.expense_date,
             deleted_at = NULL,
             updated_at = now()
           WHERE expenses.user_id = EXCLUDED.user_id
           RETURNING id`,
          [
            expense.id,
            userId,
            expense.budgetId,
            expense.description,
            roundMoney(expense.amount),
            expense.date,
          ],
        );
        if (result.rowCount !== 1) throw new Error(`Expense ownership conflict: ${expense.id}`);
      },

      async upsertSettings(userId, settings) {
        await executor.query(
          `INSERT INTO user_settings
            (user_id, daily_target, attempted_weekly_period, attempted_monthly_period)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE SET
             daily_target = EXCLUDED.daily_target,
             attempted_weekly_period = EXCLUDED.attempted_weekly_period,
             attempted_monthly_period = EXCLUDED.attempted_monthly_period,
             updated_at = now()`,
          [
            userId,
            settings.dailyTarget,
            settings.attemptedWeeklyPeriod,
            settings.attemptedMonthlyPeriod,
          ],
        );
      },
    };
  }

  return {
    ...targetFor(database),
    transaction(work) {
      return database.transaction((executor) => work(targetFor(executor)));
    },
  };
}
