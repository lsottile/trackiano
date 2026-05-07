import 'dotenv/config';
import { Bot } from 'grammy';
import { parseMessage } from './parseMessage.js';
import {
  findBudgetId,
  createExpense,
  getBudgets,
  getMonthlyExpenses,
  getTotalSpentToday,
  getCategoryExpenses,
  createBudget,
} from './notion.js';
import { getPeriodStart, daysUntilPayday } from './pay.js';

const bot = new Bot(process.env.TELEGRAM_TOKEN);
const OWNER_ID = Number(process.env.TELEGRAM_OWNER_ID);

bot.use((ctx, next) => {
  if (ctx.from?.id !== OWNER_ID) return ctx.reply('Unauthorized');
  return next();
});

bot.command('help', async (ctx) => {
  await ctx.reply(
    `Comandos disponibles:\n\n` +
    `*Cargar gasto*\n` +
    `descripcion monto categoria\n\n` +
    `*Consultas*\n` +
    `/saldo <categoría> — saldo restante de una categoría\n` +
    `/budget <categoría> — cuánto podés gastar por día\n` +
    `/budget <categoría> detalle — lista de gastos del período\n` +
    `/resumen — todos los gastos del mes\n` +
    `/categorias — categorías disponibles\n\n` +
    `*Gestión*\n` +
    `/nueva <nombre> <monto> — crear nueva categoría`,
    { parse_mode: 'Markdown' }
  );
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

bot.command('budget', async (ctx) => {
  const parts = ctx.match.trim().split(/\s+/);
  if (!parts[0]) return ctx.reply('Uso: /budget <categoría> [detalle]');

  const isDetalle = parts[parts.length - 1] === 'detalle';
  const categoryName = isDetalle ? parts.slice(0, -1).join(' ') : parts.join(' ');

  const budgets = await getBudgets();
  const budget = budgets.find((b) => b.name.toLowerCase() === categoryName.toLowerCase());
  if (!budget) return ctx.reply(`Categoría '${categoryName}' no encontrada.`);

  if (isDetalle) {
    const expenses = await getCategoryExpenses(budget.id, getPeriodStart());
    if (!expenses.length) return ctx.reply(`Sin gastos en ${budget.name} este período.`);
    const lines = expenses.map((e) => `• ${e.description} — $${e.amount}`).join('\n');
    await ctx.reply(`${budget.name} — detalle:\n${lines}`);
  } else {
    const days = daysUntilPayday();
    const dailyAllowance = Math.round(budget.remaining / days);
    await ctx.reply(`${budget.name}\nRestante: $${budget.remaining}\nFaltan: ${days} días\n→ $${dailyAllowance}/día`);
  }
});

bot.command('nueva', async (ctx) => {
  const parts = ctx.match.trim().split(/\s+/);
  if (parts.length < 2) return ctx.reply('Uso: /nueva <nombre> <monto>');

  const amount = Number(parts[parts.length - 1]);
  if (isNaN(amount)) return ctx.reply('El monto tiene que ser un número.');

  const name = parts.slice(0, -1).join(' ');
  await createBudget(name, amount);
  await ctx.reply(`✓ Categoría '${name}' creada con $${amount}`);
});

bot.on('message:text', async (ctx) => {
  try {
    const { description, amount, category } = parseMessage(ctx.message.text);

    const budgetId = await findBudgetId(category);
    if (!budgetId) return ctx.reply(`Categoría '${category}' no encontrada. Revisá /categorias.`);

    await createExpense({ description, amount, budgetId });

    const totalToday = await getTotalSpentToday();
    await ctx.reply(`Cargado ✓\nLlevás $${totalToday} hoy`);
  } catch (err) {
    if (err.message.startsWith('Format:') || err.message.includes('is not a valid amount')) {
      return ctx.reply(err.message);
    }
    return ctx.reply('Something went wrong, try again.');
  }
});

process.once('SIGINT', () => bot.stop());

bot.start();
