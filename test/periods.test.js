import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getLatestClosedMonthlyPeriod,
  getLatestClosedWeeklyPeriod,
} from '../src/periods.js';

test('weekly period follows the app timezone across the Sunday and Monday boundary', () => {
  const now = new Date('2026-07-27T00:30:00.000Z');

  assert.deepEqual(
    getLatestClosedWeeklyPeriod({ now, timeZone: 'America/Guatemala' }),
    {
      key: '2026-07-13/2026-07-20',
      start: '2026-07-13',
      end: '2026-07-20',
      days: 7,
    },
  );
  assert.deepEqual(
    getLatestClosedWeeklyPeriod({ now, timeZone: 'Asia/Tokyo' }),
    {
      key: '2026-07-20/2026-07-27',
      start: '2026-07-20',
      end: '2026-07-27',
      days: 7,
    },
  );
});

test('monthly period crosses the year boundary', () => {
  assert.deepEqual(
    getLatestClosedMonthlyPeriod({
      now: new Date('2026-01-01T12:00:00.000Z'),
      timeZone: 'UTC',
    }),
    {
      key: '2025-12',
      start: '2025-12-01',
      end: '2026-01-01',
      days: 31,
    },
  );
});

test('monthly period counts leap February calendar days', () => {
  assert.deepEqual(
    getLatestClosedMonthlyPeriod({
      now: new Date('2024-03-15T12:00:00.000Z'),
      timeZone: 'UTC',
    }),
    {
      key: '2024-02',
      start: '2024-02-01',
      end: '2024-03-01',
      days: 29,
    },
  );
});
