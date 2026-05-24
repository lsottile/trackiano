import "dotenv/config";
import { Bot } from "grammy";
import { parseMessage } from "./parseMessage.js";
import {
  findBudgetId,
  createExpense,
  getBudgets,
  getMonthlyExpenses,
  getMonthlyExpensesWithDetails,
  getTotalSpentToday,
  getCategoryExpenses,
  getPeriodSpent,
  createBudget,
} from "./notion.js";
import { getPeriodStart, daysUntilPayday } from "./pay.js";

const bot = new Bot(process.env.TELEGRAM_TOKEN);
const OWNER_ID = Number(process.env.TELEGRAM_OWNER_ID);

bot.use((ctx, next) => {
  if (ctx.from?.id !== OWNER_ID) return ctx.reply("Unauthorized");
  return next();
});

bot.command("help", async (ctx) => {
  await ctx.reply(
    `Available commands:\n\n` +
      `*Log expense*\n` +
      `description amount category\n\n` +
      `*Queries*\n` +
      `/balance <category> — remaining balance for a category\n` +
      `/budget <category> — how much you can spend per day\n` +
      `/budget <category> detail — expense list for the current period\n` +
      `/summary — all expenses this month\n` +
      `/export — full data to paste into any AI\n` +
      `/categories — available categories\n\n` +
      `*Management*\n` +
      `/new <name> <amount> — create a new category`,
    { parse_mode: "Markdown" },
  );
});

bot.command("categories", async (ctx) => {
  const budgets = await getBudgets();
  const lines = budgets.map((b) => `• ${b.name}`).join("\n");
  await ctx.reply(`Available categories:\n${lines}`);
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
  await ctx.reply(
    `${budget.name}\nBudget: $${budget.amount}\nSpent: $${spent}\nRemaining: $${remaining}`,
  );
});

bot.command("summary", async (ctx) => {
  const [budgets, totals] = await Promise.all([
    getBudgets(),
    getMonthlyExpenses(),
  ]);
  const budgetMap = Object.fromEntries(budgets.map((b) => [b.id, b.name]));

  const lines = Object.entries(totals).map(([id, spent]) => {
    const name = budgetMap[id] ?? id;
    return `• ${name}: $${spent}`;
  });

  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  await ctx.reply(
    lines.length
      ? `Monthly expenses:\n${lines.join("\n")}\n\nTotal: $${total}`
      : "No expenses this month.",
  );
});

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
    await ctx.reply(`${budget.name} — detail:\n${lines}`);
  } else {
    const spent = await getPeriodSpent(budget.id, getPeriodStart());
    const remaining = budget.amount - spent;
    const days = daysUntilPayday();
    const dailyAllowance = Math.round(remaining / days);
    await ctx.reply(
      `${budget.name}\nRemaining: $${remaining}\nDays left: ${days}\n→ $${dailyAllowance}/day`,
    );
  }
});

bot.command("export", async (ctx) => {
  const [budgets, expenses] = await Promise.all([
    getBudgets(),
    getMonthlyExpensesWithDetails(),
  ]);

  const budgetMap = Object.fromEntries(
    budgets.map((b) => [b.id, { name: b.name, budget: b.amount }]),
  );

  const categoryTotals = {};
  for (const e of expenses) {
    categoryTotals[e.categoryId] = (categoryTotals[e.categoryId] ?? 0) + e.amount;
  }

  const total = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  const income = 4200;
  const saved = income - total;
  const savedPct = Math.round((saved / income) * 100);
  const spentPct = Math.round((total / income) * 100);
  const today = new Date();
  const daysLeft = daysUntilPayday();

  const categoryLines = Object.entries(categoryTotals)
    .sort(([, a], [, b]) => b - a)
    .map(([id, spent]) => {
      const { name = id, budget = 0 } = budgetMap[id] ?? {};
      const pctOfTotal = total > 0 ? Math.round((spent / total) * 100) : 0;
      const pctOfBudget = budget > 0 ? Math.round((spent / budget) * 100) : "?";
      const remaining = budget > 0 ? budget - spent : null;
      const remainingStr = remaining !== null ? `, resta $${remaining}` : "";
      return `- ${name}: $${spent} (${pctOfTotal}% del total, ${pctOfBudget}% del presupuesto${remainingStr})`;
    });

  const topExpenses = [...expenses]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((e) => {
      const name = budgetMap[e.categoryId]?.name ?? e.categoryId;
      return `- ${e.description} (${name}): $${e.amount}`;
    });

  const text =
    `📊 Gastos — ${today.toLocaleDateString("es-AR", { month: "long", year: "numeric" })}\n` +
    `Día ${today.getDate()} del mes · ${daysLeft} días hasta el próximo cobro\n\n` +
    `💰 Ingreso: $${income} | Gastado: $${total} (${spentPct}%) | Ahorrado: $${saved} (${savedPct}%)\n` +
    `Meta de ahorro: $300–500 USD para S&P500\n\n` +
    `Por categoría:\n${categoryLines.join("\n")}\n\n` +
    `Top gastos individuales:\n${topExpenses.join("\n")}`;

  await ctx.reply(text);
});

bot.command("new", async (ctx) => {
  const parts = ctx.match.trim().split(/\s+/);
  if (parts.length < 2) return ctx.reply("Usage: /new <name> <amount>");

  const amount = Number(parts[parts.length - 1]);
  if (isNaN(amount)) return ctx.reply("Amount must be a number.");

  const name = parts.slice(0, -1).join(" ");
  await createBudget(name, amount);
  await ctx.reply(`✓ Category '${name}' created with $${amount}`);
});

bot.on("message:text", async (ctx) => {
  try {
    const { description, amount, category } = parseMessage(ctx.message.text);

    const budgetId = await findBudgetId(category);
    if (!budgetId)
      return ctx.reply(
        `Categoría '${category}' no encontrada. Revisá /categorias.`,
      );

    await createExpense({ description, amount, budgetId });

    const totalToday = await getTotalSpentToday();
    await ctx.reply(`Cargado ✓\nLlevás $${totalToday} hoy`);
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

process.once("SIGINT", () => bot.stop());

bot.start();
