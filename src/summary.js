const BAR_WIDTH = 10;

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
