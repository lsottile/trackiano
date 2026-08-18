import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMessage } from '../src/parseMessage.js';

test('parses amount first with explicit delimited category', () => {
  assert.deepEqual(parseMessage('50 coffee | food'), {
    description: 'Coffee',
    amount: 50,
    category: 'food',
  });
});

test('parses amount first with omitted category', () => {
  assert.deepEqual(parseMessage('50 coffee with milk'), {
    description: 'Coffee with milk',
    amount: 50,
    category: null,
  });
});

test('rejects missing description', () => {
  assert.throws(
    () => parseMessage('50'),
    /Format: \{amount\} \{description\} \[\| category\]/,
  );
  assert.throws(
    () => parseMessage(''),
    /Format: \{amount\} \{description\} \[\| category\]/,
  );
});

test('rejects a non-numeric first token', () => {
  assert.throws(
    () => parseMessage('coffee 50'),
    /"coffee" is not a valid amount/,
  );
});

test('accepts only explicit finite decimal amount syntax', () => {
  assert.equal(parseMessage('.5 coffee').amount, 0.5);
  assert.equal(parseMessage('-12.50 refund').amount, -12.5);
  for (const input of [
    'Infinity coffee', 'NaN coffee', '12,50 coffee',
    '0x10 coffee', '0b10 coffee', '1e2 coffee',
  ]) {
    assert.throws(() => parseMessage(input), /is not a valid amount/);
  }
});

test('keeps later numeric tokens inside the description', () => {
  assert.deepEqual(parseMessage('5 snack 2'), {
    description: 'Snack 2', amount: 5, category: null,
  });
  assert.deepEqual(parseMessage('20 subte linea D'), {
    description: 'Subte linea D', amount: 20, category: null,
  });
});

test('uses a literal delimiter for numeric-suffixed or multi-word categories', () => {
  assert.deepEqual(parseMessage('5 snack | Category 2'), {
    description: 'Snack', amount: 5, category: 'Category 2',
  });
  assert.deepEqual(parseMessage('50 hotel | Travel and Lodging'), {
    description: 'Hotel', amount: 50, category: 'Travel and Lodging',
  });
  for (const input of ['50 hotel |', '| Travel', '50 | Travel', '50 hotel | Travel | Other']) {
    assert.throws(() => parseMessage(input), /Use:/);
  }
});
