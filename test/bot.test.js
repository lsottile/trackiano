import assert from 'node:assert/strict';
import test from 'node:test';
import { Composer } from 'grammy';

import { handleBudget, registerCompleteSummaryHandler } from '../src/bot.js';

test('/budget detail returns usage without reading budgets', async () => {
  const replies = [];
  let getBudgetsCalled = false;

  await handleBudget({
    match: 'detail',
    reply: (message) => {
      replies.push(message);
      return 'replied';
    },
  }, {
    getBudgets: async () => {
      getBudgetsCalled = true;
      return [];
    },
  });

  assert.equal(replies[0], 'Usage: /budget <category> [detail]');
  assert.equal(getBudgetsCalled, false);
});

test('handles only the exact summary-complete message with the verbose summary', async () => {
  const replies = [];
  const composer = new Composer();
  registerCompleteSummaryHandler(composer, {
    getBudgets: async () => [{ id: 'food', name: 'Food' }],
    getMonthlyExpenseDetails: async () => [{
      id: 'coffee', budgetId: 'food', description: 'Coffee', amount: 5,
    }],
  });

  await composer.middleware()({
    update: { message: { text: '/summary-complete' } },
    message: { text: '/summary-complete' },
    reply: (message) => {
      replies.push(message);
      return 'replied';
    },
  }, () => assert.fail('exact command must short-circuit the generic text handler'));

  assert.equal(
    replies[0],
    'Monthly expenses:\n• Food: $5 · 100% ██████████\n\nTotal: $5\n\n' +
      'Top expenses:\nFood:\n  • Coffee: $5',
  );

  let continued = false;
  await composer.middleware()({
    update: { message: { text: '/summary-complete extra' } },
    message: { text: '/summary-complete extra' },
  }, () => {
    continued = true;
  });
  assert.equal(continued, true);
});
