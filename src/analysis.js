import Groq from "groq-sdk";
import { getMonthlyExpensesWithDetails, getBudgets } from "./notion.js";
import { daysUntilPayday } from "./pay.js";

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

let lastConversation = null;

const SYSTEM_PROMPT = `Sos un asistente de finanzas personales. Tu objetivo es ayudar al usuario a ahorrar entre $300 y $500 USD por mes para invertir en S&P500.

Contexto del usuario: trabajador remoto (mezcla casa/coworking), con pareja, sin auto ni hijos. Ingreso mensual aproximado: $4200 USD.

Reglas de respuesta:
- Sé conciso y directo. Sin introducción, sin cierre, sin frases de relleno.
- Usá viñetas, no párrafos.
- Todos los montos están en USD.`;

const BREAKDOWN_FORMAT = `Respondé con este formato exacto:

**Categorías con mayor gasto:**
- [categoría]: $X (Y% del total)
- [categoría]: $X (Y% del total)
- [categoría]: $X (Y% del total)

**Gastos puntuales más altos:**
- [descripción] ([categoría]): $X
- [descripción] ([categoría]): $X
- [descripción] ([categoría]): $X

**Ritmo de gasto:**
[1 línea: si el ritmo es sostenible o no para lo que queda del período, con números concretos]`;

const IMPROVE_FORMAT = `Respondé con este formato exacto:

**Para ahorrar $300-500 USD este mes:**
- [consejo concreto con número]: ahorrás $X
- [consejo concreto con número]: ahorrás $X
- [consejo concreto con número]: ahorrás $X

**Resumen:** [1 línea con cuánto podrías ahorrar si aplicás los 3 consejos]`;

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
  const daysLeft = daysUntilPayday();

  const context =
    `Contexto: hoy es día ${today.getDate()} del mes, faltan ${daysLeft} días para el próximo cobro.\n\n` +
    `Gastos del mes actual:\n\nPor categoría:\n${categoryLines.join("\n")}\n\n` +
    `Total gastado: $${total}\n\nGastos individuales más altos:\n${topExpenses.join("\n")}`;

  const format = mode === "improve" ? IMPROVE_FORMAT : BREAKDOWN_FORMAT;

  const response = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 512,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${context}\n\n${format}` },
    ],
  });

  const text = response.choices[0].message.content;

  lastConversation = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: context },
    { role: "assistant", content: text },
  ];

  return text;
}

export async function askFollowUp(question) {
  if (!lastConversation) {
    const err = new Error("NO_CONTEXT");
    throw err;
  }

  const messages = [...lastConversation, { role: "user", content: question }];

  const response = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 512,
    messages,
  });

  const text = response.choices[0].message.content;
  lastConversation = [...messages, { role: "assistant", content: text }];
  return text;
}
