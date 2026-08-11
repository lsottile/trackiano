import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANDIDATE_SCHEMA,
  MIN_CONFIDENCE,
  OPENROUTER_TIMEOUT_MS,
  buildInferenceRequest,
  extractCandidatePayload,
  findBudgetByName,
  inferCategory,
  selectTopCandidate,
  validateRankedCandidates,
} from '../src/inferCategory.js';

const budgets = [
  { id: 'food-id', name: 'Food', amount: 1000 },
  { id: 'travel-id', name: 'Travel and Lodging', amount: 500 },
  { id: 'custom-id', name: 'Mascotas VIP', amount: 100 },
];
const candidate = (categoryName, confidence = 0.8, reason = 'fit') => ({ categoryName, confidence, reason });
const envelope = (value) => ({ choices: [{ message: { content: JSON.stringify(value) } }] });

test('exports the literal strict ranked-candidate schema and threshold', () => {
  assert.equal(MIN_CONFIDENCE, 0.7);
  assert.deepEqual(CANDIDATE_SCHEMA.required, ['candidates']);
  assert.equal(CANDIDATE_SCHEMA.additionalProperties, false);
  assert.equal(CANDIDATE_SCHEMA.properties.candidates.maxItems, 3);
  assert.deepEqual(CANDIDATE_SCHEMA.properties.candidates.items.required, ['categoryName', 'confidence', 'reason']);
});

test('builds bilingual guidance and a strict OpenRouter wrapper without credentials or history', () => {
  const body = buildInferenceRequest({ description: 'hotel y train', amount: 42.75, budgets, model: 'model-x' });
  assert.equal(body.model, 'model-x');
  assert.match(body.messages[0].content, /Spanish, English, or mixed/i);
  const user = JSON.parse(body.messages[1].content);
  assert.deepEqual(user.expense, { description: 'hotel y train', amount: 42.75 });
  assert.deepEqual(user.categories.at(-1), { name: 'Mascotas VIP' });
  assert.deepEqual(body.response_format, {
    type: 'json_schema',
    json_schema: { name: 'expense_category_candidates', strict: true, schema: CANDIDATE_SCHEMA },
  });
  assert.doesNotMatch(JSON.stringify(body), /authorization|api.?key|fingerprint|history/i);
});

test('extracts exactly one JSON value from the provider envelope', () => {
  assert.deepEqual(extractCandidatePayload(envelope({ candidates: [candidate('Food')] })), {
    candidates: [candidate('Food')],
  });
  for (const payload of [{}, { choices: [] }, { choices: [{ message: { content: '```json\n{}\n```' } }] }, { choices: [{ message: { content: '{} trailing' } }] }]) {
    assert.throws(() => extractCandidatePayload(payload), /OpenRouter returned invalid candidate content/);
  }
});

test('validates, allowlists, deduplicates, and preserves ranked stored identities', () => {
  assert.deepEqual(validateRankedCandidates({ candidates: [
    candidate('food', 0.6, 'first'), candidate('FOOD', 0.9, 'duplicate'), candidate('Travel and Lodging', 0.7),
  ] }, budgets), [
    { budgetId: 'food-id', categoryName: 'Food', confidence: 0.6, reason: 'first' },
    { budgetId: 'travel-id', categoryName: 'Travel and Lodging', confidence: 0.7, reason: 'fit' },
  ]);
  assert.deepEqual(findBudgetByName(budgets, 'food'), budgets[0]);
  assert.equal(findBudgetByName(budgets, ' Food '), null);
});

test('rejects malformed envelopes/cardinality and drops malformed candidates', () => {
  for (const payload of [null, [], {}, { candidates: [] }, { candidates: [candidate('Food'), candidate('Food'), candidate('Food'), candidate('Food')] }, { candidates: [candidate('Food')], extra: true }]) {
    assert.throws(() => validateRankedCandidates(payload, budgets), /Invalid candidate payload/);
  }
  const invalid = [
    null, [], { ...candidate('Food'), extra: true }, candidate('', 0.5), candidate('Food', NaN), candidate('Food', Infinity), candidate('Food', -0.1), candidate('Food', 1.1), candidate('Food', 0.5, 'x'.repeat(241)),
  ];
  assert.throws(() => validateRankedCandidates({ candidates: invalid.slice(0, 3) }, budgets), /No valid category candidates/);
  assert.throws(() => validateRankedCandidates({ candidates: [candidate('Invented')] }, budgets), /No valid category candidates/);
});

test('selects only a well-formed first candidate at the exact confidence boundary', () => {
  const low = { budgetId: 'food-id', categoryName: 'Food', confidence: 0.6999, reason: '' };
  const high = { budgetId: 'travel-id', categoryName: 'Travel and Lodging', confidence: 1, reason: '' };
  assert.equal(selectTopCandidate([low, high]), null);
  assert.deepEqual(selectTopCandidate([{ ...low, confidence: 0.7 }, high]), { ...low, confidence: 0.7 });
  for (const malformed of [
    null, {}, [null], [{ ...high, confidence: '1' }],
    [{ ...high, confidence: { valueOf: () => 1 } }],
    [{ confidence: 1 }], [{ ...high, extra: true }],
  ]) assert.equal(selectTopCandidate(malformed), null);
  assert.equal(selectTopCandidate([high], '0.7'), null);
});

test('rejects malformed budget allowlists without coercion', () => {
  assert.equal(findBudgetByName([{ id: 'x', name: 12 }], '12'), null);
  assert.throws(
    () => validateRankedCandidates({ candidates: [candidate('Food')] }, null),
    /Invalid budget allowlist/,
  );
});

function successResponse(value, events = []) {
  return {
    ok: true,
    async json() {
      events.push('body');
      return envelope(value);
    },
  };
}

test('uses one timeout signal and one request while consuming the body under that signal', async () => {
  const events = [];
  const signal = { token: 'signal' };
  const fetchImpl = async (_url, options) => {
    events.push(['fetch', options.signal]);
    return successResponse({ candidates: [candidate('Food', 0.9)] }, events);
  };
  const result = await inferCategory({ description: 'coffee', amount: 3, budgets }, {
    apiKey: 'secret', model: 'model', fetchImpl,
    createTimeoutSignal: (milliseconds) => {
      events.push(['signal', milliseconds]);
      return signal;
    },
  });
  assert.deepEqual(result[0], { budgetId: 'food-id', categoryName: 'Food', confidence: 0.9, reason: 'fit' });
  assert.deepEqual(events, [['signal', 8000], ['fetch', signal], 'body']);
});

test('rejects invalid preconditions before requests', async () => {
  for (const options of [
    { apiKey: '' }, { apiKey: 'x', timeoutMs: 0 }, { apiKey: 'x', timeoutMs: 1.5 }, { apiKey: 'x', timeoutMs: OPENROUTER_TIMEOUT_MS + 1 },
  ]) {
    let calls = 0;
    await assert.rejects(inferCategory({ description: 'x', amount: 1, budgets }, {
      ...options, fetchImpl: async () => { calls += 1; }, createTimeoutSignal: () => ({}),
    }));
    assert.equal(calls, 0);
  }
  let calls = 0;
  await assert.rejects(inferCategory({ description: 'x', amount: 1, budgets: [] }, {
    apiKey: 'x', fetchImpl: async () => { calls += 1; },
  }), /current category/);
  assert.equal(calls, 0);
});

test('does not retry HTTP, abort, JSON, envelope, or schema failures', async () => {
  const responses = [
    { ok: false, status: 503, json: async () => ({ secret: 'payload' }) },
    { ok: true, json: async () => { throw new Error('abort'); } },
    { ok: true, json: async () => ({}) },
    successResponse({ candidates: [candidate('Invented')] }),
  ];
  for (const response of responses) {
    let calls = 0;
    await assert.rejects(inferCategory({ description: 'x', amount: 1, budgets }, {
      apiKey: 'x', fetchImpl: async () => { calls += 1; return response; }, createTimeoutSignal: () => ({}),
    }));
    assert.equal(calls, 1);
  }
});
