import "dotenv/config";
import { pathToFileURL } from "node:url";
import { Bot } from "grammy";
import { inferCategory, selectInferredBudget } from "./inferCategory.js";
import { parseMessage } from "./parseMessage.js";
import {
  findBudgetId,
  createExpense,
  getBudgets,
  getMonthlyExpenses,
  getTotalSpentToday,
  getCategoryExpenses,
  getPeriodSpent,
  createBudget,
} from "./notion.js";
import { getPeriodStart, daysUntilPayday } from "./pay.js";
import { formatMonthlySummary } from "./summary.js";
import { handleTargetCommand } from "./target.js";

const bot = new Bot(process.env.TELEGRAM_TOKEN);
const OWNER_ID = Number(process.env.TELEGRAM_OWNER_ID);

bot.use((ctx, next) => {
  if (ctx.from?.id !== OWNER_ID) return ctx.reply("Unauthorized");
  return next();
});

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
    `${budget.name}\nBudget: $${budget.amount}\nSpent: $${spent}\nRemaining: $${remaining}`,
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

bot.command("budget", async (ctx) => {
  const parts = ctx.match.trim().split(/\s+/);
  if (!parts[0]) return ctx.reply("Usage: /budget <category> [detail]");

  const isDetail = parts[parts.length - 1] === "detail";
  const categoryName = isDetail
    ? parts.slice(0, -1).join(" ")
    : parts.join(" ");

  const budgets = await getBudgets();
  const budget = budgets.find(
    (b) => b.name.toLowerCase() === categoryName.toLowerCase(),
  );
  if (!budget) return ctx.reply(`Category '${categoryName}' not found.`);

  if (isDetail) {
    const expenses = await getCategoryExpenses(budget.id, getPeriodStart());
    if (!expenses.length)
      return ctx.reply(`No expenses in ${budget.name} this period.`);
    const lines = expenses
      .map((e) => `• ${e.description} — $${e.amount}`)
      .join("\n");
    return ctx.reply(`${budget.name} — detail:\n${lines}`);
  } else {
    const spent = await getPeriodSpent(budget.id, getPeriodStart());
    const remaining = budget.amount - spent;
    const days = daysUntilPayday();
    const dailyAllowance = Math.round(remaining / days);
    return ctx.reply(
      `${budget.name}\nRemaining: $${remaining}\nDays left: ${days}\n→ $${dailyAllowance}/day`,
    );
  }
});

bot.command("new", async (ctx) => {
  const parts = ctx.match.trim().split(/\s+/);
  if (parts.length < 2) return ctx.reply("Usage: /new <name> <amount>");

  const amount = Number(parts[parts.length - 1]);
  if (isNaN(amount)) return ctx.reply("Amount must be a number.");

  const name = parts.slice(0, -1).join(" ");
  await createBudget(name, amount);
  return ctx.reply(`✓ Category '${name}' created with $${amount}`);
});

bot.on("message:text", async (ctx) => {
  try {
    const { description, amount, category } = parseMessage(ctx.message.text);

    let budgetId;
    let inferredCategoryName = null;

    if (category) {
      budgetId = await findBudgetId(category);
      if (!budgetId)
        return ctx.reply(
          `Categoría '${category}' no encontrada. Revisá /categories.`,
        );
    } else {
      const budgets = await getBudgets();
      let inference;
      try {
        inference = await inferCategory({ description, amount, budgets });
      } catch {
        return ctx.reply(
          "No pude inferir la categoría con seguridad. Mandalo como: description amount category",
        );
      }

      const budget = selectInferredBudget(budgets, inference);
      if (!budget) {
        return ctx.reply(
          "No pude inferir la categoría con seguridad. Mandalo como: description amount category",
        );
      }

      budgetId = budget.id;
      inferredCategoryName = budget.name;
    }

    await createExpense({ description, amount, budgetId });

    const totalToday = await getTotalSpentToday();
    const categoryLine = inferredCategoryName
      ? `\nCategoría: ${inferredCategoryName}`
      : "";
    return ctx.reply(`Cargado ✓${categoryLine}\nLlevás $${totalToday} hoy`);
  } catch (err) {
    if (
      err.message.startsWith("Format:") ||
      err.message.includes("is not a valid amount")
    ) {
      return ctx.reply(err.message);
    }
    return ctx.reply("Something went wrong, try again.");
  }
});

export function startBot() {
  process.once("SIGINT", () => bot.stop());
  process.once("SIGTERM", () => bot.stop());
  return bot.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBot();
}
