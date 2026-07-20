const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';
const MIN_CONFIDENCE = 0.7;

export function findBudgetByName(budgets, categoryName) {
  if (!categoryName) return null;
  return budgets.find(
    (budget) => budget.name.toLowerCase() === categoryName.toLowerCase(),
  ) ?? null;
}

export function selectInferredBudget(budgets, inference, minConfidence = MIN_CONFIDENCE) {
  if (!inference || typeof inference !== 'object') return null;
  if (typeof inference.categoryName !== 'string') return null;
  if (typeof inference.confidence !== 'number') return null;
  if (inference.confidence < minConfidence) return null;
  return findBudgetByName(budgets, inference.categoryName);
}

export async function inferCategory({ description, amount, budgets }) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for category inference');
  }

  const allowedCategories = budgets.map((budget) => budget.name);
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You categorize expenses. Choose exactly one category from the allowed list. Return only JSON with categoryName, confidence, and reason.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            allowedCategories,
            expense: { description, amount },
          }),
        },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenRouter returned no JSON content');
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error('OpenRouter returned invalid JSON');
  }
}
