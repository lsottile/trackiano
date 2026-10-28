import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import test from 'node:test';

import { createIngestServer, normalizeMerchant, parseTakenosPurchase } from '../src/ingest.js';

const takenosPackage = 'com.takenos.app';
const sample = {
  packageName: takenosPackage,
  title: 'Compraste con tu Takecar...',
  body: 'Se realizó un pago exitoso de 20,27 USD en ARTISTA DE CAFE',
  id: '0|com.takenos.app|42|null|10234',
};
const unknownSample = {
  ...sample,
  body: 'Se realizó un pago exitoso de 20,27 USD en COOL HUNTING SRL',
};

async function withServer(overrides, run) {
  const server = createIngestServer({
    token: 'test-token',
    takenosPackage,
    findActiveMerchantMapping: async () => ({
      id: 'mapping-1', merchant: 'ARTISTA DE CAFE', budgetId: 'food',
    }),
    getBudgets: async () => [
      { id: 'food', name: 'Food' },
      { id: 'coffee', name: 'Coffee & Snacks' },
      { id: 'shopping', name: 'Shopping' },
      { id: 'transport', name: 'Transport' },
    ],
    ...overrides,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function post(url, payload) {
  return fetch(`${url}/ingest/takenos`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

async function postEmail(url, payload) {
  return fetch(`${url}/ingest/takenos/email`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
}

function request(url, { headers, body }) {
  return fetch(`${url}/ingest/takenos`, {
    method: 'POST',
    headers,
    body,
  });
}

function streamedRequestWithoutContentLength(url, body) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(`${url}/ingest/takenos`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        responseBody += chunk;
      });
      response.on('end', () => {
        resolve({ status: response.statusCode, body: JSON.parse(responseBody) });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

function payloadJsonOfByteLength(bytes) {
  const payload = { ...sample, padding: '' };
  payload.padding = 'x'.repeat(bytes - Buffer.byteLength(JSON.stringify(payload)));
  const body = JSON.stringify(payload);
  assert.equal(Buffer.byteLength(body), bytes);
  return body;
}

test('normalizes only accents and whitespace before mapping lookup', () => {
  assert.equal(normalizeMerchant('  Artista   de Café '), 'ARTISTA DE CAFE');
  assert.equal(normalizeMerchant('Café-Bar #2'), 'CAFE-BAR #2');
});

test('creates a mapped Takenos expense without invoking inference', async () => {
  const written = [];
  await withServer({
    findActiveMerchantMapping: async (merchant) => {
      assert.equal(merchant, 'ARTISTA DE CAFE');
      return { id: 'mapping-1', merchant, budgetId: 'coffee' };
    },
    createIngestedExpenseAndGetTotalToday: async (expense) => {
      written.push(expense);
      return { created: true, expenseId: 'expense-1' };
    },
  }, async (url) => {
    const response = await post(url, {
      ...sample,
      body: 'Se realizó un pago exitoso de 20,27 USD en  Artista de Café ',
    });
    assert.equal(response.status, 201);
  });
  assert.deepEqual(written, [{
    description: 'Artista de Café',
    amount: 20.27,
    budgetId: 'coffee',
    ingestId: 'takenos:0|com.takenos.app|42|null|10234',
  }]);
});

test('creates a mapped expense from an authenticated Takenos email', async () => {
  const written = [];
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    createIngestedExpenseAndGetTotalToday: async (expense) => {
      written.push(expense);
      return { created: true, expenseId: 'expense-1' };
    },
  }, async (url) => {
    const response = await postEmail(url, {
      id: '18f0a1b2c3d4e5f6',
      from: 'Takenos <notifications@takenos.com>',
      subject: 'Tu compra con Takecard fue aprobada',
      text: [
        'Hola Luciano,',
        'Se realizó un pago exitoso de 20,27 USD en Artista de Café',
        'Podés revisar el movimiento en la app.',
      ].join('\n'),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { status: 'created' });
  });
  assert.deepEqual(written, [{
    description: 'Artista de Café',
    amount: 20.27,
    budgetId: 'food',
    ingestId: 'takenos:email:18f0a1b2c3d4e5f6',
  }]);
});

test('creates a USD expense from the current Takenos card payment email', async () => {
  const written = [];
  await withServer({
    takenosEmailSender: 'noreply@takenos.com',
    findActiveMerchantMapping: async (merchant) => {
      assert.equal(merchant, 'COOL HUNTING SRL');
      return { id: 'mapping-1', merchant, budgetId: 'shopping' };
    },
    createIngestedExpenseAndGetTotalToday: async (expense) => {
      written.push(expense);
      return { created: true, expenseId: 'expense-1' };
    },
  }, async (url) => {
    const response = await postEmail(url, {
      id: '18f0a1b2c3d4e5f8',
      from: 'Takenos <noreply@takenos.com>',
      subject: '¡Se procesó un pago de COOL HUNTING SRL! 🌮',
      text: [
        'Se realizó un pago con tarjeta',
        'Realizaste un pago exitoso en COOL HUNTING SRL',
        '- Pagaste: $6200 ARS',
        '- Se debitaron: $4,39 USD de tu saldo',
        '- Comercio: COOL HUNTING SRL',
        '- Tarjeta: ****1106',
      ].join('\n'),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { status: 'created' });
  });
  assert.deepEqual(written, [{
    description: 'COOL HUNTING SRL',
    amount: 4.39,
    budgetId: 'shopping',
    ingestId: 'takenos:email:18f0a1b2c3d4e5f8',
  }]);
});

test('prefers an exact merchant mapping over an obvious family rule', async () => {
  const written = [];
  const notified = [];
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    findActiveMerchantMapping: async () => ({ budgetId: 'shopping' }),
    getBudgets: async () => [
      { id: 'shopping', name: 'Shopping' },
      { id: 'transport', name: 'Transport' },
    ],
    createIngestedExpenseAndGetTotalToday: async (expense) => {
      written.push(expense);
      return { created: true, expenseId: 'expense-1', totalToday: 22.5 };
    },
    notifyExpenseCreated: async (expense) => { notified.push(expense); },
    createPendingIngestionIfNew: async () => assert.fail('exact mapping must not create a pending row'),
  }, async (url) => {
    const response = await postEmail(url, {
      id: 'mapped-uber-1',
      from: 'Takenos <notifications@takenos.com>',
      subject: 'Compra aprobada',
      text: 'Se realizó un pago exitoso de 12,50 USD en UBER-PAY',
    });
    assert.equal(response.status, 201);
  });

  assert.equal(written[0].budgetId, 'shopping');
  assert.equal(notified[0].budgetName, 'Shopping');
});

test('classifies an obvious merchant family without prompting', async () => {
  const written = [];
  const notified = [];
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    findActiveMerchantMapping: async () => null,
    getBudgets: async () => [{ id: 'transport', name: 'Transport' }],
    createIngestedExpenseAndGetTotalToday: async (expense) => {
      written.push(expense);
      return { created: true, expenseId: 'expense-1', totalToday: 32.5 };
    },
    createPendingIngestionIfNew: async () => assert.fail('family rule must not create a pending row'),
    requestMerchantSelection: async () => assert.fail('family rule must not prompt'),
    notifyExpenseCreated: async (expense) => { notified.push(expense); },
  }, async (url) => {
    const response = await postEmail(url, {
      id: 'rule-uber-1',
      from: 'Takenos <notifications@takenos.com>',
      subject: 'Compra aprobada',
      text: 'Se realizó un pago exitoso de 12,50 USD en UBER-PAY',
    });
    assert.equal(response.status, 201);
  });

  assert.equal(written[0].budgetId, 'transport');
  assert.deepEqual(notified, [{
    expenseId: 'expense-1',
    description: 'UBER-PAY',
    amount: 12.5,
    budgetName: 'Transport',
    totalToday: 32.5,
  }]);
});

test('prompts when an obvious family destination is not a live budget', async () => {
  const prompts = [];
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    findActiveMerchantMapping: async () => null,
    getBudgets: async () => [{ id: 'food', name: 'Food' }],
    createIngestedExpenseAndGetTotalToday: async () => assert.fail('missing destination must not write'),
    createPendingIngestionIfNew: async (pending) => ({
      created: true,
      row: { id: 'pending-1', ...pending, status: 'pending' },
    }),
    requestMerchantSelection: async (pending) => { prompts.push(pending); },
  }, async (url) => {
    const response = await postEmail(url, {
      id: 'rule-uber-2',
      from: 'Takenos <notifications@takenos.com>',
      subject: 'Compra aprobada',
      text: 'Se realizó un pago exitoso de 12,50 USD en UBER-PAY',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { status: 'pending' });
  });

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].ingestId, 'takenos:email:rule-uber-2');
});

test('creates one independent category prompt for each unknown email', async () => {
  const prompts = [];
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    findActiveMerchantMapping: async () => null,
    getBudgets: async () => [],
    createPendingIngestionIfNew: async (pending) => ({
      created: true,
      row: { id: `pending-${pending.ingestId}`, ...pending, status: 'pending' },
    }),
    requestMerchantSelection: async (pending) => { prompts.push(pending); },
  }, async (url) => {
    for (const id of ['unknown-1', 'unknown-2']) {
      const response = await postEmail(url, {
        id,
        from: 'Takenos <notifications@takenos.com>',
        subject: 'Compra aprobada',
        text: `Se realizó un pago exitoso de 10,00 USD en COMERCIO ${id}`,
      });
      assert.equal(response.status, 202);
    }
  });

  assert.deepEqual(
    prompts.map(({ ingestId }) => ingestId),
    ['takenos:email:unknown-1', 'takenos:email:unknown-2'],
  );
});

test('confirms each known email with an increasing daily total', async () => {
  const notifications = [];
  let writes = 0;
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    createIngestedExpenseAndGetTotalToday: async () => {
      writes += 1;
      return {
        created: true,
        expenseId: `expense-${writes}`,
        totalToday: writes * 10,
      };
    },
    notifyExpenseCreated: async (expense) => { notifications.push(expense); },
  }, async (url) => {
    for (const id of ['known-1', 'known-2']) {
      const response = await postEmail(url, {
        id,
        from: 'Takenos <notifications@takenos.com>',
        subject: 'Compra aprobada',
        text: 'Se realizó un pago exitoso de 10,00 USD en ARTISTA DE CAFE',
      });
      assert.equal(response.status, 201);
    }
  });

  assert.deepEqual(notifications.map(({ totalToday }) => totalToday), [10, 20]);
  assert.deepEqual(notifications.map(({ expenseId }) => expenseId), ['expense-1', 'expense-2']);
});

test('does not notify a duplicate email delivery', async () => {
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    createIngestedExpenseAndGetTotalToday: async () => ({
      created: false,
      expenseId: null,
      totalToday: null,
    }),
    notifyExpenseCreated: async () => assert.fail('duplicate must not notify'),
  }, async (url) => {
    const response = await postEmail(url, {
      id: 'duplicate-1',
      from: 'Takenos <notifications@takenos.com>',
      subject: 'Compra aprobada',
      text: 'Se realizó un pago exitoso de 10,00 USD en ARTISTA DE CAFE',
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'duplicate' });
  });
});

test('keeps a created email accepted when its Telegram confirmation fails', async () => {
  const reports = [];
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    createIngestedExpenseAndGetTotalToday: async () => ({
      created: true,
      expenseId: 'expense-1',
      totalToday: 10,
    }),
    notifyExpenseCreated: async () => { throw new Error('Telegram unavailable'); },
    reportOperation: async (event) => { reports.push(event); },
  }, async (url) => {
    const response = await postEmail(url, {
      id: 'notify-failure-1',
      from: 'Takenos <notifications@takenos.com>',
      subject: 'Compra aprobada',
      text: 'Se realizó un pago exitoso de 10,00 USD en ARTISTA DE CAFE',
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { status: 'created' });
  });

  assert.deepEqual(reports, [{ operation: 'ingested_expense_notification', outcome: 'failure' }]);
});

test('ignores email from a sender other than the configured Takenos address', async () => {
  let writes = 0;
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    createIngestedExpenseAndGetTotalToday: async () => {
      writes += 1;
      return { created: true, expenseId: 'expense-1' };
    },
  }, async (url) => {
    const response = await postEmail(url, {
      id: '18f0a1b2c3d4e5f6',
      from: 'Attacker <other@example.com>',
      subject: 'Tu compra con Takecard fue aprobada',
      text: 'Se realizó un pago exitoso de 20,27 USD en Artista de Café',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      status: 'ignored', reason: 'unsupported_source',
    });
  });
  assert.equal(writes, 0);
});

test('accepts a Takenos email body larger than an Android notification payload', async () => {
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    createIngestedExpenseAndGetTotalToday: async () => ({ created: true, expenseId: 'expense-1' }),
  }, async (url) => {
    const response = await postEmail(url, {
      id: '18f0a1b2c3d4e5f6',
      from: 'Takenos <notifications@takenos.com>',
      subject: 'Tu compra con Takecard fue aprobada',
      text: `${'x'.repeat(5000)}\nSe realizó un pago exitoso de 20,27 USD en Artista de Café`,
    });
    assert.equal(response.status, 201);
  });
});

test('parses a Takenos purchase when the email wraps the payment details', async () => {
  const written = [];
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
    createIngestedExpenseAndGetTotalToday: async (expense) => {
      written.push(expense);
      return { created: true, expenseId: 'expense-1' };
    },
  }, async (url) => {
    const response = await postEmail(url, {
      id: '18f0a1b2c3d4e5f7',
      from: 'Takenos <notifications@takenos.com>',
      subject: 'Tu compra con Takecard fue aprobada',
      text: [
        'Se realizó un pago exitoso de',
        '1.234,56 USD',
        'en Artista de Café',
        '',
        'Podés revisar el movimiento en la app.',
      ].join('\n'),
    });
    assert.equal(response.status, 201);
  });
  assert.deepEqual(written, [{
    description: 'Artista de Café',
    amount: 1234.56,
    budgetId: 'food',
    ingestId: 'takenos:email:18f0a1b2c3d4e5f7',
  }]);
});

test('rejects a Takenos email payload larger than 64 KiB', async () => {
  await withServer({
    takenosEmailSender: 'notifications@takenos.com',
  }, async (url) => {
    const response = await postEmail(url, {
      id: '18f0a1b2c3d4e5f6',
      from: 'Takenos <notifications@takenos.com>',
      subject: 'Tu compra con Takecard fue aprobada',
      text: 'x'.repeat(70 * 1024),
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: 'Payload too large' });
  });
});

test('persists an unknown purchase before requesting the owner selection', async () => {
  const events = [];
  await withServer({
    findActiveMerchantMapping: async () => null,
    createPendingIngestionIfNew: async () => {
      events.push('persist');
      return {
        created: true,
        row: { id: 'pending-1', merchant: 'COOL HUNTING SRL', status: 'pending' },
      };
    },
    requestMerchantSelection: async () => { events.push('prompt'); },
  }, async (url) => {
    assert.equal((await post(url, unknownSample)).status, 202);
  });
  assert.deepEqual(events, ['persist', 'prompt']);
});

test('returns pending and logs context when the durable row exists but Telegram prompting fails', async () => {
  const errors = [];
  const originalError = console.error;
  console.error = (message) => errors.push(message);
  try {
    await withServer({
      findActiveMerchantMapping: async () => null,
      createPendingIngestionIfNew: async () => ({
        created: true,
        row: { id: 'pending-1', merchant: 'COOL HUNTING SRL', status: 'pending' },
      }),
      requestMerchantSelection: async () => { throw new Error('Telegram unavailable'); },
    }, async (url) => {
      assert.equal((await post(url, unknownSample)).status, 202);
    });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(errors, [JSON.stringify({
    operation: 'merchant_selection_prompt',
    outcome: 'failure',
    merchant: 'COOL HUNTING SRL',
    ingestId: 'takenos:0|com.takenos.app|42|null|10234',
  })]);
});

test('returns 500 and does not prompt when durable pending persistence fails', async () => {
  let prompted = false;
  await withServer({
    findActiveMerchantMapping: async () => null,
    createPendingIngestionIfNew: async () => { throw new Error('Storage unavailable'); },
    requestMerchantSelection: async () => { prompted = true; },
  }, async (url) => assert.equal((await post(url, unknownSample)).status, 500));
  assert.equal(prompted, false);
});

test('does not prompt a duplicate pending row that has already been processed', async () => {
  let prompts = 0;
  await withServer({
    findActiveMerchantMapping: async () => null,
    createPendingIngestionIfNew: async () => ({
      created: false,
      row: { id: 'pending-1', merchant: 'COOL HUNTING SRL', status: 'processed' },
    }),
    requestMerchantSelection: async () => { prompts += 1; },
  }, async (url) => assert.equal((await post(url, unknownSample)).status, 202));
  assert.equal(prompts, 0);
});

test('does not re-prompt when a still-pending notification is redelivered', async () => {
  let pendingCreates = 0;
  let persisted = false;
  let expenseWrites = 0;
  let prompts = 0;
  await withServer({
    findActiveMerchantMapping: async () => null,
    createPendingIngestionIfNew: async () => {
      if (!persisted) {
        persisted = true;
        pendingCreates += 1;
        return {
          created: true,
          row: { id: 'pending-1', merchant: 'COOL HUNTING SRL', status: 'pending' },
        };
      }
      return {
        created: false,
        row: { id: 'pending-1', merchant: 'COOL HUNTING SRL', status: 'pending' },
      };
    },
    createIngestedExpenseAndGetTotalToday: async () => {
      expenseWrites += 1;
      return { created: true, expenseId: 'expense-1' };
    },
    requestMerchantSelection: async () => { prompts += 1; },
  }, async (url) => {
    assert.equal((await post(url, unknownSample)).status, 202);
    assert.equal((await post(url, unknownSample)).status, 202);
  });
  assert.equal(pendingCreates, 1);
  assert.equal(expenseWrites, 0);
  assert.equal(prompts, 1);
});

test('parses the Takenos USD purchase notification', () => {
  assert.deepEqual(parseTakenosPurchase(sample), {
    amount: 20.27,
    currency: 'USD',
    merchant: 'ARTISTA DE CAFE',
  });
  assert.equal(parseTakenosPurchase({ ...sample, body: 'Transferencia recibida' }), null);
});

test('parses dot thousands separators in the purchase amount', () => {
  assert.deepEqual(parseTakenosPurchase({
    ...sample,
    body: 'Se realizó un pago exitoso de 1.234,56 USD en ARTISTA DE CAFE',
  }), {
    amount: 1234.56,
    currency: 'USD',
    merchant: 'ARTISTA DE CAFE',
  });
  assert.equal(
    parseTakenosPurchase({ ...sample, body: 'Se realizó un pago exitoso de 20,27 USD en X' }).amount,
    20.27,
  );
});

test('ignores Google Wallet even when its text resembles a Takenos purchase', async () => {
  let writes = 0;
  await withServer({
    createIngestedExpenseAndGetTotalToday: async () => {
      writes += 1;
      return { created: true, expenseId: 'expense-1' };
    },
  }, async (url) => {
    const response = await post(url, {
      ...sample,
      packageName: 'com.google.android.apps.walletnfcrel',
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      status: 'ignored', reason: 'unsupported_source',
    });
  });
  assert.equal(writes, 0);
});

test('rejects an unauthorized request', async () => {
  await withServer({}, async (url) => {
    const response = await request(url, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sample),
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Unauthorized' });
  });
});

test('rejects malformed JSON requests', async () => {
  await withServer({}, async (url) => {
    const response = await request(url, {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: '{',
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid JSON' });
  });
});

test('rejects malformed notification payloads', async () => {
  await withServer({}, async (url) => {
    const response = await post(url, []);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid payload' });
  });
});

test('handles a 4096-byte payload normally', async () => {
  await withServer({
    createIngestedExpenseAndGetTotalToday: async () => ({ created: true, expenseId: 'expense-1' }),
  }, async (url) => {
    const response = await request(url, {
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: payloadJsonOfByteLength(4096),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { status: 'created' });
  });
});

test('rejects a 4097-byte streamed payload without Content-Length', async () => {
  await withServer({}, async (url) => {
    const response = await streamedRequestWithoutContentLength(url, payloadJsonOfByteLength(4097));
    assert.equal(response.status, 413);
    assert.deepEqual(response.body, { error: 'Payload too large' });
  });
});

test('rejects a non-purchase Takenos notification without writing an expense', async () => {
  let writes = 0;
  await withServer({
    createIngestedExpenseAndGetTotalToday: async () => {
      writes += 1;
      return { created: true, expenseId: 'expense-1' };
    },
  }, async (url) => {
    const response = await post(url, { ...sample, body: 'Transferencia recibida' });
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), {
      error: 'Not a Takenos purchase notification',
    });
  });
  assert.equal(writes, 0);
});

test('returns a server error when a known expense persistence fails', async () => {
  await withServer({
    createIngestedExpenseAndGetTotalToday: async () => {
      throw new Error('Storage unavailable');
    },
  }, async (url) => {
    const response = await post(url, sample);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Unable to ingest notification',
    });
  });
});

test('returns a server error when merchant mapping lookup fails', async () => {
  await withServer({
    findActiveMerchantMapping: async () => { throw new Error('Storage unavailable'); },
  }, async (url) => {
    const response = await post(url, sample);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: 'Unable to ingest notification',
    });
  });
});

test('accepts a stable Android notification key and deduplicates the Takenos purchase', async () => {
  const seenIds = new Set();
  const written = [];
  await withServer({
    createIngestedExpenseAndGetTotalToday: async (expense) => {
      if (seenIds.has(expense.ingestId)) return { created: false, expenseId: null };
      seenIds.add(expense.ingestId);
      written.push(expense);
      return { created: true, expenseId: 'expense-1' };
    },
  }, async (url) => {
    const created = await post(url, sample);
    const repeated = await post(url, sample);
    assert.equal(created.status, 201);
    assert.equal(repeated.status, 200);
  });
  assert.deepEqual(written, [{
    description: 'ARTISTA DE CAFE',
    amount: 20.27,
    budgetId: 'food',
    ingestId: 'takenos:0|com.takenos.app|42|null|10234',
  }]);
});
