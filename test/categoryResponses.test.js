import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENERIC_SAFE_CATEGORY_RESPONSE,
  LOW_CONFIDENCE_HEADER,
  MAX_TELEGRAM_MESSAGE_UTF16,
  buildLowConfidenceReply,
} from '../src/categoryResponses.js';

const choices = [
  { budgetId: 'one', categoryName: 'Travel and Lodging', confidence: 0.4, reason: 'hidden' },
  { budgetId: 'two', categoryName: 'Travel', confidence: 0.3, reason: 'also hidden' },
];

test('builds complete ranked resend examples without reasons or callbacks', () => {
  assert.equal(buildLowConfidenceReply({ originalText: '  hotel 50  ', candidates: choices }),
    `${LOW_CONFIDENCE_HEADER}\n• hotel 50 Travel and Lodging\n• hotel 50 Travel`);
});

test('deduplicates by ID, preserves rank, caps at three, and needs two choices', () => {
  const candidates = [choices[0], { ...choices[0], categoryName: 'duplicate' }, choices[1], { budgetId: 'three', categoryName: 'Food' }, { budgetId: 'four', categoryName: 'Extra' }];
  const reply = buildLowConfidenceReply({ originalText: 'x 1', candidates });
  assert.equal(reply.split('\n').length, 4);
  assert.match(reply, /Travel and Lodging\n• x 1 Travel\n• x 1 Food$/);
  assert.equal(buildLowConfidenceReply({ originalText: 'x 1', candidates: [choices[0]] }), GENERIC_SAFE_CATEGORY_RESPONSE);
});

test('accepts exactly 4096 UTF-16 units and rejects 4097 without truncation', () => {
  const fixed = LOW_CONFIDENCE_HEADER.length + 1 + '•  A\n•  B'.length;
  const exactInput = 'x'.repeat((MAX_TELEGRAM_MESSAGE_UTF16 - fixed) / 2);
  const exact = buildLowConfidenceReply({
    originalText: exactInput,
    candidates: [{ budgetId: 'a', categoryName: 'A' }, { budgetId: 'b', categoryName: 'B' }],
  });
  assert.equal(exact.length, MAX_TELEGRAM_MESSAGE_UTF16);
  assert.equal(buildLowConfidenceReply({
    originalText: `${exactInput}😀`,
    candidates: [{ budgetId: 'a', categoryName: 'A' }, { budgetId: 'b', categoryName: 'B' }],
  }), GENERIC_SAFE_CATEGORY_RESPONSE);
});

test('uses JavaScript UTF-16 length and only trims surrounding input', () => {
  const reply = buildLowConfidenceReply({ originalText: '  🚕  10\t ', candidates: choices });
  assert.match(reply, /• 🚕  10 Travel and Lodging/);
  assert.ok(reply.length > [...reply].length);
  assert.ok(GENERIC_SAFE_CATEGORY_RESPONSE.length < MAX_TELEGRAM_MESSAGE_UTF16);
});
