import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseTelegramOwnerId,
  runNotifications,
} from '../src/notifications.js';

const MONDAY_DAY_ONE = new Date('2026-06-01T12:00:00.000Z');

function createDependencies({
  attemptedWeeklyPeriod = '',
  attemptedMonthlyPeriod = '',
  sendMessage,
} = {}) {
  const events = [];
  const state = {
    dailyTarget: 70,
    attemptedWeeklyPeriod,
    attemptedMonthlyPeriod,
  };
  const dependencies = {
    getSettings: async () => ({ id: 'settings-page', ...state }),
    claimSummaryPeriod: async (type, key) => {
      events.push(`claim:${type}:${key}`);
      const field = type === 'weekly'
        ? 'attemptedWeeklyPeriod'
        : 'attemptedMonthlyPeriod';
      if (state[field] === key) return false;
      state[field] = key;
      return true;
    },
    getExpensesInRange: async (start, end) => {
      events.push(`query:${start}:${end}`);
      return { food: 100 };
    },
    getBudgets: async () => [{ id: 'food', name: 'Food' }],
    sendMessage: async (message) => {
      events.push(`send:${message.split('\n')[0]}`);
      if (sendMessage) return sendMessage(message);
    },
  };
  return { dependencies, events, state };
}

test('parses a positive safe Telegram owner ID', () => {
  assert.equal(parseTelegramOwnerId('123456789'), 123456789);
  assert.equal(parseTelegramOwnerId(' 123456789 '), 123456789);
});

test('rejects blank, malformed, non-positive, and unsafe Telegram owner IDs', () => {
  for (const value of [
    '',
    '   ',
    'not-an-id',
    '1.5',
    '0',
    '-1',
    String(Number.MAX_SAFE_INTEGER + 1),
  ]) {
    assert.throws(
      () => parseTelegramOwnerId(value),
      /TELEGRAM_OWNER_ID must be a positive safe integer\./,
    );
  }
});

test('claims each period before sending and sends weekly plus monthly on Monday day 1', async () => {
  const { dependencies, events, state } = createDependencies();

  await runNotifications({
    now: MONDAY_DAY_ONE,
    timeZone: 'UTC',
    ...dependencies,
  });

  assert.deepEqual(events, [
    'query:2026-05-25:2026-06-01',
    'claim:weekly:2026-05-25/2026-06-01',
    'send:Weekly spending summary',
    'query:2026-05-01:2026-06-01',
    'claim:monthly:2026-05',
    'send:Monthly spending summary',
  ]);
  assert.equal(state.attemptedWeeklyPeriod, '2026-05-25/2026-06-01');
  assert.equal(state.attemptedMonthlyPeriod, '2026-05');
});

test('repeated execution sends each closed period only once', async () => {
  const { dependencies, events } = createDependencies();
  const options = {
    now: MONDAY_DAY_ONE,
    timeZone: 'UTC',
    ...dependencies,
  };

  await runNotifications(options);
  await runNotifications(options);

  assert.equal(events.filter((event) => event.startsWith('send:')).length, 2);
});

test('restart with existing claims sends nothing', async () => {
  const { dependencies, events } = createDependencies({
    attemptedWeeklyPeriod: '2026-05-25/2026-06-01',
    attemptedMonthlyPeriod: '2026-05',
  });

  await runNotifications({
    now: MONDAY_DAY_ONE,
    timeZone: 'UTC',
    ...dependencies,
  });

  assert.equal(events.some((event) => event.startsWith('send:')), false);
  assert.equal(events.some((event) => event.startsWith('query:')), false);
});

test('Telegram failure retains the attempted claim and is not retried', async () => {
  let shouldFail = true;
  const { dependencies, events, state } = createDependencies({
    attemptedMonthlyPeriod: '2026-05',
    sendMessage: async () => {
      if (shouldFail) throw new Error('Telegram unavailable');
    },
  });
  const options = {
    now: MONDAY_DAY_ONE,
    timeZone: 'UTC',
    ...dependencies,
  };

  await assert.rejects(runNotifications(options), /Telegram unavailable/);
  assert.equal(state.attemptedWeeklyPeriod, '2026-05-25/2026-06-01');

  shouldFail = false;
  await runNotifications(options);
  assert.equal(events.filter((event) => event.startsWith('send:')).length, 1);
});
