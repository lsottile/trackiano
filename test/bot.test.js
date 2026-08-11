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
  startBot,
} from '../src/bot.js';

test('bot startup preflight runs before construction and polling', async () => {
  const events = [];
  const started = startBot({
    preflight: () => events.push('preflight'),
    createBot: () => {
      events.push('construct');
      return { start: () => { events.push('poll'); return 'started'; }, stop: () => {} };
    },
  });
  assert.equal(started, 'started');
  assert.deepEqual(events, ['preflight', 'construct', 'poll']);
});

test('bot startup failure prevents construction and polling', () => {
  let constructed = false;
  assert.throws(() => startBot({
    preflight: () => { throw new Error('bad runtime'); },
    createBot: () => { constructed = true; },
  }), /bad runtime/);
  assert.equal(constructed, false);
});

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
    recategorizeExpenseAndLearn: async (...args) => updates.push(args),
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

test('returns safe delimiter guidance for ambiguous numeric category suffixes', async () => {
  const replies = [];
  await handleExpenseMessage({
    message: { text: 'snack 5 Category 2' },
    reply: async (message) => replies.push(message),
  });
  assert.deepEqual(replies, ['Use: {description} {amount} | {category}']);
});

test('explicit category skips learned lookup and provider inference', async () => {
  const calls = [];
  await handleExpenseMessage({ message: { text: 'hotel 50 Travel and Lodging' }, reply: async () => {} }, {
    findBudgetId: async (name) => { calls.push(`explicit:${name}`); return 'travel-id'; },
    findLearnedBudget: async () => calls.push('learned'),
    inferCategory: async () => calls.push('provider'),
    createExpenseAndGetTotalToday: async (expense) => {
      calls.push(`write:${expense.budgetId}`);
      return { expenseId: '11111111-1111-1111-1111-111111111111', totalToday: 50 };
    },
  });
  assert.deepEqual(calls, ['explicit:Travel and Lodging', 'write:travel-id']);
});

test('learned hit skips provider and uses the shared success reply', async () => {
  const calls = [];
  const replies = [];
  await handleExpenseMessage({ message: { text: '  Coffee\tShop 10' }, reply: async (...args) => replies.push(args) }, {
    findLearnedBudget: async (fingerprint) => { calls.push(`learned:${fingerprint}`); return { id: 'food-id', name: 'Food' }; },
    getBudgets: async () => { calls.push('budgets'); return []; },
    inferCategory: async () => { calls.push('provider'); return []; },
    createExpenseAndGetTotalToday: async (expense) => {
      calls.push(`write:${expense.budgetId}`);
      return { expenseId: '11111111-1111-1111-1111-111111111111', totalToday: 10 };
    },
  });
  assert.equal(calls[0], 'learned:c798e5b18ed876efb8a937d27a0c48de53e3735e490e2116701901e369d8b7d9');
  assert.deepEqual(calls.slice(1), ['write:food-id']);
  assert.match(replies[0][0], /Categoría: Food/);
});

test('learned miss falls through to one ranked provider call and writes the top accepted ID', async () => {
  const calls = [];
  await handleExpenseMessage({ message: { text: 'train 20' }, reply: async () => {} }, {
    findLearnedBudget: async () => { calls.push('learned'); return null; },
    getBudgets: async () => { calls.push('budgets'); return [{ id: 'transport-id', name: 'Transport' }]; },
    inferCategory: async () => { calls.push('provider'); return [{ budgetId: 'transport-id', categoryName: 'Transport', confidence: 0.7, reason: 'hidden' }]; },
    createExpenseAndGetTotalToday: async (expense) => {
      calls.push(`write:${expense.budgetId}`);
      return { expenseId: '11111111-1111-1111-1111-111111111111', totalToday: 20 };
    },
  });
  assert.deepEqual(calls, ['learned', 'budgets', 'provider', 'write:transport-id']);
});

test('default failure reporter emits only an exact structured coarse event', async () => {
  const output = [];
  const originalError = console.error;
  console.error = (message) => output.push(message);
  try {
    await handleExpenseMessage({
      message: { text: 'sensitive description 10' },
      reply: async () => {},
    }, {
      findLearnedBudget: async () => { throw new Error('secret'); },
    });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(output, ['{"operation":"learned_lookup","outcome":"failure"}']);
});

test('reports only coarse failure enums and ignores reporter failures', async () => {
  const cases = [
    {
      operation: 'learned_lookup',
      dependencies: { findLearnedBudget: async () => { throw new Error('secret'); } },
    },
    {
      operation: 'provider_lookup',
      dependencies: {
        findLearnedBudget: async () => null,
        getBudgets: async () => [{ id: 'private-id', name: 'Private category' }],
        inferCategory: async () => { throw new Error('secret'); },
      },
    },
    {
      operation: 'expense_write',
      dependencies: {
        findLearnedBudget: async () => ({ id: 'private-id', name: 'Private category' }),
        createExpenseAndGetTotalToday: async () => { throw new Error('secret'); },
      },
    },
  ];
  for (const { operation, dependencies } of cases) {
    const reports = [];
    const replies = [];
    await handleExpenseMessage({
      message: { text: 'sensitive description 10' },
      reply: async (message) => replies.push(message),
    }, {
      ...dependencies,
      reportOperation: async (report) => {
        reports.push(report);
        throw new Error('reporter unavailable');
      },
    });
    assert.deepEqual(reports, [{ operation, outcome: 'failure' }]);
    assert.equal(Object.keys(reports[0]).length, 2);
    assert.equal(replies.length, 1);
    assert.doesNotMatch(JSON.stringify(reports), /sensitive|secret|private|10|error/i);
  }
});

test('reports correction failures without changing the generic reply', async () => {
  const reports = [];
  const replies = [];
  const composer = new Composer();
  registerExpenseActionHandlers(composer, {
    getBudgets: async () => [{ id: '22222222-2222-2222-2222-222222222222', name: 'Private' }],
    recategorizeExpenseAndLearn: async () => { throw new Error('secret'); },
    reportOperation: async (report) => {
      reports.push(report);
      throw new Error('reporter unavailable');
    },
  });
  const data = encodeExpenseCallback(
    'set-category',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
  );
  await composer.middleware()({
    update: { callback_query: { data } }, callbackQuery: { data },
    answerCallbackQuery: async () => {}, reply: async (message) => replies.push(message),
  }, () => assert.fail('callback must short-circuit'));

  assert.deepEqual(reports, [{ operation: 'correction_write', outcome: 'failure' }]);
  assert.deepEqual(replies, ['No pude actualizar ese gasto. Probá de nuevo.']);
});

test('low confidence and provider failures reply safely without an expense write', async () => {
  for (const provider of [
    async () => [
      { budgetId: 'one', categoryName: 'Travel and Lodging', confidence: 0.6, reason: 'hidden' },
      { budgetId: 'two', categoryName: 'Travel', confidence: 0.5, reason: 'hidden' },
    ],
    async () => { throw new Error('timeout'); },
  ]) {
    const replies = [];
    let writes = 0;
    await handleExpenseMessage({ message: { text: 'hotel 50' }, reply: async (message) => replies.push(message) }, {
      findLearnedBudget: async () => null,
      getBudgets: async () => [{ id: 'one', name: 'Travel and Lodging' }, { id: 'two', name: 'Travel' }],
      inferCategory: provider,
      createExpenseAndGetTotalToday: async () => { writes += 1; },
      reportOperation: () => {},
    });
    assert.equal(writes, 0);
    assert.match(replies[0], /Reenviá|Mandalo/);
    assert.doesNotMatch(replies[0], /hidden/);
  }
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
