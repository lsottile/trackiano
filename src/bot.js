import 'dotenv/config';
import { Bot } from 'grammy';
import { parseMessage } from './parseMessage.js';
import { findBudgetId, createExpense, getBudgets, getMonthlyExpenses } from './notion.js';

const bot = new Bot(process.env.TELEGRAM_TOKEN);
const OWNER_ID = Number(process.env.TELEGRAM_OWNER_ID);

bot.use((ctx, next) => {
  if (ctx.from?.id !== OWNER_ID) {
    return ctx.reply('Unauthorized');
  }
  return next();
});

bot.command('categorias', async (ctx) => {
  const budgets = await getBudgets();
  const lines = budgets.map((b) => `• ${b.name}`).join('\n');
  await ctx.reply(`Categorías disponibles:\n${lines}`);
});

bot.command('saldo', async (ctx) => {
  const category = ctx.match.trim();
  if (!category) return ctx.reply('Uso: /saldo <categoría>');

  const budgets = await getBudgets();
  const budget = budgets.find((b) => b.name.toLowerCase() === category.toLowerCase());
  if (!budget) return ctx.reply(`Categoría '${category}' no encontrada.`);

  await ctx.reply(`${budget.name}\nPresupuesto: $${budget.amount}\nGastado: $${budget.totalSpent}\nRestante: $${budget.remaining}`);
});

bot.command('resumen', async (ctx) => {
  const [budgets, totals] = await Promise.all([getBudgets(), getMonthlyExpenses()]);
  const budgetMap = Object.fromEntries(budgets.map((b) => [b.id, b.name]));

  const lines = Object.entries(totals).map(([id, spent]) => {
    const name = budgetMap[id] ?? id;
    return `• ${name}: $${spent}`;
  });

  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  await ctx.reply(lines.length ? `Gastos del mes:\n${lines.join('\n')}\n\nTotal: $${total}` : 'Sin gastos este mes.');
});

bot.on('message:text', async (ctx) => {
  try {
    const { description, amount, category } = parseMessage(ctx.message.text);

    const budgetId = await findBudgetId(category);
    if (!budgetId) {
      return ctx.reply(`Category '${category}' not found. Available: check your Notion budgets.`);
    }

    await createExpense({ description, amount, budgetId });
    await ctx.reply(`✓ ${description} — $${amount} → ${category}`);
  } catch (err) {
    if (err.message.startsWith('Format:') || err.message.includes('is not a valid amount')) {
      return ctx.reply(err.message);
    }
    return ctx.reply('Something went wrong, try again.');
  }
});

process.once('SIGINT', () => bot.stop());

bot.start();
