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
