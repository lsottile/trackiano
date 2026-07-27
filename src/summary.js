const BAR_WIDTH = 10;

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
  const entries = Object.entries(totals).sort(([, first], [, second]) => second - first);
  const spent = entries.reduce((sum, [, amount]) => sum + amount, 0);
  const comparison = calculateTargetComparison(spent, dailyTarget, period.days);
  const categoryLines = entries.length
    ? entries.map(([id, amount]) => `• ${budgetMap[id] ?? id}: $${amount}`).join('\n')
    : 'No expenses.';
  const resultLine = comparison.result === 'on'
    ? 'On target'
    : `$${comparison.difference} ${comparison.result} target`;
  const title = periodType === 'weekly'
    ? 'Weekly spending summary'
    : 'Monthly spending summary';
  const inclusiveEnd = new Date(`${period.end}T00:00:00.000Z`);
  inclusiveEnd.setUTCDate(inclusiveEnd.getUTCDate() - 1);
  const inclusiveEndDate = inclusiveEnd.toISOString().slice(0, 10);

  return `${title}\n${period.start} to ${inclusiveEndDate}\n\n` +
    `${categoryLines}\n\nTotal: $${spent}\nTarget: $${comparison.target}\n${resultLine}`;
}

export function formatMonthlySummary(budgets, totals) {
  const entries = Object.entries(totals).sort(([, first], [, second]) => second - first);
  if (!entries.length) return 'No expenses this month.';

  const budgetMap = Object.fromEntries(budgets.map((budget) => [budget.id, budget.name]));
  const total = entries.reduce((sum, [, spent]) => sum + spent, 0);
  const lines = entries.map(([id, spent]) => {
    const percentage = total > 0 ? (spent / total) * 100 : 0;
    const filledSegments = Math.round((percentage / 100) * BAR_WIDTH);
    const bar = '█'.repeat(filledSegments) + '░'.repeat(BAR_WIDTH - filledSegments);
    const percentageLabel = Number(percentage.toFixed(1));
    return `• ${budgetMap[id] ?? id}: $${spent} · ${percentageLabel}% ${bar}`;
  });

  return `Monthly expenses:\n${lines.join('\n')}\n\nTotal: $${total}`;
}
