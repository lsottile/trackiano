import Anthropic from "@anthropic-ai/sdk";
import { getMonthlyExpensesWithDetails, getBudgets } from "./notion.js";
import { daysUntilPayday } from "./pay.js";

const client = new Anthropic();

const BASE_PROMPT =
  "Sos un asistente de finanzas personales. Analizás gastos mensuales y dás consejos concretos. Respondé siempre en español, de forma clara y concisa. No más de 3 párrafos cortos.";

const SYSTEM_PROMPT = process.env.USER_CONTEXT
  ? `${BASE_PROMPT}\n\nContexto del usuario: ${process.env.USER_CONTEXT}`
  : BASE_PROMPT;

export async function analyzeExpenses(mode = "breakdown") {
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
    .slice(0, 5)
    .map((e) => {
      const name = budgetMap[e.categoryId]?.name ?? e.categoryId;
      return `- ${e.description} (${name}): $${e.amount}`;
    });

  const today = new Date();
  const dayOfMonth = today.getDate();
  const daysLeft = daysUntilPayday();

  const context =
    `Contexto: hoy es día ${dayOfMonth} del mes, faltan ${daysLeft} días para el próximo cobro.\n\n` +
    `Gastos del mes actual:\n\nPor categoría:\n${categoryLines.join("\n")}\n\n` +
    `Total gastado: $${total}\n\nGastos individuales más altos:\n${topExpenses.join("\n")}`;

  const instruction =
    mode === "improve"
      ? "Con base en estos datos, dá 3 consejos concretos y específicos para ahorrar el mes que viene. Indicá en qué categorías o gastos puntuales hay margen real de ahorro y cuánto se podría ahorrar aproximadamente."
      : "Analizá brevemente la distribución. Destacá qué categorías pesan más, cuáles gastos puntuales son los más altos, y si el ritmo de gasto es sostenible para lo que queda del período.";

  const message = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 512,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `${context}\n\n${instruction}`,
      },
    ],
  });

  return message.content[0].text;
}
