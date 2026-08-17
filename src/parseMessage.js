const FORMAT_ERROR = 'Format: {amount} {description} [| category]';
const DELIMITED_FORMAT = 'Use: {amount} {description} | {category}';
const DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

function isFiniteDecimal(token) {
  return DECIMAL.test(token) && Number.isFinite(Number(token));
}

export function parseMessage(text) {
  const parts = text.trim().split('|');
  if (parts.length > 2) throw new Error(DELIMITED_FORMAT);
  const tokens = parts[0].trim().split(/\s+/);
  if (tokens.length < 2 || tokens[0] === '') {
    throw new Error(parts.length === 2 ? DELIMITED_FORMAT : FORMAT_ERROR);
  }

  const [amountToken, ...descriptionTokens] = tokens;
  if (!isFiniteDecimal(amountToken)) {
    throw new Error(`"${amountToken}" is not a valid amount`);
  }
  const description = descriptionTokens.join(' ');

  if (parts.length === 2) {
    const category = parts[1].trim();
    if (!category) throw new Error(DELIMITED_FORMAT);
    return { description, amount: Number(amountToken), category };
  }

  return { description, amount: Number(amountToken), category: null };
}
