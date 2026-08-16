import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMessage } from '../src/parseMessage.js';

test('parses old explicit category format', () => {
  assert.deepEqual(parseMessage('coffee 50 food'), {
    description: 'coffee',
    amount: 50,
    category: 'food',
  });
});

test('parses omitted category format', () => {
  assert.deepEqual(parseMessage('coffee with milk 50'), {
    description: 'coffee with milk',
    amount: 50,
    category: null,
  });
});

test('rejects missing amount', () => {
  assert.throws(
    () => parseMessage('coffee'),
    /Format: \{description\} \{amount\} \[category\]/,
  );
});

test('rejects invalid amount in explicit category format', () => {
  assert.throws(
    () => parseMessage('coffee many food'),
    /"many" is not a valid amount/,
  );
});

test('rejects missing description', () => {
  assert.throws(
    () => parseMessage('50 food'),
    /Format: \{description\} \{amount\} \[category\]/,
  );
});

test('parses a multi-word category after the rightmost finite amount', () => {
  assert.deepEqual(parseMessage('hotel 50 Travel and Lodging'), {
    description: 'hotel', amount: 50, category: 'Travel and Lodging',
  });
  assert.deepEqual(parseMessage('taxi 20 Transporte Público'), {
    description: 'taxi', amount: 20, category: 'Transporte Público',
  });
});

test('accepts only explicit finite decimal amount syntax', () => {
  assert.equal(parseMessage('coffee .5').amount, 0.5);
  assert.equal(parseMessage('refund -12.50').amount, -12.5);
  for (const input of [
    'coffee Infinity Food', 'coffee NaN Food', 'coffee 12,50 Food',
    'coffee 0x10 Food', 'coffee 0b10 Food', 'coffee 1e2 Food',
  ]) {
    assert.throws(() => parseMessage(input), /is not a valid amount/);
  }
});

test('fails closed on an undelimited numeric-suffixed category', () => {
  for (const input of ['snack 5 2', 'snack 5 2 Food', 'snack 5 Category 2']) {
    assert.throws(
      () => parseMessage(input),
      /Use: \{description\} \{amount\} \| \{category\}/,
    );
  }
});

test('uses a literal delimiter for numeric-suffixed or multi-word categories', () => {
  assert.deepEqual(parseMessage('snack 5 | Category 2'), {
    description: 'snack', amount: 5, category: 'Category 2',
  });
  assert.deepEqual(parseMessage('hotel 50 | Travel and Lodging'), {
    description: 'hotel', amount: 50, category: 'Travel and Lodging',
  });
  for (const input of ['hotel 50 |', 'hotel | Travel', 'hotel 50 | Travel | Other']) {
    assert.throws(() => parseMessage(input), /Use:/);
  }
});

test('preserves one-number omission and nonnumeric category suffixes', () => {
  assert.deepEqual(parseMessage('coffee with milk 20'), {
    description: 'coffee with milk', amount: 20, category: null,
  });
  assert.deepEqual(parseMessage('snack 5 Category Two'), {
    description: 'snack', amount: 5, category: 'Category Two',
  });
});
