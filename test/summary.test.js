import assert from 'node:assert/strict';
import test from 'node:test';

import { formatMonthlySummary } from '../src/summary.js';

test('formats the current month summary by descending spend with percentages and bars', () => {
  const message = formatMonthlySummary(
    [
      { id: 'budget-food', name: 'Food' },
      { id: 'budget-housing', name: 'Housing' },
      { id: 'budget-transport', name: 'Transport' },
    ],
    {
      'budget-transport': 10,
      'budget-food': 60,
      'budget-housing': 30,
    },
  );

  assert.equal(
    message,
    'Monthly expenses:\n' +
      '• Food: $60 · 60% ██████░░░░\n' +
      '• Housing: $30 · 30% ███░░░░░░░\n' +
      '• Transport: $10 · 10% █░░░░░░░░░\n\n' +
      'Total: $100',
  );
});

test('preserves the empty current month message', () => {
  assert.equal(formatMonthlySummary([], {}), 'No expenses this month.');
});
