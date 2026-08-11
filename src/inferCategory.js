import { buildCategoryGuidance } from './categorySemantics.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';
export const MIN_CONFIDENCE = 0.7;
export const OPENROUTER_TIMEOUT_MS = 8_000;

export const CANDIDATE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array', minItems: 1, maxItems: 3,
      items: {
        type: 'object', additionalProperties: false,
        required: ['categoryName', 'confidence', 'reason'],
        properties: {
          categoryName: { type: 'string', minLength: 1 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string', maxLength: 240 },
        },
      },
    },
  },
});

export function findBudgetByName(budgets, categoryName) {
  if (!Array.isArray(budgets) || typeof categoryName !== 'string') return null;
  const normalized = categoryName.toLowerCase();
  return budgets.find((budget) =>
    budget !== null && typeof budget === 'object' &&
    typeof budget.id === 'string' && typeof budget.name === 'string' &&
    budget.name.toLowerCase() === normalized) ?? null;
}

export function buildInferenceRequest({ description, amount, budgets, model = DEFAULT_MODEL }) {
  return {
    model,
    messages: [
      {
        role: 'system',
        content: 'Descriptions may be Spanish, English, or mixed. Return ranked candidates using only exact names from the current category guidance. Static semantics are advisory and never define new categories.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          expense: { description, amount },
          categories: buildCategoryGuidance(budgets),
        }),
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'expense_category_candidates',
        strict: true,
        schema: CANDIDATE_SCHEMA,
      },
    },
  };
}

export function extractCandidatePayload(openRouterPayload) {
  const content = openRouterPayload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('OpenRouter returned invalid candidate content.');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('OpenRouter returned invalid candidate content.');
  }
}

function hasExactKeys(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function validateRankedCandidates(payload, budgets) {
  if (!Array.isArray(budgets)) throw new Error('Invalid budget allowlist.');
  if (!hasExactKeys(payload, ['candidates']) || !Array.isArray(payload.candidates) ||
      payload.candidates.length < 1 || payload.candidates.length > 3) {
    throw new Error('Invalid candidate payload.');
  }

  const seen = new Set();
  const retained = [];
  for (const entry of payload.candidates) {
    if (!hasExactKeys(entry, ['categoryName', 'confidence', 'reason']) ||
        typeof entry.categoryName !== 'string' || entry.categoryName.length < 1 ||
        typeof entry.reason !== 'string' || entry.reason.length > 240 ||
        typeof entry.confidence !== 'number' || !Number.isFinite(entry.confidence) ||
        entry.confidence < 0 || entry.confidence > 1) continue;
    const budget = findBudgetByName(budgets, entry.categoryName);
    if (!budget || seen.has(budget.id)) continue;
    seen.add(budget.id);
    retained.push({
      budgetId: budget.id,
      categoryName: budget.name,
      confidence: entry.confidence,
      reason: entry.reason,
    });
  }
  if (!retained.length) throw new Error('No valid category candidates.');
  return retained;
}

export function selectTopCandidate(candidates, minConfidence = MIN_CONFIDENCE) {
  if (!Array.isArray(candidates) || typeof minConfidence !== 'number' ||
      !Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 1) return null;
  const top = candidates[0];
  if (!hasExactKeys(top, ['budgetId', 'categoryName', 'confidence', 'reason']) ||
      typeof top.budgetId !== 'string' || !top.budgetId ||
      typeof top.categoryName !== 'string' || !top.categoryName ||
      typeof top.reason !== 'string' || top.reason.length > 240 ||
      typeof top.confidence !== 'number' || !Number.isFinite(top.confidence) ||
      top.confidence < minConfidence || top.confidence > 1) return null;
  return top;
}

export async function inferCategory({ description, amount, budgets }, {
  fetchImpl = globalThis.fetch,
  timeoutMs = OPENROUTER_TIMEOUT_MS,
  createTimeoutSignal = AbortSignal.timeout,
  apiKey = process.env.OPENROUTER_API_KEY,
  model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
} = {}) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for category inference.');
  if (!Array.isArray(budgets) || budgets.length === 0) throw new Error('At least one current category is required.');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > OPENROUTER_TIMEOUT_MS) {
    throw new Error('OpenRouter timeout must be a bounded positive integer.');
  }

  const signal = createTimeoutSignal(timeoutMs);
  const response = await fetchImpl(OPENROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildInferenceRequest({ description, amount, budgets, model })),
    signal,
  });
  if (!response.ok) throw new Error('OpenRouter request failed.');
  const providerPayload = await response.json();
  return validateRankedCandidates(extractCandidatePayload(providerPayload), budgets);
}
