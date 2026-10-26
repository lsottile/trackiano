import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createMerchantSelectionPromptSender, reportFailure } from './bot.js';
import { assertRuntimeAndBackend, assertRuntimeEnvironment } from './runtimeConfig.js';
import {
  createExpenseIfNew,
  createPendingIngestionIfNew,
  findActiveMerchantMapping,
} from './storage.js';

const MAX_NOTIFICATION_BODY_BYTES = 4096;
const MAX_EMAIL_BODY_BYTES = 64 * 1024;
const PURCHASE_TITLE_PREFIX = 'Compraste con tu Takecar';
const PURCHASE_BODY = /^Se realizó un pago exitoso de (\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}) USD en (.+)$/u;
const PURCHASE_EMAIL_BODY = /Se realizó un pago exitoso de\s+(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s+USD\s+en\s+([^\r\n]+)/u;

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

function readJson(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;

    request.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
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

function validateEmailPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const { id, from, subject, text } = payload;
  if (
    typeof id !== 'string' || !/^[A-Za-z0-9._:|-]{1,200}$/.test(id) ||
    typeof from !== 'string' || from.length > 500 ||
    typeof subject !== 'string' || subject.length > 1000 ||
    typeof text !== 'string' || text.length > 60 * 1024
  ) return null;
  return { id, from, subject, text };
}

function emailAddress(from) {
  return from.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?\s*$/iu)?.[1]?.toLowerCase() ?? '';
}

function parseTakenosEmailPurchase({ text }) {
  const match = text.match(PURCHASE_EMAIL_BODY);
  if (!match) return null;
  const body = `Se realizó un pago exitoso de ${match[1]} USD en ${match[2].trim()}`;
  return parseTakenosPurchase({ title: PURCHASE_TITLE_PREFIX, body });
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
  takenosEmailSender = process.env.TAKENOS_EMAIL_SENDER,
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
    const isAndroidNotification = request.url === '/ingest/takenos';
    const isEmail = request.url === '/ingest/takenos/email';
    if (request.method !== 'POST' || (!isAndroidNotification && !isEmail)) {
      return sendJson(response, 404, { error: 'Not found' });
    }
    if (!tokensMatch(request.headers.authorization?.replace(/^Bearer /, '') ?? '', token)) {
      return sendJson(response, 401, { error: 'Unauthorized' });
    }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      return sendJson(response, 415, { error: 'Content-Type must be application/json' });
    }
    const maxBodyBytes = isEmail ? MAX_EMAIL_BODY_BYTES : MAX_NOTIFICATION_BODY_BYTES;
    if (Number(request.headers['content-length'] ?? 0) > maxBodyBytes) {
      return sendJson(response, 413, { error: 'Payload too large' });
    }

    let payload;
    try {
      const body = await readJson(request, maxBodyBytes);
      payload = isEmail ? validateEmailPayload(body) : validatePayload(body);
    } catch (error) {
      return sendJson(response, error.message === 'Payload too large' ? 413 : 400, {
        error: error.message,
      });
    }
    if (!payload) return sendJson(response, 400, { error: 'Invalid payload' });
    if (isEmail) {
      if (!takenosEmailSender || emailAddress(payload.from) !== takenosEmailSender.toLowerCase()) {
        return sendJson(response, 202, { status: 'ignored', reason: 'unsupported_source' });
      }
    } else if (payload.packageName !== takenosPackage) {
      return sendJson(response, 202, { status: 'ignored', reason: 'unsupported_source' });
    }

    const purchase = isEmail ? parseTakenosEmailPurchase(payload) : parseTakenosPurchase(payload);
    if (!purchase) return sendJson(response, 422, {
      error: isEmail ? 'Not a Takenos purchase email' : 'Not a Takenos purchase notification',
    });

    // ponytail: one process is serialized; scale-out needs a transactional store.
    const sourceId = isEmail ? `email:${payload.id}` : payload.id;
    const result = writes.then(() => ingestPurchase(purchase, sourceId, dependencies));
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
