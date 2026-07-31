const BAR_WIDTH = 10;

function roundDisplay(value) {
  return Math.round(value);
}

function allocateDisplayAmounts(entries, total) {
  const amounts = entries.map(([id, amount], index) => ({
    id,
    amount: Math.floor(amount),
    remainder: amount - Math.floor(amount),
    index,
  }));
  const remaining = roundDisplay(total) - amounts.reduce((sum, { amount }) => sum + amount, 0);

  amounts.sort((first, second) => second.remainder - first.remainder || first.index - second.index);
  for (let index = 0; index < remaining; index += 1) amounts[index].amount += 1;
  return Object.fromEntries(amounts.map(({ id, amount }) => [id, amount]));
}

function compareAmountsThenNames([firstId, firstAmount], [secondId, secondAmount], budgetMap) {
  return secondAmount - firstAmount ||
    (budgetMap[firstId] ?? firstId).localeCompare(budgetMap[secondId] ?? secondId);
}

export function calculateTargetComparison(spent, dailyTarget, days) {
  const target = dailyTarget * days;
  const difference = Math.abs(target - spent);
  const result = spent === target ? 'on' : spent > target ? 'over' : 'under';
  return { target, difference, result };
}

export function formatAutomaticSummary({
  periodType,
  period,
  budgets,
  totals,
  dailyTarget,
}) {
  const budgetMap = Object.fromEntries(budgets.map((budget) => [budget.id, budget.name]));
  const entries = Object.entries(totals).sort((first, second) =>
    compareAmountsThenNames(first, second, budgetMap),
  );
  const spent = entries.reduce((sum, [, amount]) => sum + amount, 0);
  const displayAmounts = allocateDisplayAmounts(entries, spent);
  const comparison = calculateTargetComparison(spent, dailyTarget, period.days);
  const categoryLines = entries.length
    ? entries.map(([id]) => `• ${budgetMap[id] ?? id}: $${displayAmounts[id]}`).join('\n')
    : 'No expenses.';
  const resultLine = comparison.result === 'on'
    ? 'On target'
    : `$${roundDisplay(comparison.difference)} ${comparison.result} target`;
  const title = periodType === 'weekly'
    ? 'Weekly spending summary'
    : 'Monthly spending summary';
  const inclusiveEnd = new Date(`${period.end}T00:00:00.000Z`);
  inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
  const inclusiveEndDate = inclusiveEnd.toISOString().slice(0, 10);

  return `${title}\n${period.start} to ${inclusiveEndDate}\n\n` +
    `${categoryLines}\n\nTotal: $${roundDisplay(spent)}\nTarget: $${roundDisplay(comparison.target)}\n${resultLine}`;
}

export function formatMonthlySummary(budgets, totals) {
  const budgetMap = Object.fromEntries(budgets.map((budget) => [budget.id, budget.name]));
  const entries = Object.entries(totals).sort((first, second) =>
    compareAmountsThenNames(first, second, budgetMap),
  );
  if (!entries.length) return 'No expenses this month.';

  const total = entries.reduce((sum, [, spent]) => sum + spent, 0);
  const displayAmounts = allocateDisplayAmounts(entries, total);
  const lines = entries.map(([id, spent]) => {
    const percentage = total > 0 ? (spent / total) * 100 : 0;
    const filledSegments = Math.round((percentage / 100) * BAR_WIDTH);
    const bar = '█'.repeat(filledSegments) + '░'.repeat(BAR_WIDTH - filledSegments);
    return `• ${budgetMap[id] ?? id}: $${displayAmounts[id]} · ${roundDisplay(percentage)}% ${bar}`;
  });

  return `Monthly expenses:\n${lines.join('\n')}\n\nTotal: $${roundDisplay(total)}`;
}

export function formatVerboseMonthlySummary(budgets, expenses) {
  const totals = {};
  for (const expense of expenses) {
    totals[expense.budgetId] = (totals[expense.budgetId] ?? 0) + expense.amount;
  }
  const summary = formatMonthlySummary(budgets, totals);
  if (!expenses.length) return summary;

  const budgetMap = Object.fromEntries(budgets.map((budget) => [budget.id, budget.name]));
  const categories = Object.keys(totals).sort((first, second) =>
    totals[second] - totals[first] ||
    (budgetMap[first] ?? first).localeCompare(budgetMap[second] ?? second),
  );
  const details = categories.map((categoryId) => {
    const topExpenses = expenses
      .filter((expense) => expense.budgetId === categoryId)
      .sort((first, second) =>
        second.amount - first.amount ||
        first.description.localeCompare(second.description) ||
        first.id.localeCompare(second.id),
      )
      .slice(0, 2)
      .map((expense) => `  • ${expense.description}: $${roundDisplay(expense.amount)}`);
    return `${budgetMap[categoryId] ?? categoryId}:\n${topExpenses.join('\n')}`;
  });

  return `${summary}\n\nTop expenses:\n${details.join('\n')}`;
}
