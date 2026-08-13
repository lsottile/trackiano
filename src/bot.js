import "dotenv/config";
import { pathToFileURL } from "node:url";
import { Bot, Composer } from "grammy";
import { inferCategory, selectTopCandidate } from "./inferCategory.js";
import { parseMessage } from "./parseMessage.js";
import { fingerprintDescription } from "./descriptionFingerprint.js";
import {
  buildLowConfidenceReply,
  GENERIC_SAFE_CATEGORY_RESPONSE,
} from "./categoryResponses.js";
import {
  findBudgetId,
  createFinancialEntryAndGetBalances,
  createPaydayAndGetBalances,
  getBudgets,
  getMonthlyExpenses,
  getMonthlyExpenseDetails,
  getCategoryExpenses,
  getPeriodSpent,
  createBudget,
  deleteExpense,
  findLearnedBudget,
  recategorizeExpenseAndLearn,
} from "./storage.js";
import { formatMoney, roundMoney } from "./money.js";
import { getPeriodStart, daysUntilPayday } from "./pay.js";
import { formatMonthlySummary, formatVerboseMonthlySummary } from "./summary.js";
import { handleTargetCommand } from "./target.js";
import { assertRuntimeAndBackend, assertRuntimeEnvironment } from "./runtimeConfig.js";

const isDirectExecution = Boolean(
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href,
);
if (isDirectExecution) { assertRuntimeAndBackend(); assertRuntimeEnvironment(); }

const OWNER_ID = Number(process.env.TELEGRAM_OWNER_ID);
const bot = new Composer();

function defaultOperationReporter({ operation }) {
  console.error(JSON.stringify({ operation, outcome: "failure" }));
}

async function reportFailure(reporter, operation) {
  try {
    await reporter({ operation, outcome: "failure" });
  } catch {
    // Operational reporting must never affect user-safe behavior.
  }
}

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
  recategorizeExpenseAndLearn: changeExpenseBudget = recategorizeExpenseAndLearn,
  reportOperation = defaultOperationReporter,
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
      try {
        await changeExpenseBudget(callback.expenseId, budget.id);
      } catch {
        await reportFailure(reportOperation, "correction_write");
        return ctx.reply("No pude actualizar ese gasto. Probá de nuevo.");
      }
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

function balanceReply({ dailyBalance, monthlyBalance, payBalance }) {
  return `Saldo diario: $${formatMoney(dailyBalance)}\nSaldo del mes: $${formatMoney(monthlyBalance)}` +
    `\nSaldo desde cobro: $${formatMoney(payBalance)}`;
}

export function registerNewPeriodHandler(composer, { ownerId = OWNER_ID } = {}) {
  return composer.command("nuevo_mes", (ctx) => {
    if (ctx.from?.id !== ownerId) return ctx.reply("Unauthorized");
    return ctx.reply("Usá /cobre <monto> <detalle> para registrar el cobro.");
  });
}

export function registerPaydayHandler(composer, {
  ownerId = OWNER_ID,
  collectPayday = createPaydayAndGetBalances,
} = {}) {
  return composer.command("cobre", async (ctx) => {
    if (ctx.from?.id !== ownerId) return ctx.reply("Unauthorized");
    const [amountToken = "", ...descriptionParts] = ctx.match.trim().split(/\s+/);
    const amount = Number(amountToken);
    const description = descriptionParts.join(" ");
    if (!/^\+?(?:\d+(?:\.\d+)?|\.\d+)$/.test(amountToken) ||
        !Number.isFinite(amount) || amount <= 0 || roundMoney(amount) <= 0 || !description) {
      return ctx.reply("Usá /cobre <monto positivo> <detalle>.");
    }
    const updateId = ctx.update?.update_id;
    if (!Number.isSafeInteger(updateId)) {
      return ctx.reply("No pude identificar el comando. Probá de nuevo.");
    }
    const requestKey = `telegram-update:${updateId}`;
    let result;
    try {
      result = await collectPayday({ requestKey, amount: roundMoney(amount), description });
    } catch {
      return ctx.reply("No pude registrar el cobro. Probá de nuevo.");
    }
    return ctx.reply(balanceReply(result));
  });
}

bot.use((ctx, next) => {
  if (ctx.from?.id !== OWNER_ID) return ctx.reply("Unauthorized");
  return next();
});
registerExpenseActionHandlers(bot);
registerNewPeriodHandler(bot);
registerPaydayHandler(bot);

bot.command("help", async (ctx) => {
  return ctx.reply(
    `Available commands:\n\n` +
      `*Log expense*\n` +
      `amount description (preferred)\n` +
      `description amount [category]\n\n` +
      `*Log income*\n` +
      `/cobre <amount> <description> — payday (preferred); +amount — manual income\n\n` +
      `*Queries*\n` +
      `/balance <category> — remaining balance for a category\n` +
      `/budget <category> — how much you can spend per day\n` +
      `/budget <category> detail — expense list for the current period\n` +
      `/summary — all expenses this month\n` +
      `/summary-complete — monthly summary with top expenses\n` +
      `/target [amount] — show or set the recurring daily target\n` +
      `/categories — available categories\n\n` +
      `*Management*\n` +
      `/nuevo_mes — guidance for the payday command\n` +
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
  findLearnedBudget: readLearnedBudget = findLearnedBudget,
  getBudgets: readBudgets = getBudgets,
  inferCategory: categorize = inferCategory,
  selectTopCandidate: selectCandidate = selectTopCandidate,
  createFinancialEntryAndGetBalances: writeEntry = createFinancialEntryAndGetBalances,
  reportOperation = defaultOperationReporter,
} = {}) {
  try {
    if (/^\/[A-Za-z0-9_]+(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(ctx.message.text)) {
      return ctx.reply("Unknown command.");
    }
    const parsed = parseMessage(ctx.message.text);
    const { description, category } = parsed;
    const amount = roundMoney(parsed.amount);
    const type = parsed.type ?? "expense";
    let budgetId = null;

    if (type === "expense") {
      if (category) {
        budgetId = await readBudgetId(category);
        if (!budgetId) {
          return ctx.reply(
            `Categoría '${category}' no encontrada. Revisá /categories.`,
          );
        }
      } else {
        const fingerprint = fingerprintDescription(description);
        let learnedBudget;
        try {
          learnedBudget = await readLearnedBudget(fingerprint);
        } catch {
          await reportFailure(reportOperation, "learned_lookup");
          return ctx.reply(GENERIC_SAFE_CATEGORY_RESPONSE);
        }
        if (learnedBudget) {
          budgetId = learnedBudget.id;
        } else {
          const budgets = await readBudgets();
          let candidates;
          try {
            candidates = await categorize({ description, amount, budgets });
          } catch {
            await reportFailure(reportOperation, "provider_lookup");
            return ctx.reply(GENERIC_SAFE_CATEGORY_RESPONSE);
          }

          const candidate = selectCandidate(candidates);
          if (!candidate) {
            return ctx.reply(buildLowConfidenceReply({
              originalText: ctx.message.text,
              candidates,
            }));
          }
          budgetId = candidate.budgetId;
        }
      }
    }

    let result;
    try {
      result = await writeEntry({ description, amount, budgetId, type });
    } catch {
      await reportFailure(reportOperation, "expense_write");
      return ctx.reply("Something went wrong, try again.");
    }
    const buttons = type === "income"
      ? [{
        text: "Eliminar",
        callback_data: encodeExpenseCallback("delete", result.expenseId),
      }]
      : [
        {
          text: "Cambiar",
          callback_data: encodeExpenseCallback("recategorize", result.expenseId),
        },
        {
          text: "Eliminar",
          callback_data: encodeExpenseCallback("delete", result.expenseId),
        },
      ];
    return ctx.reply(balanceReply(result), {
      reply_markup: { inline_keyboard: [buttons] },
    });
  } catch (err) {
    if (
      err.message.startsWith("Format:") ||
      err.message.startsWith("Use:") ||
      err.message.includes("is not a valid amount") ||
      err.message === "Income amount must round to at least $0.01."
    ) {
      return ctx.reply(err.message);
    }
    return ctx.reply("Something went wrong, try again.");
  }
}

bot.on("message:text", handleExpenseMessage);

export function startBot({
  preflight = () => { assertRuntimeAndBackend(); assertRuntimeEnvironment(); },
  createBot = () => {
    const applicationBot = new Bot(process.env.TELEGRAM_TOKEN);
    applicationBot.use(bot);
    return applicationBot;
  },
} = {}) {
  preflight();
  const bot = createBot();
  process.once("SIGINT", () => bot.stop());
  process.once("SIGTERM", () => bot.stop());
  return bot.start();
}

if (isDirectExecution) startBot();
