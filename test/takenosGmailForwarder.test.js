import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../integrations/gmail/Code.gs', import.meta.url), 'utf8');

function loadForwarder({
  responseCode = 201,
  responseBody = { status: 'created' },
  startedAt = '1770000000',
} = {}) {
  const createdTriggers = [];
  const deletedTriggers = [];
  const listCalls = [];
  const propertyWrites = [];
  const requests = [];
  const trashedMessages = [];
  const scriptProperties = {
    TRACKIANO_INGEST_URL: 'https://trackiano.example.com',
    TRACKIANO_INGEST_TOKEN: 'secret-token',
    TAKENOS_EMAIL_SENDER: 'notifications@takenos.com',
  };
  if (startedAt) scriptProperties.TRACKIANO_STARTED_AT = startedAt;
  const text = 'Se realizó un pago exitoso de 20,27 USD en Artista de Café';
  const context = {
    console,
    Gmail: {
      Users: {
        Messages: {
          list: (userId, options) => {
            listCalls.push({ userId, options });
            return { messages: [{ id: 'gmail-message-1' }] };
          },
          get: () => ({
            id: 'gmail-message-1',
            payload: {
              headers: [
                { name: 'From', value: 'Takenos <notifications@takenos.com>' },
                { name: 'Subject', value: 'Tu compra con Takecard fue aprobada' },
              ],
              parts: [{
                mimeType: 'text/plain',
                body: { data: Buffer.from(text).toString('base64url') },
              }],
            },
          }),
          trash: (userId, messageId) => {
            trashedMessages.push({ userId, messageId });
          },
        },
      },
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => ({ ...scriptProperties }),
        getProperty: (name) => scriptProperties[name] ?? null,
        setProperty: (name, value) => {
          scriptProperties[name] = value;
          propertyWrites.push({ name, value });
        },
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => [{
        getHandlerFunction: () => 'forwardTakenosEmails',
      }],
      deleteTrigger: (trigger) => deletedTriggers.push(trigger.getHandlerFunction()),
      newTrigger: (handler) => ({
        timeBased: () => ({
          everyMinutes: (minutes) => ({
            create: () => createdTriggers.push({ handler, minutes }),
          }),
        }),
      }),
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        requests.push({ url, options });
        return {
          getResponseCode: () => responseCode,
          getContentText: () => JSON.stringify(responseBody),
        };
      },
    },
    Utilities: {
      base64DecodeWebSafe: (value) => Buffer.from(value, 'base64url'),
      newBlob: (value) => ({ getDataAsString: () => Buffer.from(value).toString('utf8') }),
    },
  };
  vm.runInNewContext(source, context);
  return {
    context,
    createdTriggers,
    deletedTriggers,
    listCalls,
    propertyWrites,
    requests,
    text,
    trashedMessages,
  };
}

test('forwards one matching Gmail message and trashes it only after Trackiano accepts it', () => {
  const { context, requests, text, trashedMessages } = loadForwarder();

  context.forwardTakenosEmails?.();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://trackiano.example.com/ingest/takenos/email');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(requests[0].options.payload), {
    id: 'gmail-message-1',
    from: 'Takenos <notifications@takenos.com>',
    subject: 'Tu compra con Takecard fue aprobada',
    text,
  });
  assert.deepEqual(trashedMessages, [{
    userId: 'me',
    messageId: 'gmail-message-1',
  }]);
});

test('leaves a Gmail message in place when Trackiano rejects it', () => {
  const { context, requests, trashedMessages } = loadForwarder({
    responseCode: 422,
    responseBody: { error: 'Not a Takenos purchase email' },
  });

  context.forwardTakenosEmails();

  assert.equal(requests.length, 1);
  assert.deepEqual(trashedMessages, []);
});

test('searches only for Takenos messages received after the integration was installed', () => {
  const { context, listCalls } = loadForwarder();

  context.forwardTakenosEmails();

  assert.deepEqual(JSON.parse(JSON.stringify(listCalls)), [{
    userId: 'me',
    options: {
      q: 'from:(notifications@takenos.com) after:1770000000',
      maxResults: 50,
    },
  }]);
});

test('installs one five-minute Gmail trigger without duplicating an existing one', () => {
  const { context, createdTriggers, deletedTriggers } = loadForwarder();

  context.setupTakenosEmailForwarder?.();

  assert.deepEqual(deletedTriggers, ['forwardTakenosEmails']);
  assert.deepEqual(createdTriggers, [{ handler: 'forwardTakenosEmails', minutes: 5 }]);
});

test('records the activation time before installing a fresh trigger', () => {
  const { context, createdTriggers, propertyWrites } = loadForwarder({ startedAt: null });
  let error;

  try {
    context.setupTakenosEmailForwarder();
  } catch (caught) {
    error = caught;
  }

  assert.equal(error, undefined);
  assert.equal(propertyWrites.length, 1);
  assert.equal(propertyWrites[0].name, 'TRACKIANO_STARTED_AT');
  assert.match(propertyWrites[0].value, /^\d+$/u);
  assert.deepEqual(createdTriggers, [{ handler: 'forwardTakenosEmails', minutes: 5 }]);
});
