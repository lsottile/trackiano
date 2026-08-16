const FORMAT_ERROR = 'Format: {description} {amount} [category]';
const DELIMITED_FORMAT = 'Use: {description} {amount} | {category}';
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

  let amountTokenIndex = -1;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    if (isFiniteDecimal(tokens[index])) {
      amountTokenIndex = index;
      break;
    }
  }

  if (amountTokenIndex < 0) {
    const candidate = tokens.length >= 3 ? tokens.at(-2) : tokens.at(-1);
    throw new Error(`"${candidate}" is not a valid amount`);
  }

  const description = tokens.slice(0, amountTokenIndex).join(' ');
  if (!description) throw new Error(FORMAT_ERROR);

  if (parts.length === 2) {
    const category = parts[1].trim();
    if (amountTokenIndex !== tokens.length - 1 || !category) throw new Error(DELIMITED_FORMAT);
    return { description, amount: Number(tokens[amountTokenIndex]), category };
  }

  if (tokens.filter(isFiniteDecimal).length > 1) {
    throw new Error(DELIMITED_FORMAT);
  }

  return {
    description,
    amount: Number(tokens[amountTokenIndex]),
    category: tokens.slice(amountTokenIndex + 1).join(' ') || null,
  };
}
