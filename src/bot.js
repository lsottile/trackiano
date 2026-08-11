import "dotenv/config";
import { pathToFileURL } from "node:url";
import { Bot } from "grammy";
import { inferCategory, selectInferredBudget } from "./inferCategory.js";
import { parseMessage } from "./parseMessage.js";
import {
  findBudgetId,
  createExpenseAndGetTotalToday,
  getBudgets,
  getMonthlyExpenses,
  getMonthlyExpenseDetails,
  getCategoryExpenses,
  getPeriodSpent,
  createBudget,
  deleteExpense,
  updateExpenseBudget,
} from "./notion.js";
import { formatMoney, roundMoney } from "./money.js";
import { getPeriodStart, daysUntilPayday } from "./pay.js";
import { formatMonthlySummary, formatVerboseMonthlySummary } from "./summary.js";
import { handleTargetCommand } from "./target.js";

const bot = new Bot(process.env.TELEGRAM_TOKEN);
const OWNER_ID = Number(process.env.TELEGRAM_OWNER_ID);

function encodeId(id) {
  return Buffer.from(id.replaceAll("-", ""), "hex").toString("base64url");
}

function decodeId(value) {
  if (!/^[A-Za-z0-9_-]{22}$/.test(value)) return null;
  const id = Buffer.from(value, "base64url");
  if (id.length !== 16 || id.toString("base64url") !== value) return null;
  const hex = id.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function encodeExpenseCallback(action, expenseId, budgetId) {
  return ["ex", action, encodeId(expenseId), budgetId && encodeId(budgetId)]
    .filter(Boolean)
    .join(".");
}

export function decodeExpenseCallback(data) {
  const [prefix, action, expense, budget, ...extra] = data.split(".");
  if (
    prefix !== "ex" ||
    !["recategorize", "set-category", "delete"].includes(action) ||
    extra.length ||
    !expense ||
    (action === "set-category") !== Boolean(budget)
  ) return null;
  const expenseId = decodeId(expense);
  const budgetId = budget ? decodeId(budget) : null;
  if (!expenseId || (budget && !budgetId)) return null;
  return { action, expenseId, budgetId };
}

export function registerExpenseActionHandlers(composer, {
  getBudgets: readBudgets = getBudgets,
  deleteExpense: removeExpense = deleteExpense,
  updateExpenseBudget: changeExpenseBudget = updateExpenseBudget,
} = {}) {
  return composer.on("callback_query:data", async (ctx, next) => {
    const callback = decodeExpenseCallback(ctx.callbackQuery.data);
    if (!callback) return next();
    await ctx.answerCallbackQuery?.();

    try {
      if (callback.action === "delete") {
        await removeExpense(callback.expenseId);
        return ctx.reply("Gasto eliminado ✓");
      }

      const budgets = await readBudgets();
      if (callback.action === "recategorize") {
        return ctx.reply("Elegí la nueva categoría:", {
          reply_markup: {
            inline_keyboard: budgets.map((budget) => [{
              text: budget.name,
              callback_data: encodeExpenseCallback(
                "set-category",
                callback.expenseId,
                budget.id,
              ),
            }]),
          },
        });
      }

      const budget = budgets.find((item) => item.id === callback.budgetId);
      if (!budget) return ctx.reply("La categoría ya no está disponible.");
      await changeExpenseBudget(callback.expenseId, budget.id);
      return ctx.reply(`Categoría actualizada a ${budget.name} ✓`);
    } catch {
      return ctx.reply("No pude actualizar ese gasto. Probá de nuevo.");
    }
  });
}

async function handleCompleteSummary(ctx, {
  getBudgets: readBudgets = getBudgets,
  getMonthlyExpenseDetails: readMonthlyExpenseDetails = getMonthlyExpenseDetails,
} = {}) {
  const [budgets, expenses] = await Promise.all([
    readBudgets(),
    readMonthlyExpenseDetails(),
  ]);
  return ctx.reply(formatVerboseMonthlySummary(budgets, expenses));
}

export function registerCompleteSummaryHandler(composer, dependencies) {
  return composer.on("message:text").hears("/summary-complete", (ctx) =>
    handleCompleteSummary(ctx, dependencies),
  );
}

bot.use((ctx, next) => {
  if (ctx.from?.id !== OWNER_ID) return ctx.reply("Unauthorized");
  return next();
});
registerExpenseActionHandlers(bot);

bot.command("help", async (ctx) => {
  return ctx.reply(
    `Available commands:\n\n` +
      `*Log expense*\n` +
      `description amount\n` +
      `description amount category\n\n` +
      `*Queries*\n` +
      `/balance <category> — remaining balance for a category\n` +
      `/budget <category> — how much you can spend per day\n` +
      `/budget <category> detail — expense list for the current period\n` +
      `/summary — all expenses this month\n` +
      `/summary-complete — monthly summary with top expenses\n` +
      `/target [amount] — show or set the recurring daily target\n` +
      `/categories — available categories\n\n` +
      `*Management*\n` +
      `/new <name> <amount> — create a new category`,
    { parse_mode: "Markdown" },
  );
});

bot.command("categories", async (ctx) => {
  const budgets = await getBudgets();
  const lines = budgets.map((b) => `• ${b.name}`).join("\n");
  return ctx.reply(`Available categories:\n${lines}`);
});

registerCompleteSummaryHandler(bot);

bot.command("balance", async (ctx) => {
  const category = ctx.match.trim();
  if (!category) return ctx.reply("Usage: /balance <category>");

  const budgets = await getBudgets();
  const budget = budgets.find(
    (b) => b.name.toLowerCase() === category.toLowerCase(),
  );
  if (!budget) return ctx.reply(`Category '${category}' not found.`);

  const spent = await getPeriodSpent(budget.id, getPeriodStart());
  const remaining = budget.amount - spent;
  return ctx.reply(
    `${budget.name}\nBudget: $${formatMoney(budget.amount)}\n` +
        `Spent: $${formatMoney(spent)}\nRemaining: $${formatMoney(remaining)}`,
  );
});

bot.command("summary", async (ctx) => {
  const [budgets, totals] = await Promise.all([
    getBudgets(),
    getMonthlyExpenses(),
  ]);
  return ctx.reply(formatMonthlySummary(budgets, totals));
});

bot.command("target", handleTargetCommand);

export async function handleBudget(ctx, {
  getBudgets: readBudgets = getBudgets,
} = {}) {
  const parts = ctx.match.trim().split(/\s+/);
  if (!parts[0]) return ctx.reply("Usage: /budget <category> [detail]");

  const isDetail = parts[parts.length - 1] === "detail";
  const categoryName = isDetail
    ? parts.slice(0, -1).join(" ")
    : parts.join(" ");
  if (!categoryName) return ctx.reply("Usage: /budget <category> [detail]");

  const budgets = await readBudgets();
  const budget = budgets.find(
    (b) => b.name.toLowerCase() === categoryName.toLowerCase(),
  );
  if (!budget) return ctx.reply(`Category '${categoryName}' not found.`);

  if (isDetail) {
    const expenses = await getCategoryExpenses(budget.id, getPeriodStart());
    if (!expenses.length)
      return ctx.reply(`No expenses in ${budget.name} this period.`);
    const lines = expenses
      .map((e) => `• ${e.description} — $${formatMoney(e.amount)}`)
      .join("\n");
    return ctx.reply(`${budget.name} — detail:\n${lines}`);
  } else {
    const spent = await getPeriodSpent(budget.id, getPeriodStart());
    const remaining = budget.amount - spent;
    const days = daysUntilPayday();
    const dailyAllowance = roundMoney(remaining / days);
    return ctx.reply(
      `${budget.name}\nRemaining: $${formatMoney(remaining)}\n` +
          `Days left: ${days}\n→ $${formatMoney(dailyAllowance)}/day`,
    );
  }
}

bot.command("budget", handleBudget);

bot.command("new", async (ctx) => {
  const parts = ctx.match.trim().split(/\s+/);
  if (parts.length < 2) return ctx.reply("Usage: /new <name> <amount>");

  const amount = Number(parts[parts.length - 1]);
  if (isNaN(amount)) return ctx.reply("Amount must be a number.");

  const name = parts.slice(0, -1).join(" ");
  await createBudget(name, amount);
  return ctx.reply(`✓ Category '${name}' created with $${formatMoney(amount)}`);
});

export async function handleExpenseMessage(ctx, {
  findBudgetId: readBudgetId = findBudgetId,
  getBudgets: readBudgets = getBudgets,
  inferCategory: categorize = inferCategory,
  selectInferredBudget: selectBudget = selectInferredBudget,
  createExpenseAndGetTotalToday: writeExpense = createExpenseAndGetTotalToday,
} = {}) {
  try {
    const parsed = parseMessage(ctx.message.text);
    const { description, category } = parsed;
    const amount = roundMoney(parsed.amount);

    let budgetId;
    let inferredCategoryName = null;

    if (category) {
      budgetId = await readBudgetId(category);
      if (!budgetId) {
        return ctx.reply(
          `Categoría '${category}' no encontrada. Revisá /categories.`,
        );
      }
    } else {
      const budgets = await readBudgets();
      let inference;
      try {
        inference = await categorize({ description, amount, budgets });
      } catch {
        return ctx.reply(
          "No pude inferir la categoría con seguridad. Mandalo como: description amount category",
        );
      }

      const budget = selectBudget(budgets, inference);
      if (!budget) {
        return ctx.reply(
          "No pude inferir la categoría con seguridad. Mandalo como: description amount category",
        );
      }

      budgetId = budget.id;
      inferredCategoryName = budget.name;
    }

    const { expenseId, totalToday } = await writeExpense({
      description,
      amount,
      budgetId,
    });
    const categoryLine = inferredCategoryName
      ? `\nCategoría: ${inferredCategoryName}`
      : "";
    return ctx.reply(
      `Cargado ✓${categoryLine}\nLlevás $${formatMoney(totalToday)} hoy`,
      {
        reply_markup: {
          inline_keyboard: [[
            {
              text: "Cambiar",
              callback_data: encodeExpenseCallback("recategorize", expenseId),
            },
            {
              text: "Eliminar",
              callback_data: encodeExpenseCallback("delete", expenseId),
            },
          ]],
        },
      },
    );
  } catch (err) {
    if (
      err.message.startsWith("Format:") ||
      err.message.includes("is not a valid amount")
    ) {
      return ctx.reply(err.message);
    }
    return ctx.reply("Something went wrong, try again.");
  }
}

bot.on("message:text", handleExpenseMessage);

export function startBot() {
  process.once("SIGINT", () => bot.stop());
  process.once("SIGTERM", () => bot.stop());
  return bot.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBot();
}
