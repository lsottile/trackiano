import assert from 'node:assert/strict';
import test from 'node:test';

import { handleTargetCommand, parseTargetAmount } from '../src/target.js';

test('parses a positive finite recurring daily target', () => {
  assert.equal(parseTargetAmount('70'), 70);
  assert.equal(parseTargetAmount(' 70.50 '), 70.5);
});

test('rejects invalid, non-positive, and non-finite targets', () => {
  for (const value of ['nope', '0', '-1', 'Infinity', '70 extra']) {
    assert.throws(
      () => parseTargetAmount(value),
      /Target must be a positive number\./,
    );
  }
});

test('rejects an invalid target before any Notion call', async () => {
  const replies = [];
  let notionCalls = 0;
  const ctx = {
    match: 'Infinity',
    reply(message) {
      replies.push(message);
      return Promise.resolve(message);
    },
  };

  await handleTargetCommand(ctx, {
    getSettings: async () => {
      notionCalls += 1;
    },
    setDailyTarget: async () => {
      notionCalls += 1;
    },
  });

  assert.equal(notionCalls, 0);
  assert.deepEqual(replies, ['Target must be a positive number.']);
});

test('persists a target with safe initial closed-period claims', async () => {
  const calls = [];
  const ctx = {
    match: '70',
    reply: async (message) => message,
  };

  await handleTargetCommand(ctx, {
    now: new Date('2026-07-27T12:00:00.000Z'),
    timeZone: 'UTC',
    getSettings: async () => assert.fail('getSettings should not be called'),
    setDailyTarget: async (...args) => calls.push(args),
  });

  assert.deepEqual(calls, [
    [
      70,
      {
        initialWeeklyPeriodKey: '2026-07-20/2026-07-27',
        initialMonthlyPeriodKey: '2026-06',
      },
    ],
  ]);
});

test('shows the current recurring daily target', async () => {
  const replies = [];
  const ctx = {
    match: '',
    reply(message) {
      replies.push(message);
      return Promise.resolve(message);
    },
  };

  await handleTargetCommand(ctx, {
    now: new Date('2026-07-27T12:00:00.000Z'),
    timeZone: 'UTC',
    getSettings: async () => ({ dailyTarget: 70 }),
    setDailyTarget: async () => assert.fail('setDailyTarget should not be called'),
  });

  assert.deepEqual(replies, ['Current daily target: $70.00']);
});
