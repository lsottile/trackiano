import assert from 'node:assert/strict';
import test from 'node:test';
import { Composer } from 'grammy';

import {
  decodeExpenseCallback,
  encodeExpenseCallback,
  handleBudget,
  handleExpenseMessage,
  registerCompleteSummaryHandler,
  registerExpenseActionHandlers,
} from '../src/bot.js';

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
    'Monthly expenses:\n• Food: $5.00 · 100% ██████████\n\nTotal: $5.00\n\n' +
      'Top expenses:\nFood:\n  • Coffee: $5.00',
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

test('logs a Telegram expense rounded to cents with exact action buttons', async () => {
  const replies = [];
  const writes = [];
  await handleExpenseMessage({
    message: { text: 'coffee 10.005 Food' },
    reply: async (...args) => replies.push(args),
  }, {
    findBudgetId: async () => '11111111-1111-1111-1111-111111111111',
    createExpenseAndGetTotalToday: async (expense) => {
      writes.push(expense);
      return {
        expenseId: '22222222-2222-2222-2222-222222222222',
        totalToday: 12.345,
      };
    },
  });

  assert.equal(writes[0].amount, 10.01);
  assert.equal(replies[0][0], 'Cargado ✓\nLlevás $12.35 hoy');
  assert.deepEqual(
    replies[0][1].reply_markup.inline_keyboard.flat().map((button) => button.text),
    ['Cambiar', 'Eliminar'],
  );
  assert.ok(replies[0][1].reply_markup.inline_keyboard.flat().every(
    (button) => decodeExpenseCallback(button.callback_data)?.expenseId ===
      '22222222-2222-2222-2222-222222222222',
  ));
});

test('recategorizes the exact Telegram expense through inline category buttons', async () => {
  const expenseId = '11111111-1111-1111-1111-111111111111';
  const budgetId = '22222222-2222-2222-2222-222222222222';
  const replies = [];
  const updates = [];
  const composer = new Composer();
  registerExpenseActionHandlers(composer, {
    getBudgets: async () => [{ id: budgetId, name: 'Inversiones' }],
    updateExpenseBudget: async (...args) => updates.push(args),
  });

  await composer.middleware()({
    update: { callback_query: { data: encodeExpenseCallback('recategorize', expenseId) } },
    callbackQuery: { data: encodeExpenseCallback('recategorize', expenseId) },
    answerCallbackQuery: async () => {},
    reply: async (...args) => replies.push(args),
  }, () => assert.fail('expense callback must short-circuit'));

  const categoryCallback = replies[0][1].reply_markup.inline_keyboard[0][0].callback_data;
  assert.deepEqual(decodeExpenseCallback(categoryCallback), {
    action: 'set-category', expenseId, budgetId,
  });

  await composer.middleware()({
    update: { callback_query: { data: categoryCallback } },
    callbackQuery: { data: categoryCallback },
    answerCallbackQuery: async () => {},
    reply: async (...args) => replies.push(args),
  }, () => assert.fail('category callback must short-circuit'));

  assert.deepEqual(updates, [[expenseId, budgetId]]);
  assert.equal(replies[1][0], 'Categoría actualizada a Inversiones ✓');
});

test('deletes the exact Telegram expense through its inline button', async () => {
  const expenseId = '11111111-1111-1111-1111-111111111111';
  const deleted = [];
  const replies = [];
  const composer = new Composer();
  registerExpenseActionHandlers(composer, {
    deleteExpense: async (id) => deleted.push(id),
  });
  const callbackQuery = { data: encodeExpenseCallback('delete', expenseId) };

  await composer.middleware()({
    update: { callback_query: callbackQuery },
    callbackQuery,
    answerCallbackQuery: async () => {},
    reply: async (message) => replies.push(message),
  }, () => assert.fail('delete callback must short-circuit'));

  assert.deepEqual(deleted, [expenseId]);
  assert.deepEqual(replies, ['Gasto eliminado ✓']);
});
