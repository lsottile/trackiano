import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateTargetComparison,
  formatAutomaticSummary,
  formatMonthlySummary,
} from '../src/summary.js';

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

test('calculates a weekly target from seven recurring daily targets', () => {
  assert.deepEqual(calculateTargetComparison(560, 70, 7), {
    target: 490,
    difference: 70,
    result: 'over',
  });
});

test('calculates a monthly target from every day in leap February', () => {
  assert.deepEqual(calculateTargetComparison(2000, 70, 29), {
    target: 2030,
    difference: 30,
    result: 'under',
  });
});

test('formats a closed weekly range with its inclusive Sunday and target', () => {
  const message = formatAutomaticSummary({
    periodType: 'weekly',
    period: {
      start: '2026-07-20',
      end: '2026-07-27',
      days: 7,
    },
    budgets: [{ id: 'food', name: 'Food' }],
    totals: { food: 400 },
    dailyTarget: 70,
  });

  assert.equal(
    message,
    'Weekly spending summary\n' +
      '2026-07-20 to 2026-07-26\n\n' +
      '• Food: $400\n\n' +
      'Total: $400\n' +
      'Target: $490\n' +
      '$90 under target',
  );
});
