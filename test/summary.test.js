import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateTargetComparison,
  formatAutomaticSummary,
  formatMonthlySummary,
  formatVerboseMonthlySummary,
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
      '• Food: $60.00 · 60% ██████░░░░\n' +
      '• Housing: $30.00 · 30% ███░░░░░░░\n' +
      '• Transport: $10.00 · 10% █░░░░░░░░░\n\n' +
      'Total: $100.00',
  );
});

test('preserves the empty current month message', () => {
  assert.equal(formatMonthlySummary([], {}), 'No expenses this month.');
  assert.equal(formatVerboseMonthlySummary([], []), 'No expenses this month.');
});

test('formats all displayed amounts to cents and percentages to whole numbers', () => {
  const monthly = formatMonthlySummary(
    [{ id: 'food', name: 'Food' }, { id: 'travel', name: 'Travel' }],
    { food: 10.5, travel: 4.25 },
  );
  const automatic = formatAutomaticSummary({
    periodType: 'weekly',
    period: { start: '2026-07-20', end: '2026-07-27', days: 7 },
    budgets: [{ id: 'food', name: 'Food' }],
    totals: { food: 10.5 },
    dailyTarget: 1.5,
  });

  assert.match(monthly, /Food: \$10\.50 · 71%/);
  assert.match(monthly, /Travel: \$4\.25 · 29%/);
  assert.match(automatic, /Food: \$10\.50/);
  assert.match(automatic, /Total: \$10\.50\nTarget: \$10\.50\nOn target/);
});

test('keeps cent amounts consistent with the displayed total', () => {
  const budgets = [{ id: 'food', name: 'Food' }, { id: 'travel', name: 'Travel' }];
  const totals = { food: 0.5, travel: 0.5 };

  assert.equal(
    formatMonthlySummary(budgets, totals),
    'Monthly expenses:\n' +
      '• Food: $0.50 · 50% █████░░░░░\n' +
      '• Travel: $0.50 · 50% █████░░░░░\n\n' +
      'Total: $1.00',
  );
  assert.match(
    formatAutomaticSummary({
      periodType: 'weekly',
      period: { start: '2026-07-20', end: '2026-07-27', days: 7 },
      budgets,
      totals,
      dailyTarget: 0,
    }),
    /Food: \$0\.50\n• Travel: \$0\.50\n\nTotal: \$1\.00/,
  );
});

test('formats verbose summaries with the two largest expenses per category', () => {
  const message = formatVerboseMonthlySummary(
    [{ id: 'food', name: 'Food' }, { id: 'travel', name: 'Travel' }],
    [
      { id: '3', budgetId: 'food', description: 'Coffee', amount: 5 },
      { id: '2', budgetId: 'food', description: 'Dinner', amount: 20 },
      { id: '1', budgetId: 'food', description: 'Breakfast', amount: 20 },
      { id: '4', budgetId: 'travel', description: 'Bus', amount: 7.5 },
    ],
  );

  assert.equal(
    message,
    'Monthly expenses:\n' +
      '• Food: $45.00 · 86% █████████░\n' +
      '• Travel: $7.50 · 14% █░░░░░░░░░\n\n' +
      'Total: $52.50\n\n' +
      'Top expenses:\n' +
      'Food:\n' +
      '  • Breakfast: $20.00\n' +
      '  • Dinner: $20.00\n' +
      'Travel:\n' +
      '  • Bus: $7.50',
  );
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
      '• Food: $400.00\n\n' +
      'Total: $400.00\n' +
      'Target: $490.00\n' +
      '$90.00 under target',
  );
});
