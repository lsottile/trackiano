import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createMerchantSelectionPromptSender, reportFailure } from './bot.js';
import { assertRuntimeAndBackend, assertRuntimeEnvironment } from './runtimeConfig.js';
import {
  createExpenseIfNew,
  createPendingIngestionIfNew,
  findActiveMerchantMapping,
} from './storage.js';

const MAX_BODY_BYTES = 4096;
const PURCHASE_TITLE_PREFIX = 'Compraste con tu Takecar';
const PURCHASE_BODY = /^Se realizó un pago exitoso de (\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}) USD en (.+)$/u;

export function parseTakenosPurchase({ title, body }) {
  if (!title.startsWith(PURCHASE_TITLE_PREFIX)) return null;

  const match = body.match(PURCHASE_BODY);
  if (!match) return null;

  const amount = Number(match[1].replaceAll('.', '').replace(',', '.'));
  const merchant = match[2].trim();
  if (!Number.isFinite(amount) || amount <= 0 || !merchant) return null;

  return { amount, currency: 'USD', merchant };
}

export function normalizeMerchant(merchant) {
  return merchant.normalize('NFKD').replace(/\p{M}/gu, '')
    .trim().replace(/\s+/gu, ' ').toUpperCase();
}

function tokensMatch(actual, expected) {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes);
}

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { packageName, title, body, id } = payload;
  if (
    typeof packageName !== 'string' || packageName.length > 200 ||
    typeof title !== 'string' || title.length > 1000 ||
    typeof body !== 'string' || body.length > 2000 ||
    typeof id !== 'string' || !/^[A-Za-z0-9._:|-]{1,200}$/.test(id)
  ) return null;
  return { packageName, title, body, id };
}

async function ingestPurchase(purchase, id, dependencies) {
  const ingestId = `takenos:${id}`;
  const merchant = normalizeMerchant(purchase.merchant);
  const mapping = await dependencies.findActiveMerchantMapping(merchant);
  if (mapping) {
    const { created } = await dependencies.createExpenseIfNew({
      description: purchase.merchant,
      amount: purchase.amount,
      budgetId: mapping.budgetId,
      ingestId,
    });
    return { status: created ? 'created' : 'duplicate' };
  }

  const { created, row: pending } = await dependencies.createPendingIngestionIfNew({
    ingestId,
    merchant,
    description: purchase.merchant,
    amount: purchase.amount,
  });
  if (created && pending) {
    try {
      await dependencies.requestMerchantSelection(pending);
    } catch {
      await reportFailure((event) => {
        console.error(JSON.stringify({ ...event, merchant, ingestId }));
      }, 'merchant_selection_prompt');
    }
  }
  return { status: 'pending' };
}

export function createIngestServer({
  token = process.env.INGEST_TOKEN,
  takenosPackage = process.env.TAKENOS_ANDROID_PACKAGE,
  findActiveMerchantMapping: findMapping = findActiveMerchantMapping,
  createPendingIngestionIfNew: writePending = createPendingIngestionIfNew,
  createExpenseIfNew: writeExpense = createExpenseIfNew,
  requestMerchantSelection = async () => {},
} = {}) {
  if (!token || !takenosPackage) {
    throw new Error('INGEST_TOKEN and TAKENOS_ANDROID_PACKAGE are required');
  }

  const dependencies = {
    findActiveMerchantMapping: findMapping,
    createPendingIngestionIfNew: writePending,
    createExpenseIfNew: writeExpense,
    requestMerchantSelection,
  };
  let writes = Promise.resolve();

  return createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/ingest/takenos') {
      return sendJson(response, 404, { error: 'Not found' });
    }
    if (!tokensMatch(request.headers.authorization?.replace(/^Bearer /, '') ?? '', token)) {
      return sendJson(response, 401, { error: 'Unauthorized' });
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      return sendJson(response, 415, { error: 'Content-Type must be application/json' });
    }
    if (Number(request.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      return sendJson(response, 413, { error: 'Payload too large' });
    }

    let payload;
    try {
      payload = validatePayload(await readJson(request));
    } catch (error) {
      return sendJson(response, error.message === 'Payload too large' ? 413 : 400, {
        error: error.message,
      });
    }
    if (!payload) return sendJson(response, 400, { error: 'Invalid payload' });
    if (payload.packageName !== takenosPackage) {
      return sendJson(response, 202, { status: 'ignored', reason: 'unsupported_source' });
    }

    const purchase = parseTakenosPurchase(payload);
    if (!purchase) return sendJson(response, 422, { error: 'Not a Takenos purchase notification' });

    // ponytail: one process is serialized; scale-out needs a transactional store.
    const result = writes.then(() => ingestPurchase(purchase, payload.id, dependencies));
    writes = result.catch(() => {});
    try {
      const record = await result;
      return sendJson(response, record.status === 'created' ? 201 : record.status === 'duplicate' ? 200 : 202, {
        status: record.status,
      });
    } catch {
      return sendJson(response, 500, { error: 'Unable to ingest notification' });
    }
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  assertRuntimeAndBackend();
  assertRuntimeEnvironment();
  const port = Number(process.env.PORT ?? 3000);
  createIngestServer({
    requestMerchantSelection: createMerchantSelectionPromptSender(),
  }).listen(port, () => {
    console.log(`Takenos ingestion listening on ${port}`);
  });
}
