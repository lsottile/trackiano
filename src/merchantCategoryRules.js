const rules = Object.freeze([
  Object.freeze({
    budgetName: 'Transport',
    tokens: Object.freeze(['UBER', 'CABIFY', 'TAXI', 'DIDI']),
    brandPrefixes: Object.freeze(['UBER', 'CABIFY', 'DIDI']),
  }),
  Object.freeze({
    budgetName: 'Restaurants',
    tokens: Object.freeze(['PEDIDOSYA', 'RAPPI']),
    brandPrefixes: Object.freeze(['PEDIDOSYA', 'RAPPI']),
  }),
  Object.freeze({
    budgetName: 'Coffee & Snacks',
    tokens: Object.freeze(['COFFEE', 'CAFE', 'CAFETERIA', 'STARBUCKS']),
    brandPrefixes: Object.freeze(['STARBUCKS']),
  }),
  Object.freeze({
    budgetName: 'Groceries',
    tokens: Object.freeze(['MARKET', 'SUPERMARKET', 'SUPERMERCADO', 'GROCERY']),
    brandPrefixes: Object.freeze([]),
  }),
  Object.freeze({
    budgetName: 'Health',
    tokens: Object.freeze(['PHARMACY', 'FARMACIA', 'FARMACITY', 'DRUGSTORE']),
    brandPrefixes: Object.freeze(['FARMACITY']),
  }),
  Object.freeze({
    budgetName: 'Lodging',
    tokens: Object.freeze(['HOTEL', 'HOSTEL', 'AIRBNB']),
    brandPrefixes: Object.freeze(['AIRBNB']),
  }),
  Object.freeze({
    budgetName: 'Subscriptions',
    tokens: Object.freeze(['NETFLIX', 'SPOTIFY']),
    brandPrefixes: Object.freeze(['NETFLIX', 'SPOTIFY']),
  }),
]);

function normalizeWords(value) {
  if (typeof value !== 'string') return [];
  return value.normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

function normalizeBudgetName(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
}

export function findMerchantFamilyBudget(merchant, budgets) {
  const words = normalizeWords(merchant);
  if (!words.length || !Array.isArray(budgets)) return null;

  for (const rule of rules) {
    const matchesToken = words.some((word) => rule.tokens.includes(word));
    const matchesBrand = words.some((word) =>
      rule.brandPrefixes.some((prefix) => word.startsWith(prefix)));
    if (!matchesToken && !matchesBrand) continue;

    const expectedName = normalizeBudgetName(rule.budgetName);
    return budgets.find(({ name } = {}) => normalizeBudgetName(name) === expectedName) ?? null;
  }
  return null;
}
