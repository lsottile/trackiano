import { createDatabase } from './db.js';
import { roundMoney } from './money.js';
import { formatDateInTimeZone } from './periods.js';

function money(value) {
  return roundMoney(Number(value));
}

function monthlyRange(now, timeZone) {
  const [year, month] = formatDateInTimeZone(now, timeZone).split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    start: `${year}-${String(month).padStart(2, '0')}-01`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`,
  };
}

function mapSettings(row) {
  return {
    id: row.user_id,
    dailyTarget: row.daily_target === null ? null : money(row.daily_target),
    attemptedWeeklyPeriod: row.attempted_weekly_period ?? '',
    attemptedMonthlyPeriod: row.attempted_monthly_period ?? '',
  };
}

export function createPostgresRepository(database, {
  telegramUserId,
  timeZone = process.env.APP_TIMEZONE ?? 'UTC',
} = {}) {
  if (!Number.isSafeInteger(Number(telegramUserId)) || Number(telegramUserId) <= 0) {
    throw new Error('TELEGRAM_OWNER_ID must be a positive safe integer.');
  }
  let resolvedUserId;

  async function getUserId(executor = database) {
    if (resolvedUserId) return resolvedUserId;
    const result = await executor.query(
      'SELECT id FROM users WHERE telegram_user_id = $1',
      [String(telegramUserId)],
    );
    if (result.rows.length !== 1) {
      throw new Error(`No PostgreSQL user found for Telegram owner ${telegramUserId}.`);
    }
    resolvedUserId = result.rows[0].id;
    return resolvedUserId;
  }

  async function createExpenseWith(executor, userId, {
    description,
    amount,
    budgetId,
    now = new Date(),
  }) {
    const result = await executor.query(
      `INSERT INTO expenses
        (user_id, budget_id, description, amount, expense_date)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        userId,
        budgetId,
        description,
        roundMoney(amount),
        formatDateInTimeZone(now, timeZone),
      ],
    );
    return result.rows[0]?.id ?? '';
  }

  async function totalTodayWith(executor, userId, now) {
    const today = formatDateInTimeZone(now, timeZone);
    const result = await executor.query(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE user_id = $1 AND expense_date = $2 AND deleted_at IS NULL`,
      [userId, today],
    );
    return money(result.rows[0]?.total ?? 0);
  }

  return {
    formatAppDate(date = new Date()) {
      return formatDateInTimeZone(date, timeZone);
    },

    async findBudgetId(categoryName) {
      const userId = await getUserId();
      const result = await database.query(
        'SELECT id FROM budgets WHERE user_id = $1 AND lower(name) = lower($2)',
        [userId, categoryName],
      );
      return result.rows[0]?.id ?? null;
    },

    async getBudgets() {
      const userId = await getUserId();
      const result = await database.query(
        `SELECT id, name, amount
         FROM budgets
         WHERE user_id = $1
         ORDER BY name`,
        [userId],
      );
      return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        amount: money(row.amount),
      }));
    },

    async getPeriodSpent(categoryId, periodStart) {
      const userId = await getUserId();
      const result = await database.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM expenses
         WHERE user_id = $1 AND budget_id = $2
           AND expense_date >= $3 AND deleted_at IS NULL`,
        [userId, categoryId, formatDateInTimeZone(periodStart, timeZone)],
      );
      return money(result.rows[0]?.total ?? 0);
    },

    async getExpensesInRange(start, end) {
      const userId = await getUserId();
      const result = await database.query(
        `SELECT budget_id, SUM(amount) AS total
         FROM expenses
         WHERE user_id = $1 AND expense_date >= $2 AND expense_date < $3
           AND deleted_at IS NULL
         GROUP BY budget_id`,
        [userId, start, end],
      );
      return Object.fromEntries(
        result.rows.map((row) => [row.budget_id, money(row.total)]),
      );
    },

    async getMonthlyExpenses({ now = new Date() } = {}) {
      const { start, end } = monthlyRange(now, timeZone);
      return this.getExpensesInRange(start, end);
    },

    async getMonthlyExpenseDetails({ now = new Date() } = {}) {
      const userId = await getUserId();
      const { start, end } = monthlyRange(now, timeZone);
      const result = await database.query(
        `SELECT id, budget_id, description, amount
         FROM expenses
         WHERE user_id = $1 AND expense_date >= $2 AND expense_date < $3
           AND deleted_at IS NULL
         ORDER BY expense_date DESC, created_at DESC`,
        [userId, start, end],
      );
      return result.rows.map((row) => ({
        id: row.id,
        budgetId: row.budget_id,
        description: row.description,
        amount: money(row.amount),
      }));
    },

    async getSettings({
      initialWeeklyPeriodKey = '',
      initialMonthlyPeriodKey = '',
    } = {}) {
      const userId = await getUserId();
      await database.query(
        `INSERT INTO user_settings
          (user_id, attempted_weekly_period, attempted_monthly_period)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, initialWeeklyPeriodKey, initialMonthlyPeriodKey],
      );
      await database.query(
        `UPDATE user_settings
         SET attempted_weekly_period = CASE
               WHEN btrim(attempted_weekly_period) = '' THEN $2
               ELSE attempted_weekly_period END,
             attempted_monthly_period = CASE
               WHEN btrim(attempted_monthly_period) = '' THEN $3
               ELSE attempted_monthly_period END,
             updated_at = now()
         WHERE user_id = $1`,
        [userId, initialWeeklyPeriodKey, initialMonthlyPeriodKey],
      );
      const result = await database.query(
        `SELECT user_id, daily_target, attempted_weekly_period,
                attempted_monthly_period
         FROM user_settings WHERE user_id = $1`,
        [userId],
      );
      return mapSettings(result.rows[0]);
    },

    async setDailyTarget(dailyTarget, initialPeriodKeys) {
      const settings = await this.getSettings(initialPeriodKeys);
      await database.query(
        `UPDATE user_settings
         SET daily_target = $2, updated_at = now()
         WHERE user_id = $1`,
        [settings.id, roundMoney(dailyTarget)],
      );
    },

    async claimSummaryPeriod(periodType, periodKey, initialPeriodKeys) {
      const settings = await this.getSettings(initialPeriodKeys);
      const column = periodType === 'weekly'
        ? 'attempted_weekly_period'
        : periodType === 'monthly'
          ? 'attempted_monthly_period'
          : null;
      if (!column) throw new Error(`Unknown summary period type: ${periodType}`);
      const result = await database.query(
        `UPDATE user_settings
         SET ${column} = $2, updated_at = now()
         WHERE user_id = $1 AND ${column} IS DISTINCT FROM $2
         RETURNING user_id`,
        [settings.id, periodKey],
      );
      return result.rowCount === 1;
    },

    async getTotalSpentInPeriod(periodStart) {
      const userId = await getUserId();
      const result = await database.query(
        `SELECT COALESCE(SUM(amount), 0) AS total
         FROM expenses
         WHERE user_id = $1 AND expense_date >= $2 AND deleted_at IS NULL`,
        [userId, formatDateInTimeZone(periodStart, timeZone)],
      );
      return money(result.rows[0]?.total ?? 0);
    },

    async getTotalSpentToday({ now = new Date() } = {}) {
      const userId = await getUserId();
      return totalTodayWith(database, userId, now);
    },

    async createExpenseAndGetTotalToday(expense) {
      const userId = await getUserId();
      const now = expense.now ?? new Date();
      return database.transaction(async (transaction) => {
        const totalToday = await totalTodayWith(transaction, userId, now);
        const amount = roundMoney(expense.amount);
        const expenseId = await createExpenseWith(
          transaction,
          userId,
          { ...expense, amount, now },
        );
        return { expenseId, totalToday: roundMoney(totalToday + amount) };
      });
    },

    async getCategoryExpenses(categoryId, periodStart) {
      const userId = await getUserId();
      const result = await database.query(
        `SELECT description, amount
         FROM expenses
         WHERE user_id = $1 AND budget_id = $2
           AND expense_date >= $3 AND deleted_at IS NULL
         ORDER BY expense_date DESC, created_at DESC`,
        [userId, categoryId, formatDateInTimeZone(periodStart, timeZone)],
      );
      return result.rows.map((row) => ({
        description: row.description,
        amount: money(row.amount),
      }));
    },

    async createBudget(name, amount, { id } = {}) {
      const userId = await getUserId();
      const result = await database.query(
        `INSERT INTO budgets (id, user_id, name, amount)
         VALUES (COALESCE($4::uuid, gen_random_uuid()), $1, $2, $3)
         RETURNING id`,
        [userId, name, roundMoney(amount), id ?? null],
      );
      return result.rows[0]?.id ?? '';
    },

    async getLastExpense() {
      const userId = await getUserId();
      const result = await database.query(
        `SELECT id, description, amount
         FROM expenses
         WHERE user_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId],
      );
      const row = result.rows[0];
      return row ? { id: row.id, description: row.description, amount: money(row.amount) } : null;
    },

    async deleteExpense(expenseId) {
      const userId = await getUserId();
      const result = await database.query(
        `UPDATE expenses SET deleted_at = now(), updated_at = now()
         WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
        [expenseId, userId],
      );
      if (result.rowCount !== 1) throw new Error(`Expense not found: ${expenseId}`);
    },

    async updateExpenseBudget(expenseId, budgetId) {
      const userId = await getUserId();
      const result = await database.query(
        `UPDATE expenses SET budget_id = $2, updated_at = now()
         WHERE id = $1 AND user_id = $3 AND deleted_at IS NULL`,
        [expenseId, budgetId, userId],
      );
      if (result.rowCount !== 1) throw new Error(`Expense not found: ${expenseId}`);
    },

    async createExpense(expense) {
      const userId = await getUserId();
      return createExpenseWith(database, userId, expense);
    },
  };
}

export function createDefaultPostgresRepository() {
  const database = createDatabase();
  return createPostgresRepository(database, {
    telegramUserId: Number(process.env.TELEGRAM_OWNER_ID),
    timeZone: process.env.APP_TIMEZONE ?? 'UTC',
  });
}
