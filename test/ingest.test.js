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

async function withServer(overrides, run) {
  const server = createIngestServer({
    token: 'test-token',
    takenosPackage,
    findActiveMerchantMapping: async () => ({
      id: 'mapping-1', merchant: 'ARTISTA DE CAFE', budgetId: 'food',
    }),
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

test('creates a mapped Takenos expense without reading budgets or invoking inference', async () => {
  const written = [];
  await withServer({
    findActiveMerchantMapping: async (merchant) => {
      assert.equal(merchant, 'ARTISTA DE CAFE');
      return { id: 'mapping-1', merchant, budgetId: 'coffee' };
    },
    createExpenseIfNew: async (expense) => {
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

test('persists an unknown purchase before requesting the owner selection', async () => {
  const events = [];
  await withServer({
    findActiveMerchantMapping: async () => null,
    createPendingIngestionIfNew: async () => {
      events.push('persist');
      return {
        created: true,
        row: { id: 'pending-1', merchant: 'ARTISTA DE CAFE', status: 'pending' },
      };
    },
    requestMerchantSelection: async () => { events.push('prompt'); },
  }, async (url) => {
    assert.equal((await post(url, sample)).status, 202);
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
        row: { id: 'pending-1', merchant: 'ARTISTA DE CAFE', status: 'pending' },
      }),
      requestMerchantSelection: async () => { throw new Error('Telegram unavailable'); },
    }, async (url) => {
      assert.equal((await post(url, sample)).status, 202);
    });
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(errors, [JSON.stringify({
    operation: 'merchant_selection_prompt',
    outcome: 'failure',
    merchant: 'ARTISTA DE CAFE',
    ingestId: 'takenos:0|com.takenos.app|42|null|10234',
  })]);
});

test('returns 500 and does not prompt when durable pending persistence fails', async () => {
  let prompted = false;
  await withServer({
    findActiveMerchantMapping: async () => null,
    createPendingIngestionIfNew: async () => { throw new Error('Storage unavailable'); },
    requestMerchantSelection: async () => { prompted = true; },
  }, async (url) => assert.equal((await post(url, sample)).status, 500));
  assert.equal(prompted, false);
});

test('does not prompt a duplicate pending row that has already been processed', async () => {
  let prompts = 0;
  await withServer({
    findActiveMerchantMapping: async () => null,
    createPendingIngestionIfNew: async () => ({
      created: false,
      row: { id: 'pending-1', merchant: 'ARTISTA DE CAFE', status: 'processed' },
    }),
    requestMerchantSelection: async () => { prompts += 1; },
  }, async (url) => assert.equal((await post(url, sample)).status, 202));
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
          row: { id: 'pending-1', merchant: 'ARTISTA DE CAFE', status: 'pending' },
        };
      }
      return {
        created: false,
        row: { id: 'pending-1', merchant: 'ARTISTA DE CAFE', status: 'pending' },
      };
    },
    createExpenseIfNew: async () => {
      expenseWrites += 1;
      return { created: true, expenseId: 'expense-1' };
    },
    requestMerchantSelection: async () => { prompts += 1; },
  }, async (url) => {
    assert.equal((await post(url, sample)).status, 202);
    assert.equal((await post(url, sample)).status, 202);
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
    createExpenseIfNew: async () => {
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
    createExpenseIfNew: async () => ({ created: true, expenseId: 'expense-1' }),
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
    createExpenseIfNew: async () => {
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
    createExpenseIfNew: async () => {
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
    createExpenseIfNew: async (expense) => {
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
