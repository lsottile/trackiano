import assert from 'node:assert/strict';
import test from 'node:test';
import { Composer } from 'grammy';

import {
  createMerchantSelectionPromptSender,
  decodeExtraordinaryExpenseCallback,
  decodeExpenseCallback,
  decodeMerchantCallback,
  encodeExpenseCallback,
  encodeMerchantCallback,
  handleBudget,
  handleDashboardCommand,
  handleExpenseMessage,
  handleWeeklyAverage,
  processPendingMerchant,
  registerExpenseActionHandlers,
  registerMerchantMappingHandlers,
  registerExtraordinaryExpenseConfirmationHandlers,
  startBot,
} from '../src/bot.js';

test('bot startup preflight runs before construction and polling', async () => {
  const events = [];
  const started = await startBot({
    preflight: () => events.push('preflight'),
    createBot: () => {
      events.push('construct');
      return { start: () => { events.push('poll'); return 'started'; }, stop: () => {} };
    },
  });
  assert.equal(started, 'started');
  assert.deepEqual(events, ['preflight', 'construct', 'poll']);
});

test('bot startup failure prevents construction and polling', async () => {
  let constructed = false;
  await assert.rejects(startBot({
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

test('/dashboard opens the configured web app', async () => {
  const replies = [];
  await handleDashboardCommand({
    reply: (...args) => replies.push(args),
  }, {
    webAppUrl: 'https://trackiano.example.com/app',
  });

  assert.equal(replies[0][0], 'Open the dashboard: https://trackiano.example.com/app');
});

test('/average excludes individual expenses above its optional cap', async () => {
  const replies = [];
  const calls = [];
  await handleWeeklyAverage({
    match: '100',
    reply: (message) => replies.push(message),
  }, {
    getExpensesInRange: async (...args) => {
      calls.push(args);
      return { food: 280, transport: 140 };
    },
    getTrailingWeeklyPeriod: () => ({
      start: '2026-08-18', end: '2026-08-25', days: 7,
    }),
  });

  assert.deepEqual(calls, [['2026-08-18', '2026-08-25', { maxAmount: 100 }]]);
  assert.match(replies[0], /Promedio: \$60\.00\/día/);
  assert.match(replies[0], /Sin gastos mayores a \$100\.00/);
});

test('/average rejects an invalid cap without reading expenses', async () => {
  let readExpenses = false;
  const replies = [];
  await handleWeeklyAverage({
    match: '100 extra',
    reply: (message) => replies.push(message),
  }, {
    getExpensesInRange: async () => { readExpenses = true; },
  });

  assert.equal(replies[0], 'Usage: /average [maximum per expense]');
  assert.equal(readExpenses, false);
});

test('logs a Telegram expense rounded to cents with exact action buttons', async () => {
  const replies = [];
  const writes = [];
  await handleExpenseMessage({
    message: { text: '10.005 coffee | Food' },
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
    ['Cambiar categoría', 'Marcar como extraordinario', 'Eliminar'],
  );
  assert.ok(replies[0][1].reply_markup.inline_keyboard.flat().every(
    (button) => {
      const callback = decodeExpenseCallback(button.callback_data);
      return callback?.expenseId === '22222222-2222-2222-2222-222222222222';
    },
  ));
});

test('marks Investments regardless of capitalization extraordinary without confirmation', async () => {
  const writes = [];
  const replies = [];

  await handleExpenseMessage({
    message: { text: '200 index fund | investments' },
    reply: async (...args) => replies.push(args),
  }, {
    findBudgetId: async () => '11111111-1111-1111-1111-111111111111',
    createExpenseAndGetTotalToday: async (expense) => {
      writes.push(expense);
      return { expenseId: '22222222-2222-2222-2222-222222222222', totalToday: 0 };
    },
  });

  assert.deepEqual(writes, [{
    description: 'Index fund',
    amount: 200,
    budgetId: '11111111-1111-1111-1111-111111111111',
    isExtraordinary: true,
  }]);
  assert.match(replies[0][0], /Cargado/);
  assert.deepEqual(
    replies[0][1].reply_markup.inline_keyboard.flat().map((button) => button.text),
    ['Cambiar categoría', 'Eliminar'],
  );
});

test('asks before persisting a non-Investments expense above the extraordinary suggestion threshold', async () => {
  const writes = [];
  const replies = [];
  const composer = new Composer();
  registerExtraordinaryExpenseConfirmationHandlers(composer, {
    createExpenseAndGetTotalToday: async (expense) => {
      writes.push(expense);
      return { expenseId: '22222222-2222-2222-2222-222222222222', totalToday: 0 };
    },
  });

  await handleExpenseMessage({
    message: { text: '151 hotel | Travel' },
    reply: async (...args) => replies.push(args),
  }, {
    findBudgetId: async () => '11111111-1111-1111-1111-111111111111',
  });

  assert.equal(writes.length, 0);
  assert.deepEqual(
    replies[0][1].reply_markup.inline_keyboard.flat().map((button) => button.text),
    ['Sí', 'No'],
  );
  const callback = replies[0][1].reply_markup.inline_keyboard[0][0].callback_data;
  assert.equal(decodeExtraordinaryExpenseCallback(callback)?.action, 'confirm');

  await composer.middleware()({
    update: { callback_query: { data: callback } },
    callbackQuery: { data: callback },
    answerCallbackQuery: async () => {},
    reply: async (...args) => replies.push(args),
  }, () => assert.fail('extraordinary confirmation must short-circuit'));

  assert.deepEqual(writes, [{
    description: 'Hotel',
    amount: 151,
    budgetId: '11111111-1111-1111-1111-111111111111',
    isExtraordinary: true,
  }]);
  assert.deepEqual(
    replies[1][1].reply_markup.inline_keyboard.flat().map((button) => button.text),
    ['Cambiar categoría', 'Eliminar'],
  );
});

test('persists a confirmed ordinary expense without marking it extraordinary', async () => {
  const writes = [];
  const replies = [];
  const composer = new Composer();
  registerExtraordinaryExpenseConfirmationHandlers(composer, {
    createExpenseAndGetTotalToday: async (expense) => {
      writes.push(expense);
      return { expenseId: '22222222-2222-2222-2222-222222222222', totalToday: 151 };
    },
  });

  await handleExpenseMessage({
    message: { text: '151 hotel | Travel' },
    reply: async (...args) => replies.push(args),
  }, {
    findBudgetId: async () => '11111111-1111-1111-1111-111111111111',
  });
  const callback = replies[0][1].reply_markup.inline_keyboard[0][1].callback_data;

  await composer.middleware()({
    update: { callback_query: { data: callback } },
    callbackQuery: { data: callback },
    answerCallbackQuery: async () => {},
    reply: async () => {},
  }, () => assert.fail('ordinary confirmation must short-circuit'));

  assert.deepEqual(writes, [{
    description: 'Hotel',
    amount: 151,
    budgetId: '11111111-1111-1111-1111-111111111111',
    isExtraordinary: false,
  }]);
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

test('returns safe delimiter guidance for malformed delimited input', async () => {
  const replies = [];
  await handleExpenseMessage({
    message: { text: '5 snack | Category 2 |' },
    reply: async (message) => replies.push(message),
  });
  assert.deepEqual(replies, ['Use: {amount} {description} | {category}']);
});

test('explicit category skips learned lookup and provider inference', async () => {
  const calls = [];
  await handleExpenseMessage({ message: { text: '50 hotel | Travel and Lodging' }, reply: async () => {} }, {
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
  await handleExpenseMessage({ message: { text: '  10\tCoffee Shop' }, reply: async (...args) => replies.push(args) }, {
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
  await handleExpenseMessage({ message: { text: '20 train' }, reply: async () => {} }, {
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
      message: { text: '10 sensitive description' },
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
      message: { text: '10 sensitive description' },
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
    await handleExpenseMessage({ message: { text: '50 hotel' }, reply: async (message) => replies.push(message) }, {
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

test('marks the exact active Telegram expense extraordinary through its inline button', async () => {
  const expenseId = '11111111-1111-1111-1111-111111111111';
  const marked = [];
  const replies = [];
  const replyMarkupUpdates = [];
  const composer = new Composer();
  registerExpenseActionHandlers(composer, {
    markExpenseExtraordinary: async (id) => marked.push(id),
  });
  const callbackQuery = { data: encodeExpenseCallback('mark-extraordinary', expenseId) };

  await composer.middleware()({
    update: { callback_query: callbackQuery },
    callbackQuery,
    answerCallbackQuery: async () => {},
    editMessageReplyMarkup: async (options) => replyMarkupUpdates.push(options),
    reply: async (message) => replies.push(message),
  }, () => assert.fail('extraordinary callback must short-circuit'));

  assert.deepEqual(marked, [expenseId]);
  assert.deepEqual(replyMarkupUpdates, [{
    reply_markup: {
      inline_keyboard: [[
        {
          text: 'Cambiar categoría',
          callback_data: encodeExpenseCallback('recategorize', expenseId),
        },
        {
          text: 'Eliminar',
          callback_data: encodeExpenseCallback('delete', expenseId),
        },
      ]],
    },
  }]);
  assert.deepEqual(replies, ['Gasto marcado como extraordinario ✓']);
});

test('encodes merchant callback data below Telegrams 64-byte limit', () => {
  const data = encodeMerchantCallback(
    'select',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
  );
  assert.ok(Buffer.byteLength(data) <= 64);
  assert.deepEqual(decodeMerchantCallback(data), {
    action: 'select',
    sourceId: '11111111-1111-1111-1111-111111111111',
    budgetId: '22222222-2222-2222-2222-222222222222',
  });
});

test('rejects malformed merchant callback data', () => {
  assert.equal(decodeMerchantCallback('tm.select.not-a-uuid'), null);
  assert.equal(decodeMerchantCallback(encodeMerchantCallback(
    'review',
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
  )), null);
  assert.deepEqual(decodeMerchantCallback(encodeMerchantCallback(
    'cancel',
    '11111111-1111-1111-1111-111111111111',
  )), {
    action: 'cancel',
    sourceId: '11111111-1111-1111-1111-111111111111',
    budgetId: null,
  });
});

test('renders an unknown merchant prompt from all current live budgets', async () => {
  const sent = [];
  const prompt = createMerchantSelectionPromptSender({
    ownerId: 42,
    getBudgets: async () => [
      { id: '11111111-1111-1111-1111-111111111111', name: 'Coffee & Snacks' },
      { id: '22222222-2222-2222-2222-222222222222', name: 'Entertainment' },
      { id: '33333333-3333-3333-3333-333333333333', name: 'Restaurants' },
    ],
    sendMessage: async (...args) => { sent.push(args); },
  });

  await prompt({
    id: '44444444-4444-4444-4444-444444444444',
    merchant: 'ARTISTA DE CAFE',
    status: 'pending',
  });

  assert.match(sent[0][1], /ARTISTA DE CAFE/);
  assert.deepEqual(
    sent[0][2].reply_markup.inline_keyboard.flat().map((button) => button.text),
    ['Coffee & Snacks', 'Entertainment', 'Restaurants', 'Cancel'],
  );
  assert.equal(sent[0][2].reply_markup.inline_keyboard.length, 3);
  assert.equal(sent[0][2].reply_markup.inline_keyboard[0].length, 2);
  assert.equal(sent[0][2].reply_markup.inline_keyboard[2][0].text, 'Cancel');
});

test('saves the mapping before processing every pending purchase for that merchant', async () => {
  const events = [];
  const result = await processPendingMerchant('ARTISTA DE CAFE', 'coffee', {
    saveMerchantMapping: async () => { events.push('mapping'); },
    getPendingIngestionsByMerchant: async () => [
      { id: 'pending-1', ingestId: 'takenos:1', description: 'Artista de Cafe', amount: 10 },
      { id: 'pending-2', ingestId: 'takenos:2', description: 'ARTISTA DE CAFE', amount: 20 },
    ],
    createExpenseIfNew: async (expense) => {
      events.push(`expense:${expense.ingestId}`);
      return {
        created: expense.ingestId === 'takenos:1',
        expenseId: expense.ingestId === 'takenos:1' ? 'expense-1' : null,
      };
    },
    markPendingIngestionProcessed: async (id) => { events.push(`processed:${id}`); },
  });
  assert.deepEqual(events, [
    'mapping', 'expense:takenos:1', 'processed:pending-1',
    'expense:takenos:2', 'processed:pending-2',
  ]);
  assert.deepEqual(result, { created: 1, duplicates: 1 });
});

test('books a pending purchase on its original purchase date', async () => {
  const purchaseDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  const written = [];
  await processPendingMerchant('ARTISTA DE CAFE', 'coffee', {
    saveMerchantMapping: async () => {},
    getPendingIngestionsByMerchant: async () => [
      { id: 'pending-1', ingestId: 'takenos:1', description: 'Artista', amount: 10, createdAt: purchaseDate },
    ],
    createExpenseIfNew: async (expense) => {
      written.push(expense);
      return { created: true, expenseId: 'expense-1' };
    },
    markPendingIngestionProcessed: async () => {},
  });
  assert.equal(written.length, 1);
  assert.equal(written[0].now, purchaseDate);
});

test('leaves a row pending if its expense write fails', async () => {
  let marked = false;
  await assert.rejects(processPendingMerchant('ARTISTA DE CAFE', 'coffee', {
    saveMerchantMapping: async () => {},
    getPendingIngestionsByMerchant: async () => [
      { id: 'pending-1', ingestId: 'takenos:1', description: 'Artista', amount: 10 },
    ],
    createExpenseIfNew: async () => { throw new Error('Storage unavailable'); },
    markPendingIngestionProcessed: async () => { marked = true; },
  }), /Storage unavailable/);
  assert.equal(marked, false);
});

test('selects a live budget and processes the pending merchant end-to-end', async () => {
  const replies = [];
  const events = [];
  const composer = new Composer();
  registerMerchantMappingHandlers(composer, {
    getPendingIngestion: async () => ({
      id: '11111111-1111-1111-1111-111111111111',
      merchant: 'ARTISTA DE CAFE',
      status: 'pending',
    }),
    getBudgets: async () => [
      { id: '22222222-2222-2222-2222-222222222222', name: 'Coffee & Snacks' },
      { id: '33333333-3333-3333-3333-333333333333', name: 'Entertainment' },
    ],
    saveMerchantMapping: async (merchant, budgetId) => {
      events.push(`mapping:${merchant}:${budgetId}`);
    },
    getPendingIngestionsByMerchant: async () => [
      { id: 'pending-1', ingestId: 'takenos:1', description: 'Artista de Cafe', amount: 10 },
    ],
    createExpenseIfNew: async (expense) => {
      events.push(`expense:${expense.ingestId}`);
      return { created: true, expenseId: 'expense-1' };
    },
    markPendingIngestionProcessed: async (id) => { events.push(`processed:${id}`); },
  });
  const callbackQuery = {
    data: encodeMerchantCallback(
      'select',
      '11111111-1111-1111-1111-111111111111',
      '33333333-3333-3333-3333-333333333333',
    ),
  };
  await composer.middleware()({
    update: { callback_query: callbackQuery },
    callbackQuery,
    answerCallbackQuery: async () => {},
    reply: async (text) => replies.push(text),
  }, () => assert.fail('select callback must short-circuit'));
  assert.deepEqual(events, [
    'mapping:ARTISTA DE CAFE:33333333-3333-3333-3333-333333333333',
    'expense:takenos:1',
    'processed:pending-1',
  ]);
  assert.match(replies[0], /Mapped ARTISTA DE CAFE; processed 1 pending purchase\(s\)\./);
});

test('cancel callback deletes the pending ingestion without mapping or expense writes', async () => {
  const pendingId = '11111111-1111-1111-1111-111111111111';
  const replies = [];
  const events = [];
  const composer = new Composer();
  registerMerchantMappingHandlers(composer, {
    getPendingIngestion: async (id) => id === pendingId ? {
      id: pendingId, merchant: 'ARTISTA DE CAFE', status: 'pending',
    } : null,
    cancelPendingIngestion: async (id) => events.push(`cancel:${id}`),
    saveMerchantMapping: async () => events.push('mapping'),
    processPendingMerchant: async () => events.push('process'),
  });
  const callbackQuery = { data: encodeMerchantCallback('cancel', pendingId) };

  await composer.middleware()({
    update: { callback_query: callbackQuery },
    callbackQuery,
    answerCallbackQuery: async () => {},
    reply: async (text) => replies.push(text),
  }, () => assert.fail('cancel callback must short-circuit'));

  assert.deepEqual(events, [`cancel:${pendingId}`]);
  assert.deepEqual(replies, ['Pending purchase discarded.']);
});

test('cancel callback rejects stale pending rows without deleting or processing', async () => {
  const replies = [];
  const composer = new Composer();
  registerMerchantMappingHandlers(composer, {
    getPendingIngestion: async () => ({
      id: '11111111-1111-1111-1111-111111111111',
      merchant: 'ARTISTA DE CAFE',
      status: 'processed',
    }),
    cancelPendingIngestion: async () => assert.fail('must not delete stale row'),
    processPendingMerchant: async () => assert.fail('must not process stale row'),
  });
  const callbackQuery = {
    data: encodeMerchantCallback(
      'cancel',
      '11111111-1111-1111-1111-111111111111',
    ),
  };

  await composer.middleware()({
    update: { callback_query: callbackQuery },
    callbackQuery,
    answerCallbackQuery: async () => {},
    reply: async (text) => replies.push(text),
  }, () => {});

  assert.match(replies[0], /no longer available/i);
});

test('rejects a stale selected budget without changing mapping or pending rows', async () => {
  const replies = [];
  const composer = new Composer();
  registerMerchantMappingHandlers(composer, {
    getPendingIngestion: async () => ({
      id: '11111111-1111-1111-1111-111111111111',
      merchant: 'ARTISTA DE CAFE',
      status: 'pending',
    }),
    getBudgets: async () => [{
      id: '22222222-2222-2222-2222-222222222222', name: 'Coffee & Snacks',
    }],
    processPendingMerchant: async () => assert.fail('must not process stale budget'),
  });
  const callbackQuery = {
    data: encodeMerchantCallback(
      'select',
      '11111111-1111-1111-1111-111111111111',
      '33333333-3333-3333-3333-333333333333',
    ),
  };
  await composer.middleware()({
    update: { callback_query: callbackQuery },
    callbackQuery,
    answerCallbackQuery: async () => {},
    reply: async (text) => replies.push(text),
  }, () => {});
  assert.match(replies[0], /no longer available/i);
});

test('rejects an already-processed pending row without writing again', async () => {
  const replies = [];
  const composer = new Composer();
  registerMerchantMappingHandlers(composer, {
    getPendingIngestion: async () => ({
      id: '11111111-1111-1111-1111-111111111111',
      merchant: 'ARTISTA DE CAFE',
      status: 'processed',
    }),
    getBudgets: async () => [{
      id: '22222222-2222-2222-2222-222222222222', name: 'Coffee & Snacks',
    }],
    processPendingMerchant: async () => assert.fail('must not reprocess a handled row'),
  });
  const callbackQuery = {
    data: encodeMerchantCallback(
      'select',
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ),
  };
  await composer.middleware()({
    update: { callback_query: callbackQuery },
    callbackQuery,
    answerCallbackQuery: async () => {},
    reply: async (text) => replies.push(text),
  }, () => {});
  assert.match(replies[0], /no longer available/i);
});

test('reports pending merchant processing failures', async () => {
  const replies = [];
  const reports = [];
  const composer = new Composer();
  registerMerchantMappingHandlers(composer, {
    getPendingIngestion: async () => ({
      id: '11111111-1111-1111-1111-111111111111',
      merchant: 'ARTISTA DE CAFE',
      status: 'pending',
    }),
    getBudgets: async () => [{
      id: '22222222-2222-2222-2222-222222222222', name: 'Coffee & Snacks',
    }],
    processPendingMerchant: async () => { throw new Error('Storage unavailable'); },
    reportOperation: async (report) => { reports.push(report); },
  });
  const callbackQuery = {
    data: encodeMerchantCallback(
      'select',
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ),
  };
  await composer.middleware()({
    update: { callback_query: callbackQuery },
    callbackQuery,
    answerCallbackQuery: async () => {},
    reply: async (text) => replies.push(text),
  }, () => {});
  assert.match(replies[0], /failed/i);
  assert.deepEqual(reports, [{ operation: 'pending_merchant_processing', outcome: 'failure' }]);
});

test('a non-owner mapping callback replies Unauthorized before any storage access', async () => {
  const replies = [];
  const composer = new Composer();
  composer.use((ctx, next) => {
    if (ctx.from?.id !== 42) return ctx.reply('Unauthorized');
    return next();
  });
  registerMerchantMappingHandlers(composer, {
    getPendingIngestion: async () => assert.fail('must not read storage'),
  });
  await composer.middleware()({
    callbackQuery: {
      data: encodeMerchantCallback(
        'select',
        '11111111-1111-1111-1111-111111111111',
        '22222222-2222-2222-2222-222222222222',
      ),
    },
    from: { id: 7 },
    reply: async (text) => replies.push(text),
  }, () => assert.fail('authorization must short-circuit callback handlers'));
  assert.deepEqual(replies, ['Unauthorized']);
});

test('a non-owner cancel callback replies Unauthorized before any storage access', async () => {
  const replies = [];
  const composer = new Composer();
  composer.use((ctx, next) => {
    if (ctx.from?.id !== 42) return ctx.reply('Unauthorized');
    return next();
  });
  registerMerchantMappingHandlers(composer, {
    getPendingIngestion: async () => assert.fail('must not read storage'),
    cancelPendingIngestion: async () => assert.fail('must not delete storage'),
  });
  await composer.middleware()({
    callbackQuery: {
      data: encodeMerchantCallback(
        'cancel',
        '11111111-1111-1111-1111-111111111111',
      ),
    },
    from: { id: 7 },
    reply: async (text) => replies.push(text),
  }, () => assert.fail('authorization must short-circuit callback handlers'));
  assert.deepEqual(replies, ['Unauthorized']);
});
